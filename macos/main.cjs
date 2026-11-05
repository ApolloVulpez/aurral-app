const { app, BrowserWindow, dialog, ipcMain, Menu, session, Tray } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const setupFile = path.join(__dirname, "setup.html");
const mediaBridge = fs.readFileSync(path.join(__dirname, "media-bridge.js"), "utf8");
let settings;
let settingsFile;
let player;
let setup;
let tray;
let quitting = false;
let opening = false;

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
    height: 260,
    resizable: false,
    show: false,
    parent: player ?? undefined,
    modal: Boolean(player),
    backgroundColor: "#11141b",
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

async function openServer(server) {
  opening = true;
  const window = new BrowserWindow({
    title: "Aurral App",
    width: 1200,
    height: 800,
    minWidth: 520,
    minHeight: 420,
    backgroundColor: "#11141b",
    show: false,
    webPreferences: {
      partition: "persist:aurral",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  allowBrowserNavigation(window.webContents);
  window.on("page-title-updated", event => event.preventDefault());
  let status;
  window.webContents.once("did-navigate", (_event, _url, code) => { status = code; });
  try {
    const inspector = window.webContents.debugger;
    inspector.attach("1.3");
    await inspector.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
      source: `${mediaBridge}\ninstallMediaBridge(${JSON.stringify(server.href)});`,
    });
    await window.loadURL(server.href);
    if (status >= 400) throw new Error(`HTTP ${status}`);
  } catch {
    if (!window.isDestroyed()) window.destroy();
    return false;
  } finally {
    opening = false;
  }
  if (quitting || window.isDestroyed()) return false;

  const previous = player;
  player = window;
  window.on("close", event => {
    if (!quitting && settings.minimizeToTray) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    if (player === window) player = null;
  });
  settings.serverUrl = server.href;
  saveSettings();
  setup?.destroy();
  previous?.destroy();
  window.show();
  return true;
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
  tray.popUpContextMenu(Menu.buildFromTemplate([
    { label: "Show Aurral", click: showAurral },
    { type: "separator" },
    { label: state?.playing ? "Stop" : "Play", enabled: Boolean(state?.canToggle), click: () => playback("toggle") },
    { label: "Previous", enabled: Boolean(state?.canPrevious), click: () => playback("previoustrack") },
    { label: "Next", enabled: Boolean(state?.canNext), click: () => playback("nexttrack") },
    { type: "separator" },
    { label: "Quit", role: "quit" },
  ]));
}

function setAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "Aurral App",
      submenu: [
        { label: "Show Aurral", click: showAurral },
        { label: "Change Server…", accelerator: "Command+,", click: openSetup },
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
  app.on("before-quit", () => { quitting = true; });
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
      if (!await openServer(server)) return "Aurral couldn't open that address. Check the URL and try again.";
      return "";
    });

    setAppMenu();
    tray = new Tray(path.join(__dirname, "assets", "TrayTemplate.png"));
    tray.setToolTip("Aurral App");
    tray.on("click", showTrayMenu);
    tray.on("right-click", showTrayMenu);
    const server = parseServer(settings.serverUrl);
    if (!server || !await openServer(server)) openSetup();
  }).catch(error => {
    dialog.showErrorBox("Aurral App", `Aurral couldn't start.\n\n${error.message}`);
    app.quit();
  });
}
