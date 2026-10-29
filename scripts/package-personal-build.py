#!/usr/bin/env python3
"""Validate an unsigned iphoneos archive and package it for local resigning."""
import hashlib
import json
import plistlib
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

archive, output = map(Path, sys.argv[1:])
app = archive / "Products/Applications/Monal.app"
with (app / "Info.plist").open("rb") as stream:
    info = plistlib.load(stream)
if info["CFBundleIdentifier"] != "dev.tobiko.monal.personal":
    raise SystemExit("Refusing to package an app with the upstream bundle identifier")
if info.get("CFBundleDisplayName") != "Monal (modified)":
    raise SystemExit("Expected the distinct Monal (modified) Home Screen name")
if 2 not in info["UIDeviceFamily"] or info.get("CFBundleSupportedPlatforms") != ["iPhoneOS"]:
    raise SystemExit("Expected an iPad-compatible device build")
if list(app.glob("PlugIns/*.appex")) or (app / "embedded.mobileprovision").exists():
    raise SystemExit("Expected an unsigned, extension-free personal app")
if {"remote-notification", "voip"} & set(info.get("UIBackgroundModes", [])):
    raise SystemExit("Unexpected push background modes")

# Validate the actual Mach-O platform, not just Info.plist. Simulator arm64
# binaries cannot run on an iPad even though they use the same CPU architecture.
binary = (app / info["CFBundleExecutable"]).read_bytes()
magic, cpu, _, _, commands, _, _, _ = struct.unpack_from("<8I", binary)
if magic != 0xFEEDFACF or cpu != 0x0100000C:
    raise SystemExit("Expected a thin arm64 executable")
offset = 32
platform = None
for _ in range(commands):
    command, size = struct.unpack_from("<II", binary, offset)
    if command == 0x32:  # LC_BUILD_VERSION
        platform = struct.unpack_from("<I", binary, offset + 8)[0]
    if command == 0x2C and struct.unpack_from("<I", binary, offset + 16)[0] != 0:
        raise SystemExit("Unexpected encrypted executable")
    offset += size
if platform != 2:  # PLATFORM_IOS, not PLATFORM_IOSSIMULATOR (7)
    raise SystemExit(f"Expected iOS device platform, found {platform}")

output.mkdir(parents=True, exist_ok=True)
ipa = output.resolve() / "Monal-Modified-unsigned.ipa"
with tempfile.TemporaryDirectory() as temporary:
    payload = Path(temporary) / "Payload"
    payload.mkdir()
    subprocess.run(["ditto", str(app), str(payload / app.name)], check=True)
    subprocess.run(["ditto", "-c", "-k", "--keepParent", str(payload), str(ipa)], check=True)
digest = hashlib.sha256(ipa.read_bytes()).hexdigest()
(output / "SHA256SUMS.txt").write_text(f"{digest}  {ipa.name}\n")
(output / "build-info.json").write_text(json.dumps({
    "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    "bundle_identifier": info["CFBundleIdentifier"],
    "build": info["CFBundleVersion"],
    "minimum_ios": info["MinimumOSVersion"],
    "architecture": "arm64",
    "platform": "iPhoneOS",
    "signing": "unsigned; must be signed locally by SideStore or another personal installer",
    "sha256": digest,
}, indent=2) + "\n")
print(f"Packaged {ipa.name}: {ipa.stat().st_size:,} bytes, SHA-256 {digest}")
