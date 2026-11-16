const { ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  const back = document.getElementById("back");
  const forward = document.getElementById("forward");
  const update = document.getElementById("update");
  const settings = document.getElementById("settings");

  function toggleSettings() {
    const { left, right } = settings.getBoundingClientRect();
    const alignLeft = document.body.classList.contains("controls-left");
    ipcRenderer.send("aurral:toggle-settings", { x: alignLeft ? left : right, alignLeft });
  }

  if (process.platform === "darwin") {
    document.body.classList.add("mac", "controls-left");
  } else if (navigator.windowControlsOverlay) {
    const overlay = navigator.windowControlsOverlay;
    const positionButtons = () => {
      document.body.classList.toggle("controls-left", overlay.getTitlebarAreaRect().x > 0);
    };
    positionButtons();
    overlay.addEventListener("geometrychange", positionButtons);
  }

  back.addEventListener("click", () => ipcRenderer.send("aurral:navigate-history", "back"));
  forward.addEventListener("click", () => ipcRenderer.send("aurral:navigate-history", "forward"));
  update.addEventListener("click", () => ipcRenderer.send("aurral:check-for-update"));
  settings.addEventListener("click", toggleSettings);
  ipcRenderer.on("aurral:settings-shortcut", toggleSettings);
  ipcRenderer.on("aurral:settings-visibility", (_event, open) => settings.setAttribute("aria-expanded", String(open)));
  ipcRenderer.on("aurral:title", (_event, title) => { document.querySelector(".title").textContent = title; });
  ipcRenderer.on("aurral:history-state", (_event, state) => {
    back.disabled = !state.back;
    forward.disabled = !state.forward;
  });
  ipcRenderer.on("aurral:update-state", (_event, state) => {
    update.disabled = state.busy;
    update.classList.toggle("available", state.available);
    update.title = state.label;
    update.setAttribute("aria-label", state.label);
  });
});
