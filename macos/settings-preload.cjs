const { ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  const menu = document.querySelector('[role="menu"]');
  const changelog = document.querySelector(".changelog-popup");
  const version = document.getElementById("changelog-version");
  const notes = document.getElementById("changelog-notes");
  const items = [...menu.querySelectorAll("button")];
  const dismiss = () => ipcRenderer.send("aurral:dismiss-settings");

  function showPopup(popup, anchor) {
    menu.hidden = popup !== menu;
    changelog.hidden = popup !== changelog;
    const { width } = popup.getBoundingClientRect();
    const left = anchor.alignLeft ? anchor.x : anchor.x - width;
    popup.style.left = `${Math.max(8, Math.min(left, innerWidth - width - 8))}px`;
    popup.style.top = `${anchor.y}px`;
  }

  ipcRenderer.on("aurral:settings-state", (_event, { anchor, state }) => {
    for (const item of items) {
      const setting = item.dataset.setting;
      if (item.hasAttribute("aria-checked")) item.setAttribute("aria-checked", String(state[setting]));
      item.disabled = setting === "discordListenLinks" && !state.discordPresence;
    }

    showPopup(menu, anchor);
    items[0].focus();
  });

  ipcRenderer.on("aurral:changelog-state", (_event, state) => {
    version.textContent = `Version ${state.version}`;
    notes.textContent = state.notes;
    showPopup(changelog, state.anchor);
    changelog.scrollTop = 0;
    changelog.focus();
  });
  ipcRenderer.on("aurral:changelog-notes", (_event, text) => { notes.textContent = text; });

  for (const item of items) {
    item.addEventListener("click", () => ipcRenderer.send("aurral:choose-setting", item.dataset.setting));
  }
  window.addEventListener("pointerdown", event => {
    const popup = menu.hidden ? changelog : menu;
    if (!popup.contains(event.target)) dismiss();
  });
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      dismiss();
      return;
    }

    if (menu.hidden) return;
    const available = items.filter(item => !item.disabled);
    const index = available.indexOf(document.activeElement);
    let target;
    if (event.key === "ArrowDown") target = available[(index + 1) % available.length];
    if (event.key === "ArrowUp") target = available[(index - 1 + available.length) % available.length];
    if (event.key === "Home") target = available[0];
    if (event.key === "End") target = available.at(-1);
    if (target) {
      event.preventDefault();
      target.focus();
    }
  });
});
