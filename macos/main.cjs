const { app, BrowserWindow, dialog, ipcMain, Menu, session, Tray } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const setupFile = path.join(__dirname, "setup.html");
const connectTimeoutMs = 15_000;
const isLinux = process.platform === "linux";
const windowIcon = isLinux ? path.join(__dirname, "assets", "icon.png") : undefined;
let settings;
let settingsFile;
let player;
let setup;
let tray;
let quitting = false;
let opening = false;
let trayRefresh;
let refreshingTray = false;
let lastTrayState;

function parseServer(address) {
  if (typeof address !== "string") return null;
  try {
    const url = new URL(address.trim());
    if (["http:", "https:"].includes(url.protocol) && url.host &&
        !url.username && !url.password && !url.search && !url.hash) {
      return url;
    }
  } catch {}
  return null;
}

function readSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    return { serverUrl: parseServer(saved.serverUrl)?.href ?? "", minimizeToTray: saved.minimizeToTray !== false };
  } catch {
    return { serverUrl: "", minimizeToTray: true };
  }
}

function saveSettings() {
  try {
    const pendingFile = settingsFile + ".tmp";
    fs.writeFileSync(pendingFile, JSON.stringify(settings), { mode: 0o600 });
    fs.renameSync(pendingFile, settingsFile);
  } catch {
    dialog.showErrorBox("Aurral App", "Aurral couldn't save its settings.");
  }
}

function showAurral() {
  const window = setup ?? player;
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  } else if (!opening && settings) {
    openSetup();
  }
}

function openSetup() {
  if (setup) return showAurral();
  if (opening) return;
  if (player && !player.isVisible()) player.show();

  const window = new BrowserWindow({
    title: "Connect to Aurral",
    width: 470,
    height: 285,
    resizable: false,
    show: false,
    parent: player ?? undefined,
    modal: Boolean(player),
    backgroundColor: "#11141b",
    icon: windowIcon,
    autoHideMenuBar: isLinux,
    webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, "setup-preload.cjs") },
  });
  setup = window;
  window.webContents.on("will-navigate", event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    setup = null;
    if (!player && !opening) app.quit();
  });
  void window.loadFile(setupFile, { query: { server: settings.serverUrl } });
}

function allowBrowserNavigation(contents) {
  const isWebPage = url => /^https?:\/\//i.test(url);
  const blockOtherSchemes = event => {
    if (event.isMainFrame && !isWebPage(event.url)) event.preventDefault();
  };
  contents.on("will-frame-navigate", blockOtherSchemes);
  contents.on("will-redirect", blockOtherSchemes);
  contents.setWindowOpenHandler(({ url }) => ({
    action: isWebPage(url) || url === "about:blank" ? "allow" : "deny",
    overrideBrowserWindowOptions: {
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    },
  }));
  contents.on("did-create-window", child => allowBrowserNavigation(child.webContents));
}

function waitForServerPage(window, server, owner) {
  const contents = window.webContents;
  return new Promise(resolve => {
    let finished = false;
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      contents.removeListener("did-navigate", navigated);
      window.removeListener("closed", canceled);
      owner?.removeListener("closed", canceled);
      resolve(error);
    };
    const navigated = (_event, _url, status) => {
      finish(status >= 400 ? `The server returned HTTP ${status}.` : "");
    };
    const canceled = () => finish("Connection canceled.");
    const timeout = setTimeout(() => finish(
      "Aurral waited 15 seconds for the server to respond. Check the URL and try again.",
    ), connectTimeoutMs);

    contents.once("did-navigate", navigated);
    window.once("closed", canceled);
    owner?.once("closed", canceled);
    // Show the window once the main page responds. Its assets can keep loading in the window.
    window.loadURL(server.href).catch(error => {
      const code = /^ERR_[A-Z0-9_]+$/.test(error.code) ? ` (${error.code})` : "";
      finish(`Aurral couldn't open the server${code}. Check the address and try again.`);
    });
  });
}

async function openServer(server) {
  opening = true;
  const owner = setup;
  let window;
  try {
    window = new BrowserWindow({
      title: "Aurral App",
      width: 1200,
      height: 800,
      minWidth: 520,
      minHeight: 420,
      backgroundColor: "#11141b",
      icon: windowIcon,
      autoHideMenuBar: isLinux,
      show: false,
      webPreferences: {
        partition: "persist:aurral",
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, "media-preload.cjs"),
        additionalArguments: [`--aurral-server=${server.href}`],
      },
    });
    allowBrowserNavigation(window.webContents);
    window.on("page-title-updated", event => event.preventDefault());

    const failure = await waitForServerPage(window, server, owner);
    if (failure) return failure;
    if (quitting || window.isDestroyed()) return "Connection canceled.";

    const previous = player;
    window.on("close", event => {
      if (!quitting && settings.minimizeToTray) {
        event.preventDefault();
        window.hide();
      }
    });
    window.on("closed", () => {
      if (player === window) player = null;
    });
    player = window;
    settings.serverUrl = server.href;
    owner?.destroy();
    previous?.destroy();
    window.show();
    saveSettings();
    return "";
  } catch {
    return "Aurral couldn't open its browser window.";
  } finally {
    if (window && window !== player && !window.isDestroyed()) window.destroy();
    opening = false;
    if (owner?.isDestroyed() && !player && !quitting) app.quit();
  }
}

async function playback(command) {
  if (!player) return null;
  try {
    return await player.webContents.executeJavaScript(
      `window.__aurralTrayMedia?.(${JSON.stringify(command)}) ?? null`, command !== "state",
    );
  } catch {
    return null;
  }
}

async function showTrayMenu() {
  const state = await playback("state");
  if (!tray || quitting) return;
  tray.popUpContextMenu(buildTrayMenu(state));
}

function buildTrayMenu(state) {
  return Menu.buildFromTemplate([
    { label: "Show Aurral", click: showAurral },
    { type: "separator" },
    { label: state?.playing ? "Stop" : "Play", enabled: Boolean(state?.canToggle), click: () => playback("toggle") },
    { label: "Previous", enabled: Boolean(state?.canPrevious), click: () => playback("previoustrack") },
    { label: "Next", enabled: Boolean(state?.canNext), click: () => playback("nexttrack") },
    { type: "separator" },
    { label: "Quit", role: "quit" },
  ]);
}

async function refreshLinuxTray() {
  if (refreshingTray || quitting) return;
  refreshingTray = true;
  try {
    const state = await playback("state");
    const signature = JSON.stringify(state);
    if (tray && !quitting && signature !== lastTrayState) {
      tray.setContextMenu(buildTrayMenu(state));
      lastTrayState = signature;
    }
  } finally {
    refreshingTray = false;
  }
}

function setAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: isLinux ? "&Settings" : "Aurral App",
      submenu: [
        { label: "Show Aurral", click: showAurral },
        { label: "Change Server…", accelerator: "CommandOrControl+,", click: openSetup },
        { label: "Minimize to Tray", type: "checkbox", checked: settings.minimizeToTray, click: item => {
          settings.minimizeToTray = item.checked;
          saveSettings();
        } },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ]));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showAurral);
  app.on("activate", showAurral);
  app.on("window-all-closed", () => {
    if (!opening && settings?.minimizeToTray === false) app.quit();
  });
  app.on("before-quit", () => {
    quitting = true;
    clearInterval(trayRefresh);
  });
  app.whenReady().then(async () => {
    settingsFile = path.join(app.getPath("userData"), "settings.json");
    settings = readSettings();
    const browserSession = session.fromPartition("persist:aurral");
    browserSession.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));
    browserSession.setPermissionCheckHandler(() => false);

    ipcMain.handle("aurral:connect", async (event, address) => {
      if (!setup || event.senderFrame !== setup.webContents.mainFrame || opening) return "Connection unavailable.";
      const server = parseServer(address);
      if (!server) return "Enter an HTTP or HTTPS server URL.";
      return openServer(server);
    });

    setAppMenu();
    tray = new Tray(path.join(__dirname, "assets", isLinux ? "icon.png" : "TrayTemplate.png"));
    tray.setToolTip("Aurral App");
    if (isLinux) {
      await refreshLinuxTray();
      trayRefresh = setInterval(refreshLinuxTray, 1000);
      trayRefresh.unref();
    } else {
      tray.on("click", showTrayMenu);
      tray.on("right-click", showTrayMenu);
    }
    const server = parseServer(settings.serverUrl);
    if ((!server || await openServer(server)) && !quitting) openSetup();
  }).catch(error => {
    dialog.showErrorBox("Aurral App", `Aurral couldn't start.\n\n${error.message}`);
    app.quit();
  });
}
