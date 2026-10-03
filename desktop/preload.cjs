// Owner: Renzo. Bridge between the React app and the Electron main process.
// The web app checks `window.understudy?.isDesktop` and falls back to plain navigation in a browser.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("understudy", {
  isDesktop: true,
  platform: process.platform,
  /** Open the always-on-top companion window on a route, e.g. "work/live". */
  openCompanion: (route) => ipcRenderer.invoke("companion:open", route),
  closeCompanion: () => ipcRenderer.invoke("companion:close"),
  /** Bring the main window back to the front. */
  focusMain: () => ipcRenderer.invoke("main:focus"),
});
