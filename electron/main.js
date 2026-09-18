// Electron main process for the Statement Ledger React UI.
//
// Responsibilities: spawn the FastAPI backend (using the repo's .venv
// Python), wait for it to report healthy, then open a window pointing at
// the Vite dev server (development) or the built frontend (production).
// Kills the backend subprocess on quit so uvicorn never survives Electron
// closing.
const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const BACKEND_PORT = 8756;
const BACKEND_HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/api/health`;
const DEV_SERVER_URL = "http://localhost:5173";
const isDev = process.env.NODE_ENV === "development";

let backendProcess = null;
let mainWindow = null;

function pythonExePath() {
  return path.join(REPO_ROOT, ".venv", "Scripts", "python.exe");
}

function startBackend() {
  backendProcess = spawn(
    pythonExePath(),
    ["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT)],
    { cwd: REPO_ROOT, windowsHide: true }
  );
  backendProcess.stdout.on("data", (d) => process.stdout.write(`[backend] ${d}`));
  backendProcess.stderr.on("data", (d) => process.stderr.write(`[backend] ${d}`));
  backendProcess.on("exit", (code) => {
    backendProcess = null;
    if (code !== null && code !== 0 && mainWindow) {
      dialog.showErrorBox("Statement Ledger", `Backend process exited unexpectedly (code ${code}).`);
    }
  });
}

async function waitForBackend(timeoutMs = 15000, intervalMs = 300) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BACKEND_HEALTH_URL);
      if (res.ok) return true;
    } catch {
      // backend not up yet — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(REPO_ROOT, "frontend", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // In dev, `npm run dev`'s dev:backend script already started uvicorn
  // (with --reload) — spawning a second copy here would just fight it for
  // port 8756 and crash. Electron only owns the backend process in
  // production, where there's no separate npm-managed instance.
  if (!isDev) {
    startBackend();
  }
  const ready = await waitForBackend();
  if (!ready) {
    dialog.showErrorBox(
      "Statement Ledger",
      isDev
        ? "Could not reach the backend at http://127.0.0.1:8756 — make sure `npm run dev` (not just electron) started it."
        : "The backend did not start in time. Check that the .venv Python environment has the backend dependencies installed (backend/requirements.txt)."
    );
    app.quit();
    return;
  }
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});
