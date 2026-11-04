// Shared application/test loader. Runtime assets are packaged on the same origin.
export async function loadPort(pyodide, readBytes, progress = () => {}) {
  const manifest = JSON.parse(new TextDecoder().decode(await readBytes("manifest.json")));
  if (pyodide.version !== manifest.pyodide) throw new Error("Unexpected Python runtime");
  const checked = async (name) => {
    const bytes = await readBytes(name);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hash = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
    if (hash !== manifest.assets[name]) throw new Error(`Integrity check failed: ${name}`);
    return bytes;
  };
  if (typeof manifest.wheel !== "string" || !/^[a-zA-Z0-9_.-]+\.whl$/.test(manifest.wheel)) {
    throw new Error("Invalid packaged wheel");
  }
  progress("Loading the pinned cryptography and protobuf packages…");
  await pyodide.loadPackage(["cryptography", "protobuf"]);
  pyodide.unpackArchive(await checked(manifest.wheel), "zip", { extractDir: "/experiment/site" });
  pyodide.unpackArchive(await checked("port.zip"), "zip", { extractDir: "/experiment/site" });
  await pyodide.runPythonAsync(`
import logging, sys
if "/experiment/site" not in sys.path:
    sys.path.insert(0, "/experiment/site")
logging.disable(logging.CRITICAL)
`);
  return { manifest, checked };
}
