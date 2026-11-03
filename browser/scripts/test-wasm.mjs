import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "../dist/runtime/pyodide.mjs";
import { runChecks } from "../dist/checks.mjs";
import { runStorageChecks } from "../dist/storage-checks.mjs";
import { IDBFactory } from "fake-indexeddb";
import { locks } from "node:worker_threads";

const root = new URL("../dist/", import.meta.url);
const started = performance.now();
const pyodide = await loadPyodide({ indexURL: fileURLToPath(new URL("runtime/", root)) });
const startup_ms = Math.round(performance.now() - started);
const result = await runChecks(pyodide, async (name) => new Uint8Array(await readFile(new URL(name, root))));
if (result.passed) {
  result.storage_integration = await runStorageChecks(pyodide, { indexedDB: new IDBFactory(), locks });
  result.storage_integration.environment = "Simulated IndexedDB and Node Web Locks; not a browser pass";
  result.passed &&= result.storage_integration.passed;
}
console.log(JSON.stringify({ ...result, startup_ms, host: `Node ${process.version}` }, null, 2));
if (!result.passed) process.exitCode = 1;
