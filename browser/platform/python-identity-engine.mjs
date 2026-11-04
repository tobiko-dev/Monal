import { IdentityFailure } from "./identity-protocol.mjs";

function encode(bytes) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}

// Owned by one serialized worker. No caller-supplied Python is executed.
export class PythonIdentityEngine {
  constructor(pyodide) { this.pyodide = pyodide; }

  async #step(request) {
    this.pyodide.globals.set("_identity_request", JSON.stringify(request));
    try {
      const value = JSON.parse(await this.pyodide.runPythonAsync(
        "from gajim_browser.identity import step\nstep(_identity_request)"
      ));
      if (value.error) throw new IdentityFailure(value.error);
      return value;
    } finally { this.pyodide.globals.delete("_identity_request"); }
  }

  async create(account) {
    const result = await this.#step({ action: "create", account });
    return { identity: result.identity,
      snapshot: Uint8Array.from(atob(result.snapshot), (c) => c.charCodeAt(0)) };
  }

  async open(account, previous) {
    return (await this.#step({ action: "open", account,
      snapshot: encode(previous.snapshot), identity: previous.identity })).identity;
  }
}
