// A bounded compatibility investigation, not a networking implementation or test pass.
// Usage: node browser/scripts/probe-nbxmpp.mjs /path/to/python-nbxmpp [report.json]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "../dist/runtime/pyodide.mjs";

async function main() {
  const commit = "999ce8859d6d799fe8ce00a877e85b2ae554e392";
  const [checkout, reportPath] = process.argv.slice(2);
  if (!checkout) throw new Error("Supply a local python-nbxmpp Git checkout containing the pinned commit");
  const git = (...args) => execFileSync("git", ["-C", checkout, ...args], { maxBuffer: 16 * 1024 * 1024 });
  const pin = git("rev-parse", `${commit}^{commit}`).toString().trim();
  if (pin !== commit) throw new Error("Upstream commit mismatch");

  // Read committed Git objects only: worktree edits/untracked files cannot enter the probe.
  const archive = git("archive", "--format=tar", commit, "nbxmpp", "test/unit", "COPYING", "pyproject.toml");
  const versions = JSON.parse(await readFile(new URL("../versions.json", import.meta.url), "utf8"));
  let completed = false;
  process.on("exit", () => { if (!completed) process.exitCode = 1; });
  const pyodide = await loadPyodide({ indexURL: fileURLToPath(new URL("../dist/runtime/", import.meta.url)) });
  if (pyodide.version !== versions.pyodide) throw new Error("Pyodide version mismatch");
  pyodide.unpackArchive(new Uint8Array(archive), "tar", { extractDir: "/nbxmpp-probe" });
  const findings = JSON.parse(await pyodide.runPythonAsync(`
import ast
import hashlib
import importlib
import json
from pathlib import Path
import sys

root = Path('/nbxmpp-probe')
sources = sorted((root / 'nbxmpp').rglob('*.py'))
desktop_dependencies = []
for path in sources:
    tree = ast.parse(path.read_bytes(), filename=str(path))
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend({'line': node.lineno, 'module': item.name}
                           for item in node.names if item.name == 'gi' or item.name.startswith('gi.'))
        elif isinstance(node, ast.ImportFrom) and (node.module or '').startswith('gi.'):
            imports.append({'line': node.lineno, 'module': node.module,
                            'names': [item.name for item in node.names]})
    if imports:
        desktop_dependencies.append({'path': str(path.relative_to(root)),
                                     'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                     'imports': sorted(imports, key=lambda item: item['line'])})

sys.path.insert(0, str(root))
try:
    importlib.import_module('nbxmpp.client')
except ModuleNotFoundError as error:
    probe = {'imported': False, 'error_type': type(error).__name__, 'missing_module': error.name}
else:
    probe = {'imported': True}

json.dumps({'platform': sys.platform, 'python': sys.version.split()[0],
            'source_module_count': len(sources),
            'desktop_dependencies': desktop_dependencies,
            'import_probe': probe,
            'upstream_regression_sources': [
                {'path': str(path.relative_to(root)),
                 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
                for path in sorted((root / 'test/unit').glob('test_*.py'))]})
  `));
  const blocked = findings.import_probe.imported === false && findings.import_probe.missing_module === "gi";
  const report = {
    purpose: "Unmodified nbxmpp import probe and static desktop-dependency inventory",
    source: { repository: "https://github.com/gajim/python-nbxmpp", commit,
      archive_sha256: createHash("sha256").update(archive).digest("hex") },
    environment: `Node ${process.version} with Pyodide ${pyodide.version}; not a Safari or network test`,
    status: blocked ? "blocked_by_desktop_dependency" : "unexpected_result_requires_review",
    ...findings,
    limits: ["GI-dependent paths were inspected, not ported or executed.",
      "No upstream regression tests were run by this probe; listed test files are the next port's inputs.",
      "The first import failure does not identify every subsequent runtime dependency.",
      "No socket, account sign-in, key publication or contact message."],
  };
  const serialized = JSON.stringify(report, null, 2) + "\n";
  if (reportPath) await writeFile(reportPath, serialized);
  console.log(JSON.stringify({ status: report.status, source_module_count: findings.source_module_count,
    desktop_dependent_modules: findings.desktop_dependencies.length, import_probe: findings.import_probe,
    report_written: Boolean(reportPath) }));
  completed = true;
  if (!blocked) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
