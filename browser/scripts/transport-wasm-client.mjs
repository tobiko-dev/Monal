import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "../dist/runtime/pyodide.mjs";
import { runTransportChecks } from "../dist/transport-checks.mjs";

let completed = false;
process.on("exit", () => { if (!completed) process.exitCode = 1; });
try {
  const root = new URL("../dist/", import.meta.url);
  const pyodide = await loadPyodide({ indexURL: fileURLToPath(new URL("runtime/", root)), stdout: () => {}, stderr: () => {} });
  const report = await runTransportChecks(pyodide, async name => new Uint8Array(await readFile(new URL(name, root))), process.argv[2]);
  report.environment = `Node ${process.version}, native WebSocket, real local TLS and upstream nbxmpp in WebAssembly; not a browser pass`;
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  completed = true;
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  console.error(error.message); process.exitCode = 1;
}
