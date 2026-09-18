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
const net = require("net");

const REPO_ROOT = path.join(__dirname, "..");
// Packaged builds run out of an asar archive, so the Python backend (which
// electron-builder copies in unpacked, see package.json's `extraResources`)
// lives under process.resourcesPath instead of next to electron/main.js.
const BACKEND_ROOT = app.isPackaged ? process.resourcesPath : REPO_ROOT;
// In dev, `npm run dev`'s dev:backend script already started uvicorn on this
// fixed port (with --reload), and the Vite dev server's frontend build
// defaults to it too (see frontend/src/api/client.ts) — so dev keeps a fixed
// port. Production has no such coordination, so it picks a free port at
// launch instead (see getFreePort()) rather than hardcoding one: a leftover
// dev session, or a previous packaged instance that didn't shut down
// cleanly, holding port 8756 would otherwise make the backend fail to bind
// and the app would quit with the health-check timeout below.
const DEV_BACKEND_PORT = 8756;
const DEV_SERVER_URL = "http://localhost:5173";
const isDev = process.env.NODE_ENV === "development";

let backendProcess = null;
let mainWindow = null;

function pythonExePath() {
  return path.join(BACKEND_ROOT, ".venv", "Scripts", "python.exe");
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function startBackend(port) {
  backendProcess = spawn(
    pythonExePath(),
    ["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", String(port)],
    { cwd: BACKEND_ROOT, windowsHide: true }
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

async function waitForBackend(healthUrl, timeoutMs = 15000, intervalMs = 300) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) return true;
    } catch {
      // backend not up yet — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function createWindow(apiPort) {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Tells preload.js which port the backend actually bound to, so the
      // (already-built, static) renderer can learn it at runtime — see
      // frontend/src/api/client.ts.
      additionalArguments: [`--api-port=${apiPort}`],
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
  let port = DEV_BACKEND_PORT;
  if (!isDev) {
    try {
      port = await getFreePort();
    } catch {
      port = DEV_BACKEND_PORT; // fall back to the default if port-scan itself fails
    }
    startBackend(port);
  }
  const ready = await waitForBackend(`http://127.0.0.1:${port}/api/health`);
  if (!ready) {
    dialog.showErrorBox(
      "Statement Ledger",
      isDev
        ? `Could not reach the backend at http://127.0.0.1:${port} — make sure \`npm run dev\` (not just electron) started it.`
        : "The backend did not start in time. Check that the .venv Python environment has the backend dependencies installed (backend/requirements.txt)."
    );
    app.quit();
    return;
  }
  createWindow(port);
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
