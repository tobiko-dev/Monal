"""Build a same-origin, synthetic-only OMEMO WebAssembly test harness.

Run with the pinned Python build environment. No upstream source is modified.
Runtime downloads occur at build time; the served harness only requests itself.
"""

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PINS = json.loads((ROOT / "versions.json").read_text())
WORK = ROOT / ".build"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def verify(data, expected, label):
    if sha256(data) != expected:
        raise RuntimeError(f"SHA-256 mismatch for {label}")
    return data


def fetch(url, expected, cache):
    if cache.exists():
        return verify(cache.read_bytes(), expected, cache.name)
    with urllib.request.urlopen(url, timeout=120) as response:
        data = verify(response.read(), expected, cache.name)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(data)
    return data


def command(args, **kwargs):
    subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def config(pyodide, name):
    return subprocess.check_output([str(pyodide), "config", "get", name], text=True).strip().strip('"')


def add_zip(archive, name, data):
    # Fixed timestamps keep the fixture archive reproducible.
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, data)


def build(source_archive=None):
    if f"{sys.version_info.major}.{sys.version_info.minor}" != PINS["host_python"]:
        raise RuntimeError("Use Python " + PINS["host_python"])
    for name, expected in [("pyodide-build", PINS["pyodide_build"]), ("setuptools", PINS["setuptools"])]:
        if importlib.metadata.version(name) != expected:
            raise RuntimeError(f"Install the pinned {name}=={expected}")
    pyodide = Path(sys.executable).parent / "pyodide"
    WORK.mkdir(exist_ok=True)
    command([pyodide, "xbuildenv", "install", PINS["pyodide"]])
    for name, expected in [("python_version", PINS["runtime_python"]), ("emscripten_version", PINS["emscripten"]), ("pyodide_abi_version", PINS["abi"])]:
        if config(pyodide, name) != expected:
            raise RuntimeError(f"Wrong cross-build environment: {name}")

    source_pin = PINS["source"]
    archive_path = WORK / "downloads" / "omemo_dr-1.2.0.tar.gz"
    if source_archive:
        archive = verify(Path(source_archive).read_bytes(), source_pin["sha256"], "source archive")
    else:
        archive = fetch(source_pin["url"], source_pin["sha256"], archive_path)

    with tempfile.TemporaryDirectory(prefix="build-", dir=WORK) as temp:
        temp = Path(temp)
        source_tar = temp / "source.tar.gz"
        source_tar.write_bytes(archive)
        with tarfile.open(source_tar) as tar:
            tar.extractall(temp, filter="data")
        source = temp / "omemo_dr-1.2.0"
        wheels = temp / "wheels"
        env = os.environ.copy()
        # Compiler wrappers use /usr/bin/env python; it must match the build host.
        env["PATH"] = str(pyodide.parent) + os.pathsep + env.get("PATH", "")
        env["SOURCE_DATE_EPOCH"] = "315532800"
        # Root in a user-namespaced container cannot restore archive owners.
        env["TAR_OPTIONS"] = (env.get("TAR_OPTIONS", "") + " --no-same-owner").strip()
        with (WORK / "compiler.log").open("w") as log:
            command([pyodide, "build", source, "--no-isolation", "--outdir", wheels], env=env, stdout=log, stderr=subprocess.STDOUT)
        wheel_files = list(wheels.glob("*.whl"))
        if len(wheel_files) != 1:
            raise RuntimeError("Expected exactly one output wheel")
        wheel = wheel_files[0]
        if not wheel.name.endswith("cp314-cp314-pyemscripten_2026_0_wasm32.whl"):
            raise RuntimeError("Unexpected wheel ABI: " + wheel.name)
        with zipfile.ZipFile(wheel) as z:
            extensions = [name for name in z.namelist() if name.endswith(".so")]
            if len(extensions) != 1 or not z.read(extensions[0]).startswith(b"\0asm"):
                raise RuntimeError("The curve extension is not WebAssembly")

        stage = temp / "dist"
        shutil.copytree(ROOT / "harness", stage)
        (stage / "runtime").mkdir()
        (stage / "licenses").mkdir()
        (stage / "source").mkdir()
        (stage / "source" / "omemo_dr-1.2.0.tar.gz").write_bytes(archive)
        shutil.copy2(source / "LICENSE", stage / "licenses" / "omemo-dr-GPL-3.0.txt")
        shutil.copy2(ROOT / "licenses" / "Pyodide-MPL-2.0.txt", stage / "licenses" / "Pyodide-MPL-2.0.txt")
        shutil.copy2(wheel, stage / wheel.name)
        with zipfile.ZipFile(stage / "checks.zip", "w") as z:
            for path in sorted((source / "tests").rglob("*.py")):
                add_zip(z, path.relative_to(source).as_posix(), path.read_bytes())
            add_zip(z, "port_tests/__init__.py", b"")
            add_zip(z, "port_tests/test_browser_crypto.py", (ROOT / "tests" / "test_browser_crypto.py").read_bytes())

        runtime = Path(config(pyodide, "dist_dir"))
        for name, expected in PINS["runtime_assets"].items():
            data = verify((runtime / name).read_bytes(), expected, name)
            (stage / "runtime" / name).write_bytes(data)
        lock = json.loads((stage / "runtime" / "pyodide-lock.json").read_text())
        queue = ["cryptography", "protobuf"]
        seen = set()
        dependency_versions = {}
        while queue:
            name = queue.pop()
            if name in seen:
                continue
            seen.add(name)
            package = lock["packages"][name]
            queue.extend(package["depends"])
            dependency_versions[name] = package["version"]
            filename = package["file_name"]
            url = f"https://cdn.jsdelivr.net/pyodide/v{PINS['pyodide']}/full/{filename}"
            data = fetch(url, package["sha256"], WORK / "downloads" / filename)
            (stage / "runtime" / filename).write_bytes(data)

        assets = {path.relative_to(stage).as_posix(): sha256(path.read_bytes()) for path in sorted(stage.rglob("*")) if path.is_file()}
        manifest = {
            "pyodide": PINS["pyodide"], "python": PINS["runtime_python"],
            "emscripten": PINS["emscripten"], "source_sha256": source_pin["sha256"],
            "wheel": wheel.name, "dependencies": dependency_versions,
            "assets": assets, "upstream_patches": [],
        }
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        # Replace only generated output after every check/download succeeds.
        output = ROOT / "dist"
        if output.exists():
            shutil.rmtree(output)
        shutil.copytree(stage, output)
        print(json.dumps({"output": str(output), "wheel": wheel.name, "files": len(assets), "bytes": sum(p.stat().st_size for p in output.rglob("*") if p.is_file())}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-archive", type=Path, help="Use an already downloaded archive; its pinned hash is still checked")
    args = parser.parse_args()
    build(args.source_archive)
