import { loadPyodide } from "../runtime/pyodide.mjs";
import { loadPort } from "./port-loader.mjs";
import { PythonIdentityEngine } from "./python-identity-engine.mjs";
import { IdentityFailure } from "./identity-protocol.mjs";

export async function loadIdentityEngine() {
  try {
    const root = new URL("../", import.meta.url);
    const pyodide = await loadPyodide({ indexURL: new URL("runtime/", root).href,
      stdout: () => {}, stderr: () => {} });
    const read = async (name) => {
      const response = await fetch(new URL(name, root), { credentials: "same-origin", redirect: "error" });
      if (!response.ok) throw new Error("Runtime asset unavailable");
      return new Uint8Array(await response.arrayBuffer());
    };
    await loadPort(pyodide, read);
    return new PythonIdentityEngine(pyodide);
  } catch { throw new IdentityFailure("RUNTIME_FAILED"); }
}
