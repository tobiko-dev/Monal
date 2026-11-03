// Simulated IndexedDB + Node's Web Locks implementation. These are not Safari tests.
import test from "node:test";
import assert from "node:assert/strict";
import { locks } from "node:worker_threads";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { SnapshotRepository } from "../platform/snapshot-repository.mjs";

const identity = { device_id: 7, fingerprint: "ab".repeat(32) };
const initial = () => ({ identity: { ...identity }, snapshot: new Uint8Array([0]), result: "created" });
const code = (expected) => (error) => error.code === expected;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function fixture() {
  const indexedDB = new IDBFactory();
  const database = "synthetic-" + crypto.randomUUID();
  const options = { indexedDB, locks, database };
  return { repo: new SnapshotRepository(options), another: () => new SnapshotRepository(options), indexedDB, database };
}

async function rawChange(f, change) {
  const db = await new Promise((resolve, reject) => {
    const request = f.indexedDB.open(f.database, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
      const store = tx.objectStore("snapshots");
      const request = store.get("alice");
      request.onsuccess = () => store.put(change(request.result));
    });
  } finally { db.close(); }
}

test("reopening a repository preserves identity and committed bytes", async () => {
  const f = fixture();
  assert.equal(await f.repo.provision("alice", initial), "created");
  assert.deepEqual(await f.another().inspect("alice"), { identity, revision: 1 });
  await f.another().update("alice", (previous) => {
    assert.deepEqual(previous.snapshot, new Uint8Array([0]));
    return { ...previous, snapshot: new Uint8Array([1]) };
  });
  assert.equal((await f.repo.inspect("alice")).revision, 2);
});

test("missing state does not call a key-generation callback", async () => {
  const f = fixture();
  await assert.rejects(f.repo.update("alice", () => assert.fail("must not generate keys")), code("MISSING_IDENTITY"));
});

test("provision cannot replace an existing identity", async () => {
  const f = fixture();
  await f.repo.provision("alice", initial);
  await assert.rejects(f.repo.provision("alice", () => assert.fail("must not replace keys")), code("IDENTITY_EXISTS"));
});

test("competing repository instances serialize whole read/modify/commit operations", async () => {
  const f = fixture();
  await f.repo.provision("alice", initial);
  let active = 0;
  const values = await Promise.all(Array.from({ length: 8 }, () => f.another().update("alice", async (previous) => {
    assert.equal(active++, 0);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const value = previous.snapshot[0] + 1;
    active--;
    return { ...previous, snapshot: new Uint8Array([value]), result: value };
  })));
  assert.deepEqual(values, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal((await f.repo.inspect("alice")).revision, 9);
});

test("a failed crypto operation discards its working copy", async () => {
  const f = fixture();
  await f.repo.provision("alice", initial);
  await assert.rejects(f.repo.update("alice", (previous) => {
    previous.snapshot[0] = 200;
    throw new Error("synthetic crypto failure");
  }), /synthetic crypto failure/);
  await f.repo.update("alice", (previous) => {
    assert.equal(previous.snapshot[0], 0);
    assert.equal(previous.revision, 1);
    return previous;
  });
});

test("put success followed by transaction abort does not release the operation result", async () => {
  const f = fixture();
  await f.repo.provision("alice", initial);
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = put.apply(this, args);
    request.addEventListener("success", () => this.transaction.abort());
    return request;
  };
  try {
    await assert.rejects(f.repo.update("alice", (previous) => ({
      ...previous, snapshot: new Uint8Array([1]), result: "must not escape",
    })), code("STORAGE_WRITE_FAILED"));
  } finally { IDBObjectStore.prototype.put = put; }
  assert.equal((await f.repo.inspect("alice")).revision, 1);
});

test("quota failure leaves the previous state intact", async () => {
  const f = fixture();
  await f.repo.provision("alice", initial);
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = () => { throw new DOMException("synthetic quota", "QuotaExceededError"); };
  try {
    await assert.rejects(f.repo.update("alice", (previous) => previous), code("STORAGE_WRITE_FAILED"));
  } finally { IDBObjectStore.prototype.put = put; }
  assert.equal((await f.repo.inspect("alice")).revision, 1);
});

test("denied IndexedDB access blocks the operation before generating keys", async () => {
  const repo = new SnapshotRepository({ locks, indexedDB: {
    open() { throw new DOMException("synthetic denial", "SecurityError"); },
  } });
  await assert.rejects(repo.provision("alice", () => assert.fail("must not generate keys")), code("STORAGE_UNAVAILABLE"));
});

test("damaged bytes block both updates and reprovisioning", async () => {
  const f = fixture();
  await f.repo.provision("alice", initial);
  await rawChange(f, (record) => ({ ...record, snapshot: new Uint8Array([42]) }));
  await assert.rejects(f.repo.inspect("alice"), code("CORRUPT_STATE"));
  await assert.rejects(f.repo.update("alice", () => assert.fail("must not run")), code("CORRUPT_STATE"));
  await assert.rejects(f.repo.provision("alice", () => assert.fail("must not rotate")), code("CORRUPT_STATE"));
});

test("an update cannot rotate the identity", async () => {
  const f = fixture();
  await f.repo.provision("alice", initial);
  await assert.rejects(f.repo.update("alice", (previous) => ({
    ...previous, identity: { ...identity, device_id: 8 },
  })), code("IDENTITY_CHANGED"));
  assert.deepEqual(await f.repo.inspect("alice"), { identity, revision: 1 });
});

test("compare-and-swap rejects a writer that bypassed the account lock", async () => {
  const f = fixture();
  await f.repo.provision("alice", initial);
  await assert.rejects(f.repo.update("alice", async (previous) => {
    await rawChange(f, (record) => ({ ...record, revision: record.revision + 1 }));
    return previous;
  }), code("STALE_STATE"));
  assert.equal((await f.repo.inspect("alice")).revision, 2);
});

test("lock timeout never steals ownership; a later attempt succeeds", async () => {
  const f = fixture();
  await f.repo.provision("alice", initial);
  const entered = deferred();
  const release = deferred();
  const first = f.repo.update("alice", async (previous) => {
    entered.resolve();
    await release.promise;
    return previous;
  });
  await entered.promise;
  try {
    await assert.rejects(f.another().update("alice", () => assert.fail("must not steal lock"), { waitMs: 10 }), code("STORAGE_BUSY"));
  } finally { release.resolve(); await first; }
  assert.equal((await f.another().inspect("alice")).revision, 2);
});

test("an aborted acquisition never starts a crypto operation", async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.repo.provision("alice", () => assert.fail("must not run"), { signal: controller.signal }), code("STORAGE_BUSY"));
});

test("missing locking capability has no unsafe localStorage fallback", () => {
  assert.throws(() => new SnapshotRepository({ indexedDB: new IDBFactory(), locks: null }), code("STORAGE_UNAVAILABLE"));
});

test("accounts use separate state records", async () => {
  const f = fixture();
  await f.repo.provision("alice", initial);
  await f.repo.provision("bob", () => ({ ...initial(), identity: { ...identity, device_id: 9 } }));
  assert.equal((await f.repo.inspect("alice")).identity.device_id, 7);
  assert.equal((await f.repo.inspect("bob")).identity.device_id, 9);
});

test("invalid or oversized snapshots are rejected before commit", async () => {
  const f = fixture();
  for (const snapshot of [new Uint8Array(), new Uint8Array(32 * 1024 * 1024 + 1), "plaintext"]) {
    await assert.rejects(f.repo.provision("alice", () => ({ ...initial(), snapshot })), code("INVALID_CHANGE"));
  }
  await assert.rejects(f.repo.inspect("alice"), code("MISSING_IDENTITY"));
});
