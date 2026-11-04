import { loadProtocol } from "./platform/protocol-loader.mjs";
import { makeSocket, checkedEndpoint } from "./platform/xmpp-websocket.mjs";

export async function runTransportChecks(pyodide, readBytes, endpoint, progress = () => {}) {
  const started = performance.now();
  checkedEndpoint(endpoint);
  const { manifest, checked } = await loadProtocol(pyodide, readBytes, progress);
  pyodide.unpackArchive(await checked("transport-checks.zip"), "zip", { extractDir: "/experiment/transport-checks" });
  progress("Testing actual nbxmpp negotiation over WSS with the synthetic peer…");
  pyodide.registerJsModule("browser_socket", { makeSocket });
  pyodide.globals.set("synthetic_endpoint", endpoint);
  try {
    const report = JSON.parse(await pyodide.runPythonAsync(`
import json, sys
if "/experiment/transport-checks" not in sys.path:
    sys.path.insert(0, "/experiment/transport-checks")
from browser_socket import makeSocket
from browser_transport_tests.fixture import run
json.dumps(await run(makeSocket, synthetic_endpoint))
`));
    report.nbxmpp_source = manifest.nbxmpp;
    report.protocol_sha256 = manifest.assets["nbxmpp.zip"];
    report.port_sha256 = manifest.assets["port.zip"];
    report.fixture_sha256 = manifest.assets["transport-checks.zip"];
    report.elapsed_ms = Math.round(performance.now() - started);
    report.passed &&= report.checks.length === manifest.expected_transport_checks;
    return report;
  } finally {
    pyodide.globals.delete("synthetic_endpoint");
    pyodide.unregisterJsModule("browser_socket");
  }
}
