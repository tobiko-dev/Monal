import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "../dist/runtime/pyodide.mjs";
import { runProtocolChecks } from "../dist/protocol-checks.mjs";

let completed = false;
process.on("exit", () => { if (!completed) process.exitCode = 1; });
async function main() {
  const root = new URL("../dist/", import.meta.url);
  const pyodide = await loadPyodide({ indexURL: fileURLToPath(new URL("runtime/", root)) });
  const report = await runProtocolChecks(pyodide, async (name) => new Uint8Array(await readFile(new URL(name, root))));
  report.environment = `Node ${process.version} running WebAssembly/Pyodide WebLoop; not a browser pass`;
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  completed = true;
  if (!report.passed) process.exitCode = 1;
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
