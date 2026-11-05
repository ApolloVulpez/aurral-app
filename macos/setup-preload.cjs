const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aurralSetup", {
  connect: address => ipcRenderer.invoke("aurral:connect", address),
});
