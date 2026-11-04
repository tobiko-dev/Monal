import { loadPyodide } from "./runtime/pyodide.mjs";
import { runChecks } from "./checks.mjs";
import { runProtocolChecks } from "./protocol-checks.mjs";

try {
  const progress = (text) => self.postMessage({ type: "progress", text });
  const started = performance.now();
  progress("Starting the WebAssembly Python runtime…");
  const pyodide = await loadPyodide({ indexURL: new URL("./runtime/", import.meta.url).href,
    stdout: () => {}, stderr: () => {} });
  const read = async (path) => {
    const response = await fetch(new URL(path, import.meta.url), { credentials: "same-origin", redirect: "error" });
    if (!response.ok) throw new Error("A required test artifact could not be loaded");
    return new Uint8Array(await response.arrayBuffer());
  };
  const baseline = await runChecks(pyodide, read, progress);
  if (!baseline.passed) throw new Error("Encryption baseline failed; protocol checks were not run");
  const result = await runProtocolChecks(pyodide, read, progress);
  result.baseline_tests = baseline.tests;
  result.environment = "Actual browser module worker, Pyodide WebLoop, adapted upstream nbxmpp and unchanged Gajim OMEMO library";
  result.total_elapsed_ms = Math.round(performance.now() - started);
  result.user_agent = navigator.userAgent;
  self.postMessage({ type: "result", result });
} catch (error) {
  self.postMessage({ type: "error", text: error.code ?? error.message });
}
