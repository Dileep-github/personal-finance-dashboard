// The renderer talks to the backend purely over HTTP (fetch), so the only
// thing it needs from the main process is the backend's actual port —
// production picks a free one dynamically (see electron/main.js) rather
// than assuming 8756, and the already-built static frontend has no other
// way to learn it at runtime. main.js passes it via additionalArguments;
// frontend/src/api/client.ts reads it off window.statementLedger.
const { contextBridge } = require("electron");

const portArg = process.argv.find((arg) => arg.startsWith("--api-port="));
if (portArg) {
  const port = portArg.split("=")[1];
  contextBridge.exposeInMainWorld("statementLedger", {
    apiBaseUrl: `http://127.0.0.1:${port}`,
  });
}
