// Identical checks are used by the browser worker and Node WebAssembly runner.
export async function runChecks(pyodide, readBytes, progress = () => {}) {
  const started = performance.now();
  const manifest = JSON.parse(new TextDecoder().decode(await readBytes("manifest.json")));
  const checked = async (name) => {
    const bytes = await readBytes(name);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hash = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
    if (hash !== manifest.assets[name]) throw new Error(`Integrity check failed: ${name}`);
    return bytes;
  };
  progress("Loading the pinned cryptography and protobuf packages…");
  await pyodide.loadPackage(["cryptography", "protobuf"]);
  pyodide.unpackArchive(await checked(manifest.wheel), "zip", { extractDir: "/experiment/site" });
  pyodide.unpackArchive(await checked("checks.zip"), "zip", { extractDir: "/experiment/checks" });
  pyodide.unpackArchive(await checked("port.zip"), "zip", { extractDir: "/experiment/site" });
  progress("Running upstream encryption and Gajim storage checks…");
  const report = JSON.parse(await pyodide.runPythonAsync(`
import io, json, logging, platform, sys, unittest
sys.path[:0] = ["/experiment/site", "/experiment/checks"]
logging.disable(logging.CRITICAL)  # Synthetic test output never needs keys or bodies.
import omemo_dr._curve as curve
from importlib.metadata import version
suite = unittest.TestSuite([
    unittest.defaultTestLoader.discover("/experiment/checks/tests", top_level_dir="/experiment/checks"),
    unittest.defaultTestLoader.discover("/experiment/checks/port_tests", top_level_dir="/experiment/checks"),
])
output = io.StringIO()
result = unittest.TextTestRunner(stream=output, verbosity=2).run(suite)
json.dumps({
    "platform": sys.platform, "python": platform.python_version(),
    "curve_module": curve.__file__, "omemo_dr": version("omemo-dr"),
    "cryptography": version("cryptography"), "protobuf": version("protobuf"),
    "tests": result.testsRun, "failures": len(result.failures),
    "errors": len(result.errors), "skipped": len(result.skipped),
    "passed": result.wasSuccessful() and not result.skipped,
    "output": output.getvalue(),
})
`));
  report.elapsed_ms = Math.round(performance.now() - started);
  report.pyodide = pyodide.version;
  report.source_sha256 = manifest.source_sha256;
  report.wheel_sha256 = manifest.assets[manifest.wheel];
  report.gajim_storage = manifest.gajim_storage;
  report.port_sha256 = manifest.assets["port.zip"];
  report.passed = report.passed && report.platform === "emscripten" &&
    report.pyodide === manifest.pyodide && report.python === manifest.python &&
    report.tests === manifest.expected_python_tests;
  return report;
}
