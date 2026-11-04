import { loadProtocol } from "./platform/protocol-loader.mjs";

export async function runProtocolChecks(pyodide, readBytes, progress = () => {}) {
  const started = performance.now();
  const { manifest, checked } = await loadProtocol(pyodide, readBytes, progress);
  pyodide.unpackArchive(await checked("protocol-checks.zip"), "zip", { extractDir: "/experiment/protocol-checks" });
  progress("Running upstream protocol tests, real encrypted XML exchanges and timer checks…");
  const report = JSON.parse(await pyodide.runPythonAsync(`
import json, sys
if "/experiment/protocol-checks" not in sys.path:
    sys.path.insert(0, "/experiment/protocol-checks")
from browser_protocol_tests.runner import run
json.dumps(await run())
`));
  report.pyodide = pyodide.version;
  report.nbxmpp_source = manifest.nbxmpp;
  report.protocol_sha256 = manifest.assets["nbxmpp.zip"];
  report.port_sha256 = manifest.assets["port.zip"];
  report.wheel_sha256 = manifest.assets[manifest.wheel];
  report.elapsed_ms = Math.round(performance.now() - started);
  report.passed &&= report.platform === "emscripten" &&
    report.python === manifest.python && report.pyodide === manifest.pyodide &&
    report.nbxmpp === manifest.nbxmpp.version && report.precis_i18n === manifest.precis_i18n.version &&
    report.upstream.tests === manifest.expected_protocol_upstream_tests &&
    report.browser_adaptation.tests === manifest.expected_protocol_adaptation_tests &&
    report.async_integration.checks.length === manifest.expected_protocol_async_checks;
  return report;
}
