// Test-only bridge. No transport and no user accounts; do not expose as an app API.
import { SnapshotRepository } from "./platform/snapshot-repository.mjs";

function toBase64(bytes) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}

export async function runStorageChecks(pyodide, options = {}) {
  const indexedDB = options.indexedDB ?? globalThis.indexedDB;
  const database = "gajim-synthetic-test-" + crypto.randomUUID();
  const settings = { ...options, indexedDB, database };
  let repo = new SnapshotRepository(settings);
  const alice = "synthetic-alice";
  const bob = "synthetic-bob";
  const run = (account, action, extra = {}) => async (previous) => {
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
  try {
    const aBundle = await repo.provision(alice, run(alice, "provision"));
    const bBundle = await repo.provision(bob, run(bob, "provision"));
    const aIdentity = (await repo.inspect(alice)).identity;
    const bIdentity = (await repo.inspect(bob)).identity;
    const first = await repo.update(alice, run(alice, "send", { peer: bob, bundle: bBundle }));
    await repo.update(bob, run(bob, "receive", { peer: alice, message: first, bundle: aBundle }));
    // Fresh repository and fresh Python Store/session-manager instances. Actual
    // browser/process restart, storage eviction and tab suspension remain M2 gates.
    repo = new SnapshotRepository(settings);
    const reply = await repo.update(bob, run(bob, "send", { peer: alice }));
    await repo.update(alice, run(alice, "receive", { peer: bob, message: reply, bundle: bBundle }));
    const next = await repo.update(alice, run(alice, "send", { peer: bob }));
    await repo.update(bob, run(bob, "receive", { peer: alice, message: next, bundle: aBundle }));
    if (JSON.stringify((await repo.inspect(alice)).identity) !== JSON.stringify(aIdentity) ||
        JSON.stringify((await repo.inspect(bob)).identity) !== JSON.stringify(bIdentity)) {
      throw new Error("Synthetic identity changed during storage reconstruction");
    }
    return { passed: true, encrypted_exchanges: 3, identity_preserved: true,
      fixture: "Gajim SQLite snapshots with explicit synthetic trust" };
  } finally {
    // Delete only this invocation's randomly named synthetic fixture database.
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(database);
      request.onsuccess = resolve;
      request.onerror = () => reject(new Error("Synthetic database cleanup failed"));
      request.onblocked = () => reject(new Error("Synthetic database cleanup blocked"));
    });
  }
}
