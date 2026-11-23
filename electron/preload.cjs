const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chordplannerAI", {
  startServer: () => ipcRenderer.invoke("ai:start-server"),
  stopServer: () => ipcRenderer.invoke("ai:stop-server"),
  getServerStatus: () => ipcRenderer.invoke("ai:server-status"),
});
