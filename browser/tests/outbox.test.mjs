// Simulated IndexedDB, real Node Web Locks. Actual crypto is tested separately.
import test from "node:test";
import assert from "node:assert/strict";
import { locks } from "node:worker_threads";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { SnapshotRepository } from "../platform/snapshot-repository.mjs";
import { OutboxService } from "../platform/outbox-service.mjs";
import { PreparationBlocked, OUTBOX_LIMIT, TEXT_LIMIT, PAYLOAD_LIMIT } from "../platform/outbox-model.mjs";

const identity = { device_id: 7, fingerprint: "ab".repeat(32) };
const initial = () => ({ identity: { ...identity }, snapshot: new Uint8Array([0]) });
const code = (expected) => (error) => error.code === expected;
const draft = (extra = {}) => ({ id: crypto.randomUUID(), conversation: "synthetic-bob", text: "Synthetic queued text", ...extra });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

async function fixture() {
  const indexedDB = new IDBFactory(), database = "outbox-" + crypto.randomUUID();
  const settings = { indexedDB, locks, database };
  const repo = new SnapshotRepository(settings);
  await repo.provision("alice", initial);
  let calls = 0;
  const engine = { async prepare(account, saved) {
    calls++;
    saved.snapshot[0]++;
    return { ...saved, format: "synthetic-test", ciphertext: new Uint8Array([saved.snapshot[0], 9]) };
  } };
  const service = (override = engine) => new OutboxService(new SnapshotRepository(settings), override, { now: () => 10 });
  return { repo, service, settings, indexedDB, database, calls: () => calls };
}

async function mutate(f, name, change) {
  const db = await new Promise((resolve, reject) => {
    const request = f.indexedDB.open(f.database);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(name, "readwrite"), store = tx.objectStore(name), request = store.get("alice");
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      request.onsuccess = () => {
        const next = change(request.result);
        if (next === undefined) store.delete("alice"); else store.put(next);
      };
    });
  } finally { db.close(); }
}

test("acknowledged enqueue survives reopening without advancing the crypto revision", async () => {
  const f = await fixture(), message = draft();
  const queued = await f.service().enqueue("alice", message);
  assert.equal(queued.state, "queued");
  assert.deepEqual(await f.service().list("alice"), [queued]);
  assert.equal((await f.repo.inspect("alice")).revision, 1);
  assert.equal(f.calls(), 0);
});

test("same intent and ID is idempotent, including concurrent enqueue", async () => {
  const f = await fixture(), message = draft();
  const results = await Promise.all(Array.from({ length: 6 }, () => f.service().enqueue("alice", message)));
  assert.ok(results.every((value) => value.id === message.id));
  assert.equal((await f.service().list("alice")).length, 1);
});

test("conflicting ID reuse rejects body and conversation changes", async () => {
  const f = await fixture(), message = draft();
  await f.service().enqueue("alice", message);
  for (const change of [{ text: "different" }, { conversation: "different" }]) {
    await assert.rejects(f.service().enqueue("alice", { ...message, ...change }), code("MESSAGE_CONFLICT"));
  }
  assert.equal((await f.service().list("alice"))[0].text, message.text);
});

test("identical bodies with different IDs remain separate ordered messages", async () => {
  const f = await fixture(), first = draft(), second = draft();
  await f.service().enqueue("alice", first); await f.service().enqueue("alice", second);
  await assert.rejects(f.service().prepare("alice", second.id), code("EARLIER_MESSAGE_PENDING"));
  await f.service().prepare("alice", first.id); await f.service().prepare("alice", second.id);
  assert.deepEqual((await f.service().list("alice")).map((entry) => entry.id), [first.id, second.id]);
  assert.equal((await f.repo.inspect("alice")).revision, 3);
});

test("intent is captured before caller mutation while waiting for a lock", async () => {
  const f = await fixture(), message = draft(), old = { ...message }, held = deferred(), release = deferred();
  const owner = f.repo.read("alice", async () => { held.resolve(); await release.promise; });
  await held.promise;
  const pending = f.service().enqueue("alice", message);
  message.text = "changed after submission"; message.conversation = "another-person";
  release.resolve(); await owner;
  assert.equal((await pending).text, old.text);
  assert.equal((await f.service().list("alice"))[0].conversation, old.conversation);
});

test("prepared ciphertext and session commit together; UI results contain neither", async () => {
  const f = await fixture(), message = draft();
  await f.service().enqueue("alice", message);
  const prepared = await f.service().prepare("alice", message.id);
  assert.equal(prepared.state, "prepared");
  assert.equal("prepared" in prepared, false); assert.equal("snapshot" in prepared, false);
  await f.repo.readOutbox("alice", (saved) => {
    assert.equal(saved.revision, 2); assert.equal(saved.snapshot[0], 1);
    assert.deepEqual(saved.entries[0].prepared, { format: "synthetic-test", base64: "AQk=" });
  });
});

test("lost reply after commit recovers the same payload without re-encrypting", async () => {
  const f = await fixture(), message = draft();
  await f.service().enqueue("alice", message);
  await f.service().prepare("alice", message.id); // Simulate caller discarding the successful reply.
  const before = await f.repo.readOutbox("alice", (saved) => saved);
  const resumed = f.service({ prepare() { assert.fail("must not encrypt committed work again"); } });
  await resumed.enqueue("alice", message);
  await resumed.prepare("alice", message.id);
  assert.deepEqual(await f.repo.readOutbox("alice", (saved) => saved), before);
  assert.equal(f.calls(), 1);
});

test("competing preparations of one ID execute encryption only once", async () => {
  const f = await fixture(), message = draft();
  await f.service().enqueue("alice", message);
  await Promise.all([f.service().prepare("alice", message.id), f.service().prepare("alice", message.id)]);
  assert.equal(f.calls(), 1); assert.equal((await f.repo.inspect("alice")).revision, 2);
});

test("known key failure persists blocked text, discards crypto changes and permits deliberate retry", async () => {
  const f = await fixture(), message = draft();
  await f.service().enqueue("alice", message);
  const blocked = await f.service({ prepare(account, saved) {
    saved.snapshot[0] = 55; throw new PreparationBlocked("UNVERIFIED_KEYS");
  } }).prepare("alice", message.id);
  assert.equal(blocked.state, "blocked"); assert.equal(blocked.error, "UNVERIFIED_KEYS");
  assert.equal((await f.service().list("alice"))[0].text, message.text);
  assert.equal(await f.repo.read("alice", (saved) => saved.snapshot[0]), 0);
  assert.equal((await f.service().prepare("alice", message.id)).state, "prepared");
});

test("one blocked conversation does not block another conversation", async () => {
  const f = await fixture(), first = draft(), second = draft({ conversation: "synthetic-carol" });
  await f.service().enqueue("alice", first); await f.service().enqueue("alice", second);
  await f.service({ prepare() { throw new PreparationBlocked("MISSING_KEYS"); } }).prepare("alice", first.id);
  assert.equal((await f.service().prepare("alice", second.id)).state, "prepared");
});

test("unexpected encryption exceptions do not persist raw errors or working-copy mutations", async () => {
  const f = await fixture(), message = draft(); await f.service().enqueue("alice", message);
  const before = await f.repo.readOutbox("alice", (saved) => saved);
  await assert.rejects(f.service({ prepare(account, saved) {
    saved.snapshot[0] = 77; throw new Error("synthetic private material");
  } }).prepare("alice", message.id));
  assert.deepEqual(await f.repo.readOutbox("alice", (saved) => saved), before);
});

test("abort after the outbox put succeeds rolls back BOTH ciphertext and session", async () => {
  const f = await fixture(), message = draft(); await f.service().enqueue("alice", message);
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = put.apply(this, args);
    if (this.name === "outbox") request.addEventListener("success", () => this.transaction.abort());
    return request;
  };
  try { await assert.rejects(f.service().prepare("alice", message.id), code("STORAGE_WRITE_FAILED")); }
  finally { IDBObjectStore.prototype.put = put; }
  assert.equal((await f.service().list("alice"))[0].state, "queued");
  assert.equal((await f.repo.inspect("alice")).revision, 1);
  assert.equal(await f.repo.read("alice", (saved) => saved.snapshot[0]), 0);
  assert.equal((await f.service().prepare("alice", message.id)).state, "prepared");
});

test("quota failure during enqueue does not acknowledge or lose the caller's text", async () => {
  const f = await fixture(), message = draft(), before = { ...message };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === "outbox") throw new DOMException("synthetic quota", "QuotaExceededError");
    return put.apply(this, args);
  };
  try { await assert.rejects(f.service().enqueue("alice", message), code("STORAGE_WRITE_FAILED")); }
  finally { IDBObjectStore.prototype.put = put; }
  assert.deepEqual(message, before); assert.deepEqual(await f.service().list("alice"), []);
});

test("outbox compare-and-swap rejects an uncooperative queue writer", async () => {
  const f = await fixture(), message = draft(); await f.service().enqueue("alice", message);
  await assert.rejects(f.service({ async prepare(account, saved) {
    await mutate(f, "outbox", (queue) => ({ ...queue, revision: queue.revision + 1 }));
    return { ...saved, format: "synthetic-test", ciphertext: new Uint8Array([1]) };
  } }).prepare("alice", message.id), code("STALE_STATE"));
  assert.equal((await f.repo.inspect("alice")).revision, 1);
  await assert.rejects(f.service().list("alice"), code("CORRUPT_OUTBOX"));
});

test("a missing previously initialized queue fails closed instead of becoming empty", async () => {
  const f = await fixture(); await f.service().enqueue("alice", draft());
  await mutate(f, "outbox", () => undefined);
  await assert.rejects(f.service().list("alice"), code("CORRUPT_OUTBOX"));
  await assert.rejects(f.service().enqueue("alice", draft()), code("CORRUPT_OUTBOX"));
});

test("ordinary crypto updates preserve the queue anchor and detect restored stale queue records", async () => {
  const f = await fixture(), message = draft(); await f.service().enqueue("alice", message);
  let oldQueue;
  await mutate(f, "outbox", (queue) => { oldQueue = structuredClone(queue); return queue; });
  await f.repo.update("alice", (saved) => saved);
  assert.equal((await f.service().list("alice"))[0].id, message.id);
  await f.service().prepare("alice", message.id);
  await mutate(f, "outbox", () => oldQueue);
  await assert.rejects(f.service().list("alice"), code("CORRUPT_OUTBOX"));
});

test("outbox corruption blocks continuation instead of replacing queued work", async () => {
  const f = await fixture(), message = draft(); await f.service().enqueue("alice", message);
  await mutate(f, "outbox", (queue) => { queue.entries[0].text = "tampered"; return queue; });
  await assert.rejects(f.service().list("alice"), code("CORRUPT_OUTBOX"));
  await assert.rejects(f.service().enqueue("alice", draft()), code("CORRUPT_OUTBOX"));
  await assert.rejects(f.service().prepare("alice", message.id), code("CORRUPT_OUTBOX"));
  assert.equal(f.calls(), 0);
});

test("account isolation and missing identity remain enforced", async () => {
  const f = await fixture(), message = draft(); await f.service().enqueue("alice", message);
  await assert.rejects(f.service().list("missing"), code("MISSING_IDENTITY"));
  await f.repo.provision("bob", initial);
  assert.deepEqual(await f.service().list("bob"), []);
  await assert.rejects(f.service().prepare("bob", message.id), code("MESSAGE_NOT_FOUND"));
  await f.service().enqueue("bob", { ...message, text: "other account" });
  assert.equal((await f.service().list("alice"))[0].text, message.text);
});

test("malformed drafts, full queues, oversized or empty payloads and identity changes fail closed", async () => {
  const f = await fixture();
  for (const bad of [draft({ id: "bad" }), draft({ text: "" }), draft({ text: "é".repeat(TEXT_LIMIT) }),
    draft({ extra: "field" }), draft({ conversation: " bob " })]) {
    await assert.rejects(f.service().enqueue("alice", bad), code("INVALID_MESSAGE"));
  }
  const message = draft(); await f.service().enqueue("alice", message);
  for (const ciphertext of [new Uint8Array(), new Uint8Array(PAYLOAD_LIMIT + 1), "plaintext"]) {
    await assert.rejects(f.service({ prepare(account, saved) {
      return { ...saved, ciphertext, format: "synthetic-test" };
    } }).prepare("alice", message.id), code("INVALID_PREPARATION"));
  }
  await assert.rejects(f.service({ prepare() {
    return { ciphertext: new Uint8Array([1]), format: "synthetic-test" };
  } }).prepare("alice", message.id), code("INVALID_CHANGE"));
  await assert.rejects(f.service({ prepare(account, saved) {
    return { ...saved, identity: { ...identity, device_id: 8 }, ciphertext: new Uint8Array([1]), format: "synthetic-test" };
  } }).prepare("alice", message.id), code("IDENTITY_CHANGED"));
  await f.repo.updateOutbox("alice", ({ entries }) => ({ entries: [entries[0],
    ...Array.from({ length: OUTBOX_LIMIT - 1 }, () => ({ ...entries[0], id: crypto.randomUUID() }))] }));
  await assert.rejects(f.service().enqueue("alice", draft()), code("OUTBOX_FULL"));
  assert.equal((await f.repo.inspect("alice")).revision, 1);
});

test("v1 database upgrades in place and old writers cannot reopen with version 1", async () => {
  const indexedDB = new IDBFactory(), database = "old-" + crypto.randomUUID();
  const snapshot = new Uint8Array([0]);
  const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", snapshot)).toString("hex");
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("snapshots", { keyPath: "account" });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction("snapshots", "readwrite"); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    tx.objectStore("snapshots").put({ format: 1, account: "alice", revision: 4, identity, snapshot, sha256 });
  });
  db.close();
  const repo = new SnapshotRepository({ indexedDB, locks, database });
  assert.deepEqual(await repo.inspect("alice"), { identity, revision: 4 });
  await new OutboxService(repo).enqueue("alice", draft());
  assert.deepEqual(await repo.inspect("alice"), { identity, revision: 4 });
  await assert.rejects(new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
  }), (error) => error.name === "VersionError");
});
