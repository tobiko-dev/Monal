import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "../dist/runtime/pyodide.mjs";
import { runChecks } from "../dist/checks.mjs";

const root = new URL("../dist/", import.meta.url);
const started = performance.now();
const pyodide = await loadPyodide({ indexURL: fileURLToPath(new URL("runtime/", root)) });
const startup_ms = Math.round(performance.now() - started);
const result = await runChecks(pyodide, async (name) => new Uint8Array(await readFile(new URL(name, root))));
console.log(JSON.stringify({ ...result, startup_ms, host: `Node ${process.version}` }, null, 2));
if (!result.passed) process.exitCode = 1;
