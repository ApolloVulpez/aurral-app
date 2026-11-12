const { ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  const back = document.getElementById("back");
  const forward = document.getElementById("forward");
  const update = document.getElementById("update");

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
