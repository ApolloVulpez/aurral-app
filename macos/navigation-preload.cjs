const { ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  const back = document.getElementById("back");
  const forward = document.getElementById("forward");
  const changelog = document.getElementById("changelog");
  const update = document.getElementById("update");
  const settings = document.getElementById("settings");

  function togglePopup(button) {
    const { left, right } = button.getBoundingClientRect();
    const alignLeft = document.body.classList.contains("controls-left");
    ipcRenderer.send("aurral:toggle-caption-popup", button.id, { x: alignLeft ? left : right, alignLeft });
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
  changelog.addEventListener("click", () => togglePopup(changelog));
  settings.addEventListener("click", () => togglePopup(settings));
  ipcRenderer.on("aurral:settings-shortcut", () => togglePopup(settings));
  ipcRenderer.on("aurral:caption-popup-visibility", (_event, popup) => {
    for (const button of [changelog, settings]) button.setAttribute("aria-expanded", String(button.id === popup));
  });
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
