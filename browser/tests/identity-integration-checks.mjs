import assert from "node:assert/strict";
import { SnapshotRepository } from "../platform/snapshot-repository.mjs";
import { IdentityService } from "../platform/identity-service.mjs";
import { PythonIdentityEngine } from "../platform/python-identity-engine.mjs";
import { fixtureOperation } from "../dist/fixture-bridge.mjs";

export async function checkIdentityIntegration(pyodide, options) {
  const database = "identity-integration-" + crypto.randomUUID();
  const repo = new SnapshotRepository({ ...options, database });
  const service = () => new IdentityService(repo, new PythonIdentityEngine(pyodide));
  const a = "synthetic-alice", b = "synthetic-bob";
  await assert.rejects(service().open(a), (e) => e.code === "MISSING_IDENTITY");
  const created = await service().create(a);
  await assert.rejects(service().create(a), (e) => e.code === "IDENTITY_EXISTS");
  const bBundle = await repo.provision(b, fixtureOperation(pyodide, b, "provision"));
  // Read the public bundle inside the test runtime; never expose the snapshot.
  const aBundle = await repo.read(a, async (previous) => {
    const encode = (bytes) => Buffer.from(bytes).toString("base64");
    pyodide.globals.set("_test_identity_snapshot", encode(previous.snapshot));
    try {
      return JSON.parse(await pyodide.runPythonAsync(`
import base64, json
from dataclasses import asdict
from port_tests.storage_fixture import encode
from gajim_browser.identity import CONFIG
from gajim_browser.storage import SnapshotStorage
from omemo_dr.session_manager import OMEMOSessionManager
from omemo_dr.const import NS_OMEMO_TMP
def public_bundle():
    store = SnapshotStorage.open_existing("synthetic-alice", base64.b64decode(_test_identity_snapshot))
    try:
        return json.dumps(encode(asdict(OMEMOSessionManager("synthetic-alice", store, CONFIG).get_bundle(NS_OMEMO_TMP))))
    finally:
        store.close()
public_bundle()
`));
    } finally { pyodide.globals.delete("_test_identity_snapshot"); }
  });
  for (let turn = 0; turn < 2; turn++) {
    const outgoing = await repo.update(a, fixtureOperation(pyodide, a, "send", { peer: b, ...(turn === 0 ? { bundle: bBundle } : {}) }));
    await repo.update(b, fixtureOperation(pyodide, b, "receive", { peer: a, message: outgoing, bundle: aBundle }));
    const reply = await repo.update(b, fixtureOperation(pyodide, b, "send", { peer: a }));
    await repo.update(a, fixtureOperation(pyodide, a, "receive", { peer: b, message: reply, bundle: bBundle }));
    const opened = await service().open(a);
    assert.deepEqual(opened.identity, created.identity);
    assert.equal(opened.revision, 3 + turn * 2);
  }
  return { passed: true, encrypted_exchanges: 4, identity_preserved: true,
    creation_prekeys: 100, opened_revision: 5,
    environment: "Application service/Python bridge in Node WASM with simulated IndexedDB; not a browser worker test" };
}
