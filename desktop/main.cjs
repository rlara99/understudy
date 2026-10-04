// Owner: Renzo. Electron main process for the Understudy desktop app.
// - Main window: the React app (Expert / Learner modes).
// - Companion window: small, always on top. Hosts a live session (Claudia, recording, off the record)
//   so the expert or learner can keep working in any other app with the main window minimized.
// - Screen capture: getDisplayMedia() in the app gets the primary screen, plus system audio
//   ("loopback", Windows) when the page asks for audio, so call audio can be transcribed (opt-in).
const { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, shell } = require("electron");
const path = require("node:path");

// Dev: Vite on :5173 (proxies /api to the server on :8787).
const APP_URL = process.env.UNDERSTUDY_URL || "http://localhost:5173";

const ICON = path.join(__dirname, "understudy.ico");

let mainWindow = null;
let companionWindow = null;

const webPreferences = {
  preload: path.join(__dirname, "preload.cjs"),
  contextIsolation: true,
  // Keep timers and audio running when the window is hidden or minimized.
  backgroundThrottling: false,
};

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: "Understudy",
    icon: ICON,
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences,
  });
  mainWindow.loadURL(`${APP_URL}/#/`);
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (companionWindow && !companionWindow.isDestroyed()) companionWindow.close();
  });
}

/** Open (or reuse) the companion window on a route, e.g. "work/live". */
function openCompanion(route) {
  const url = `${APP_URL}/#/${route}`;
  if (companionWindow && !companionWindow.isDestroyed()) {
    if (companionWindow.webContents.getURL() !== url) companionWindow.loadURL(url);
    companionWindow.show();
    companionWindow.focus();
    return;
  }
  const { workArea } = screen.getPrimaryDisplay();
  const width = 420;
  const height = Math.min(760, workArea.height - 40);
  companionWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 20,
    y: workArea.y + 20,
    minWidth: 340,
    minHeight: 420,
    title: "Understudy · Claudia",
    icon: ICON,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences,
  });
  companionWindow.setAlwaysOnTop(true, "floating");
  companionWindow.loadURL(url);
  companionWindow.on("closed", () => {
    companionWindow = null;
  });
}

function closeCompanion() {
  if (companionWindow && !companionWindow.isDestroyed()) companionWindow.close();
}

// Taskbar grouping and icon on Windows.
if (process.platform === "win32") app.setAppUserModelId("Understudy");

app.whenReady().then(() => {
  const ses = session.defaultSession;

  // Mic, camera-less screen capture and notifications are allowed for our own app only.
  const allowed = new Set(["media", "display-capture", "notifications", "clipboard-sanitized-write"]);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // getDisplayMedia(): share the primary screen; add system audio when the page asked for audio.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      const primaryId = String(screen.getPrimaryDisplay().id);
      const source = sources.find((s) => s.display_id === primaryId) || sources[0];
      const grant = { video: source };
      if (request.audioRequested && process.platform === "win32") grant.audio = "loopback";
      callback(grant);
    } catch (err) {
      console.error("[desktop] screen capture failed:", err);
      callback({});
    }
  });

  ipcMain.handle("companion:open", (_e, route) => openCompanion(String(route || "")));
  ipcMain.handle("companion:close", () => closeCompanion());
  ipcMain.handle("main:focus", () => {
    if (!mainWindow) return createMainWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  // Bring the main window forward on a route, e.g. "expert/debrief".
  ipcMain.handle("main:navigate", (_e, route) => {
    if (!mainWindow) createMainWindow();
    mainWindow.webContents.executeJavaScript(`location.hash = ${JSON.stringify("#/" + String(route || ""))}`);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  // Links that open a new window (target="_blank") go to the normal browser: external sites,
  // and our own pages like the ERP work app (/erp/), which is meant to run in the browser.
  app.on("web-contents-created", (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("http://") || url.startsWith("https://")) shell.openExternal(url);
      return { action: "deny" };
    });
  });

  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
