// Synthetic test bridge only; not an application messaging API.
function toBase64(bytes) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}

export function fixtureOperation(pyodide, account, action, extra = {}) {
  return async (previous) => {
    const request = { account, action, ...extra };
    if (previous) Object.assign(request, { snapshot: toBase64(previous.snapshot), identity: previous.identity });
    pyodide.globals.set("_storage_request", JSON.stringify(request));
    try {
      const result = JSON.parse(await pyodide.runPythonAsync(
        "from port_tests.storage_fixture import step\nstep(_storage_request)"
      ));
      return { ...result, snapshot: Uint8Array.from(atob(result.snapshot), (character) => character.charCodeAt(0)) };
    } finally { pyodide.globals.delete("_storage_request"); }
  };
}
