import { loadPyodide } from "./runtime/pyodide.mjs";
import { runTransportChecks } from "./transport-checks.mjs";

try {
  const progress = text => self.postMessage({ type: "progress", text });
  progress("Starting the WebAssembly Python runtime…");
  if (self.location.protocol !== "https:") throw new Error("This check requires HTTPS");
  const started = performance.now();
  const pyodide = await loadPyodide({ indexURL: new URL("./runtime/", import.meta.url).href,
    stdout: () => {}, stderr: () => {} });
  const read = async path => {
    const response = await fetch(new URL(path, import.meta.url), { credentials: "same-origin", redirect: "error" });
    if (!response.ok) throw new Error("A required test artifact could not be loaded");
    return new Uint8Array(await response.arrayBuffer());
  };
  const endpoint = new URL("/qa-xmpp", self.location.href); endpoint.protocol = "wss:";
  const result = await runTransportChecks(pyodide, read, endpoint.href, progress);
  result.environment = "Actual browser module worker and native WebSocket; upstream nbxmpp in WebAssembly; same-origin synthetic peer";
  result.total_elapsed_ms = Math.round(performance.now() - started);
  result.user_agent = navigator.userAgent;
  self.postMessage({ type: "result", result });
} catch {
  // This diagnostic page uses only synthetic credentials. Still keep exception
  // locals, server content and authentication payloads out of the browser UI.
  self.postMessage({ type: "error", text: "Synthetic connection checks did not complete. No pass claimed." });
}
