import { loadPort } from "./port-loader.mjs";

// Optional protocol package; identity workers do not load it or open sockets.
export async function loadProtocol(pyodide, readBytes, progress = () => {}) {
  const { manifest, checked } = await loadPort(pyodide, readBytes, progress);
  const filename = manifest.precis_i18n?.filename;
  if (typeof filename !== "string" || !/^[a-zA-Z0-9_.-]+\.whl$/.test(filename)) {
    throw new Error("Invalid packaged PRECIS dependency");
  }
  progress("Loading pinned nbxmpp protocol code and address-handling dependencies…");
  await pyodide.loadPackage("idna");
  pyodide.unpackArchive(await checked(filename), "zip", { extractDir: "/experiment/protocol" });
  pyodide.unpackArchive(await checked("nbxmpp.zip"), "zip", { extractDir: "/experiment/protocol" });
  await pyodide.runPythonAsync(`
import sys
if "/experiment/protocol" not in sys.path:
    sys.path.insert(0, "/experiment/protocol")
`);
  return { manifest, checked };
}
