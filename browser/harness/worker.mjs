import { loadPyodide } from "./runtime/pyodide.mjs";
import { runChecks } from "./checks.mjs";
import { runStorageChecks } from "./storage-checks.mjs";

// No account credentials or network messaging API exists in this harness.
try {
  if (!self.crypto?.getRandomValues || !self.crypto?.subtle) {
    throw new Error("This test needs a secure browser context with Web Crypto.");
  }
  const started = performance.now();
  self.postMessage({ type: "progress", text: "Starting the WebAssembly Python runtime…" });
  const pyodide = await loadPyodide({ indexURL: new URL("./runtime/", import.meta.url).href });
  const startup_ms = Math.round(performance.now() - started);
  const read = async (path) => {
    const response = await fetch(new URL(path, import.meta.url));
    if (!response.ok) throw new Error(`Cannot load ${path}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const result = await runChecks(pyodide, read, (text) => self.postMessage({ type: "progress", text }));
  if (result.passed) {
    self.postMessage({ type: "progress", text: "Checking synthetic identities with browser storage…" });
    result.storage_integration = await runStorageChecks(pyodide);
    result.storage_integration.environment = "Browser IndexedDB and Web Locks";
    result.passed &&= result.storage_integration.passed;
  }
  self.postMessage({ type: "result", result: { ...result, startup_ms, user_agent: navigator.userAgent } });
} catch (error) {
  self.postMessage({ type: "error", text: error.message });
}
