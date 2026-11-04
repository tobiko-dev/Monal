import { loadPyodide } from "./runtime/pyodide.mjs";
import { runChecks } from "./checks.mjs";
import { LifecycleFixture } from "./lifecycle-fixture.mjs";

let fixture;
let busy = false;
let release;
const progress = (text) => self.postMessage({ type: "progress", text });

self.onmessage = async ({ data }) => {
  if (data.action === "release") { release?.(); return; }
  if (busy) { self.postMessage({ type: "error", text: "A test operation is already active" }); return; }
  busy = true;
  try {
    if (data.action === "init") {
      if (!self.crypto?.subtle || !self.indexedDB || !navigator.locks) throw new Error("Secure browser storage and Web Locks are required");
      progress("Loading and verifying the WebAssembly runtime…");
      const pyodide = await loadPyodide({ indexURL: new URL("./runtime/", import.meta.url).href });
      const read = async (path) => {
        const response = await fetch(new URL(path, import.meta.url));
        if (!response.ok) throw new Error(`Cannot load test asset: ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      };
      const baseline = await runChecks(pyodide, read, progress);
      if (!baseline.passed) throw new Error("Baseline encryption/storage checks failed");
      fixture = new LifecycleFixture(pyodide, data.run);
      self.postMessage({ type: "ready", baseline: {
        tests: baseline.tests, wheel_sha256: baseline.wheel_sha256,
        port_sha256: baseline.port_sha256, user_agent: navigator.userAgent,
      } });
    } else {
      if (!fixture) throw new Error("Start the test runtime first");
      let result;
      if (data.action === "create") result = await fixture.create();
      else if (data.action === "inspect") result = await fixture.inspect();
      else if (data.action === "exchange") {
        progress("Waiting for the saved identity, then exchanging synthetic ciphertext…");
        result = await fixture.roundTrip({ waitMs: 30000 });
      } else if (data.action === "contend") {
        try {
          await fixture.inspect({ waitMs: 750 });
          throw new Error("No competing owner was holding the test identity");
        } catch (error) {
          if (error.code !== "STORAGE_BUSY") throw error;
          result = { passed: true, competing_operation_blocked: true, lock_not_stolen: true };
        }
      } else if (data.action === "hold") {
        const wait = new Promise((resolve) => { release = resolve; });
        result = await fixture.hold(wait, (report) => self.postMessage({ type: "held", result: report }));
      } else if (data.action === "cleanup") {
        await fixture.cleanup(); result = { cleaned: true };
      } else throw new Error("Unknown test operation");
      self.postMessage({ type: "result", action: data.action, result });
    }
  } catch (error) {
    self.postMessage({ type: "error", action: data.action, text: error.code ?? error.message });
  } finally { busy = false; release = undefined; }
};
