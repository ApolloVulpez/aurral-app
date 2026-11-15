const { ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  const menu = document.querySelector(".settings-popup");
  const items = [...menu.querySelectorAll("button")];
  const dismiss = () => ipcRenderer.send("aurral:dismiss-settings");

  ipcRenderer.on("aurral:settings-state", (_event, { anchor, state }) => {
    for (const item of items) {
      const setting = item.dataset.setting;
      if (item.hasAttribute("aria-checked")) item.setAttribute("aria-checked", String(state[setting]));
      item.disabled = setting === "discordListenLinks" && !state.discordPresence;
    }

    menu.hidden = false;
    const { width } = menu.getBoundingClientRect();
    const left = anchor.alignLeft ? anchor.x : anchor.x - width;
    menu.style.left = `${Math.max(8, Math.min(left, innerWidth - width - 8))}px`;
    menu.style.top = `${anchor.y}px`;
    items[0].focus();
  });

  for (const item of items) {
    item.addEventListener("click", () => ipcRenderer.send("aurral:choose-setting", item.dataset.setting));
  }
  window.addEventListener("pointerdown", event => {
    if (!menu.contains(event.target)) dismiss();
  });
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      dismiss();
      return;
    }

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
