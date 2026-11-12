const { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, Tray, WebContentsView } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { checkForUpdate, installUpdate } = require("./updates.cjs");
const { DiscordPresence } = require("./discord-presence.cjs");
const { DiscordArtwork } = require("./discord-artwork.cjs");

const discordActivityScript = fs.readFileSync(path.join(__dirname, "discord-activity.js"), "utf8").trim();
const discord = new DiscordPresence(fs.readFileSync(path.join(__dirname, "assets", "discord-application-id.txt"), "utf8").trim());
const discordArtwork = new DiscordArtwork();

const setupFile = path.join(__dirname, "setup.html");
const navigationFile = path.join(__dirname, "navigation.html");
const navigationHeight = 36;
const connectTimeoutMs = 15_000;
const isLinux = process.platform === "linux";
const windowIcon = isLinux ? path.join(__dirname, "assets", "icon.png") : undefined;
let settings;
let settingsFile;
let player;
let playerPage;
let setup;
let tray;
let quitting = false;
let opening = false;
let trayRefresh;
let refreshingTray = false;
let lastTrayState;
let availableUpdate;
let updateStatus = "";
let discordRefresh;
let refreshingDiscord = false;

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
    return { serverUrl: parseServer(saved.serverUrl)?.href ?? "", minimizeToTray: saved.minimizeToTray !== false,
      discordPresence: saved.discordPresence !== false, discordListenLinks: saved.discordListenLinks !== false };
  } catch {
    return { serverUrl: "", minimizeToTray: true, discordPresence: true, discordListenLinks: true };
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

async function refreshDiscord() {
  if (refreshingDiscord || quitting || !settings.discordPresence) return;
  refreshingDiscord = true;
  try {
    const page = playerPage;
    const server = settings.serverUrl;
    const share = settings.discordListenLinks && discord.connected;
    const playback = await page?.executeJavaScript(`${discordActivityScript}(${JSON.stringify(server)}, ${share})`);
    if (quitting || !settings.discordPresence || playerPage !== page || server !== settings.serverUrl ||
        (share && !settings.discordListenLinks)) return;
    const activity = playback?.activity;
    if (activity && discord.connected && playback.coverSearch) {
      const cover = discordArtwork.get(playback.coverSearch);
      if (cover) activity.assets = { large_image: cover };
    }
    await discord.update(activity ?? null);
  } catch {
    // The page or Discord can close while a refresh is in progress.
  } finally {
    refreshingDiscord = false;
  }
}

function applyDiscordSettings() {
  clearInterval(discordRefresh);
  if (settings.discordPresence) {
    discordRefresh = setInterval(refreshDiscord, 2000);
    discordRefresh.unref();
    void refreshDiscord();
  } else {
    discord.disconnect();
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

function navigateHistory(page, direction) {
  const history = page.navigationHistory;
  if (direction === "back" && history.canGoBack()) history.goBack();
  if (direction === "forward" && history.canGoForward()) history.goForward();
}

function sendUpdateStatus(contents = player?.webContents) {
  if (!contents || contents.isDestroyed()) return;
  contents.send("aurral:update-state", {
    busy: Boolean(updateStatus),
    available: Boolean(availableUpdate),
    label: updateStatus || (availableUpdate ? `Update to Aurral App ${availableUpdate.version}` : "Check for app updates"),
  });
}

function showUpdateMessage(message, detail, type = "info") {
  const options = { type, title: "App updates", message, detail };
  const window = setup ?? player;
  return window && !window.isDestroyed() ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
}

function currentAppImage() {
  const { APPDIR, APPIMAGE } = process.env;
  return isLinux && APPDIR && APPIMAGE && path.isAbsolute(APPDIR) && path.isAbsolute(APPIMAGE) &&
    process.execPath.startsWith(APPDIR + path.sep) ? APPIMAGE : undefined;
}

function restartAfterUpdate(executable, appImage) {
  if (appImage) {
    const mount = process.env.APPDIR;
    // AppRun prepends paths from this mount. They won't exist after the restart.
    for (const key of ["LD_LIBRARY_PATH", "XDG_DATA_DIRS"]) {
      const entries = (process.env[key] ?? "").split(":").filter(entry => entry &&
        entry !== mount && !entry.startsWith(mount + path.sep));
      if (entries.length) process.env[key] = entries.join(":");
      else delete process.env[key];
    }
    for (const key of ["APPDIR", "APPIMAGE", "ARGV0", "OWD"]) delete process.env[key];
    process.chdir(path.dirname(executable));
  }
  app.relaunch({ execPath: executable, args: [] });
  app.quit();
}

async function checkForAppUpdate(install) {
  if (updateStatus || quitting) return;
  if (!app.isPackaged) {
    if (install) await showUpdateMessage("App updates are available in packaged builds.");
    return;
  }

  const appImage = currentAppImage();
  const platform = process.platform;
  updateStatus = "Checking for app updates…";
  sendUpdateStatus();
  try {
    availableUpdate = await checkForUpdate({ version: app.getVersion(), platform, arch: process.arch, appImage });
    if (!install || quitting) return;
    if (!availableUpdate) {
      await showUpdateMessage("Aurral App is up to date.");
      return;
    }

    updateStatus = `Installing Aurral App ${availableUpdate.version}…`;
    sendUpdateStatus();
    const result = await installUpdate(availableUpdate, {
      platform, executable: process.execPath, appImage, tempDirectory: app.getPath("temp"),
    });
    if (quitting) return;
    if (result.executable) restartAfterUpdate(result.executable, appImage);
    if (result.packageFile) {
      if (appImage || await shell.openPath(result.packageFile)) shell.showItemInFolder(result.packageFile);
      await showUpdateMessage(`Aurral App ${availableUpdate.version} downloaded.`, appImage
        ? "Replace your current AppImage with the downloaded file."
        : platform === "darwin"
          ? "Open the downloaded disk image and drag Aurral App into Applications."
          : "Open the downloaded package in your software installer to finish the update.");
    }
  } catch (error) {
    if (install && !quitting) await showUpdateMessage("Aurral App couldn't finish the update.", error.message, "warning");
  } finally {
    updateStatus = "";
    sendUpdateStatus();
  }
}

function attachNavigation(window, view) {
  const page = view.webContents;
  const toolbar = window.webContents;
  window.once("closed", () => {
    if (!page.isDestroyed()) page.close();
  });

  window.contentView.addChildView(view);
  view.setBackgroundColor("#11141b");
  const resize = () => {
    const [width, height] = window.getContentSize();
    view.setBounds({ x: 0, y: navigationHeight, width, height: Math.max(0, height - navigationHeight) });
  };
  resize();
  window.on("resize", resize);

  toolbar.on("will-navigate", event => event.preventDefault());
  toolbar.setWindowOpenHandler(() => ({ action: "deny" }));
  const updateButtons = () => {
    if (toolbar.isDestroyed() || page.isDestroyed()) return;
    toolbar.send("aurral:history-state", {
      back: page.navigationHistory.canGoBack(),
      forward: page.navigationHistory.canGoForward(),
    });
  };
  toolbar.on("did-finish-load", () => {
    updateButtons();
    sendUpdateStatus(toolbar);
  });
  page.on("did-navigate", updateButtons);
  page.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
    if (isMainFrame) updateButtons();
  });

  const onInput = (event, input) => {
    if (input.type !== "keyDown" || input.control || input.shift) return;
    const modifier = isLinux ? input.alt && !input.meta : input.meta && !input.alt;
    if (!modifier) return;
    const backKey = isLinux ? "ArrowLeft" : "[";
    const forwardKey = isLinux ? "ArrowRight" : "]";
    if (input.key !== backKey && input.key !== forwardKey) return;

    event.preventDefault();
    if (!input.isAutoRepeat) navigateHistory(page, input.key === backKey ? "back" : "forward");
  };
  page.on("before-input-event", onInput);
  toolbar.on("before-input-event", onInput);
}

function waitForServerPage(window, contents, server, owner) {
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
    contents.loadURL(server.href).catch(error => {
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
      titleBarStyle: "hidden",
      ...(isLinux
        ? { titleBarOverlay: { color: "#000000", symbolColor: "#ffffff", height: navigationHeight } }
        : { trafficLightPosition: { x: 12, y: 12 } }),
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        preload: path.join(__dirname, "navigation-preload.cjs"),
      },
    });
    const view = new WebContentsView({
      webPreferences: {
        partition: "persist:aurral",
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, "media-preload.cjs"),
        additionalArguments: [`--aurral-server=${server.href}`],
      },
    });
    const page = view.webContents;
    attachNavigation(window, view);
    allowBrowserNavigation(page);
    window.on("page-title-updated", event => event.preventDefault());
    await window.loadFile(navigationFile);
    if (quitting || owner?.isDestroyed()) return "Connection canceled.";

    const failure = await waitForServerPage(window, page, server, owner);
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
      if (player === window) {
        player = null;
        playerPage = null;
      }
    });
    player = window;
    playerPage = page;
    settings.serverUrl = server.href;
    owner?.destroy();
    previous?.destroy();
    window.show();
    page.focus();
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
  if (!playerPage) return null;
  try {
    return await playerPage.executeJavaScript(
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
        { label: "Check for App Updates…", click: () => checkForAppUpdate(true) },
        { label: "Minimize to Tray", type: "checkbox", checked: settings.minimizeToTray, click: item => {
          settings.minimizeToTray = item.checked;
          saveSettings();
        } },
        { type: "separator" },
        { label: "Discord Rich Presence", type: "checkbox", checked: settings.discordPresence, click: item => {
          settings.discordPresence = item.checked;
          saveSettings();
          applyDiscordSettings();
          setAppMenu();
        } },
        { label: "Share Listen Links on Discord", type: "checkbox", checked: settings.discordListenLinks,
          enabled: settings.discordPresence, click: item => {
            settings.discordListenLinks = item.checked;
            saveSettings();
            void refreshDiscord();
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
    clearInterval(discordRefresh);
    discord.disconnect();
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
    ipcMain.on("aurral:navigate-history", (event, direction) => {
      if (!playerPage || !player || event.senderFrame !== player.webContents.mainFrame) return;
      navigateHistory(playerPage, direction);
    });
    ipcMain.on("aurral:check-for-update", event => {
      if (player && event.senderFrame === player.webContents.mainFrame) void checkForAppUpdate(true);
    });

    setAppMenu();
    applyDiscordSettings();
    void checkForAppUpdate(false);
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
