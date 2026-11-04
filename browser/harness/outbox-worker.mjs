import { loadPyodide } from "./runtime/pyodide.mjs";
import { runChecks } from "./checks.mjs";
import { runOutboxChecks } from "./outbox-checks.mjs";

// Synthetic-only worker, not an application transport or trust API.
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
  if (!baseline.passed) throw new Error("Encryption baseline failed; outbox checks were not run");
  const outbox = await runOutboxChecks(pyodide, {}, progress);
  self.postMessage({ type: "result", result: { passed: outbox.passed,
    baseline_tests: baseline.tests, wheel_sha256: baseline.wheel_sha256,
    port_sha256: baseline.port_sha256, outbox,
    environment: "Actual browser worker, IndexedDB, Web Locks and unchanged Gajim OMEMO library",
    elapsed_ms: Math.round(performance.now() - started), user_agent: navigator.userAgent } });
} catch (error) {
  self.postMessage({ type: "error", text: error.code ?? error.message });
}
