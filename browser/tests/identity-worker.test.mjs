// Host/client fault tests with simulated IDB and a deterministic engine.
// Real Python/WASM is exercised separately by the combined integration check.
import test from "node:test";
import assert from "node:assert/strict";
import { locks } from "node:worker_threads";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { SnapshotRepository } from "../platform/snapshot-repository.mjs";
import { IdentityClient } from "../platform/identity-client.mjs";
import { attachIdentityWorker } from "../platform/identity-worker-host.mjs";
import { VERSION, MAX_PENDING, IdentityFailure } from "../platform/identity-protocol.mjs";

const identity = { device_id: 9, fingerprint: "cd".repeat(32) };
const initial = () => ({ identity: { ...identity }, snapshot: new Uint8Array([1]) });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const code = (expected, outcome) => (e) => e.code === expected && (!outcome || e.outcome === outcome);

function setup(engine = { create: initial, open: (_, previous) => previous.identity }) {
  const repository = new SnapshotRepository({ indexedDB: new IDBFactory(), locks, database: "worker-unit-" + crypto.randomUUID() });
  let loads = 0;
  const workers = [];
  const replies = [];
  function createWorker() {
    const worker = {
      terminated: false,
      postMessage(data) { queueMicrotask(() => { if (!worker.terminated) scope.onmessage({ data: structuredClone(data) }); }); },
      terminate() { worker.terminated = true; },
    };
    const scope = { postMessage(data) {
      replies.push(structuredClone(data));
      queueMicrotask(() => { if (!worker.terminated) worker.onmessage?.({ data: structuredClone(data) }); });
    } };
    attachIdentityWorker(scope, { repository, loadEngine: async () => { loads++; return engine; } });
    workers.push(worker);
    return worker;
  }
  return { repository, engine, replies, workers, createWorker, loads: () => loads,
    client: (account = "worker-alice", options = {}) => new IdentityClient(account, { createWorker, ...options }) };
}

test("opening missing state never creates keys, and later explicit creation is allowed", async () => {
  let generated = 0;
  const f = setup({ create: () => { generated++; return initial(); }, open: (_, p) => p.identity });
  const c = f.client();
  try {
    await assert.rejects(c.open(), code("MISSING_IDENTITY", "read_only"));
    assert.equal(generated, 0);
    const created = await c.create();
    assert.deepEqual(created, { identity, revision: 1 });
    await assert.rejects(c.create(), code("IDENTITY_EXISTS", "not_committed"));
    assert.equal(generated, 1);
  } finally { c.close(); }
});

test("concurrent requests initialize once and never overlap engine operations", async () => {
  let active = 0; let peak = 0;
  const f = setup({ create: initial, open: async (_, p) => {
    active++; peak = Math.max(peak, active);
    await new Promise((done) => setTimeout(done, 5)); active--; return p.identity;
  } });
  const c = f.client();
  try {
    const results = await Promise.all([c.create(), c.open(), c.open()]);
    assert.equal(peak, 1); assert.equal(f.loads(), 1);
    assert(results.every((r) => r.revision === 1));
  } finally { c.close(); }
});

test("close and reopen preserves the identity without deleting or rewriting state", async () => {
  const f = setup(); const c = f.client();
  const first = await c.create();
  c.close();
  try {
    assert.deepEqual(await c.open(), first);
    assert.equal(f.workers.length, 2);
    assert.equal((await f.repository.inspect(c.account)).revision, 1);
    assert.throws(() => { c.account = "different"; }, TypeError);
  } finally { c.close(); }
});

test("a late IDB abort never publishes creation success", async () => {
  const f = setup(); const c = f.client();
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = put.apply(this, args);
    request.addEventListener("success", () => this.transaction.abort()); return request;
  };
  try {
    await assert.rejects(c.create(), code("STORAGE_WRITE_FAILED", "not_committed"));
    assert.equal(f.replies.filter((r) => r.ok).length, 0);
  } finally { IDBObjectStore.prototype.put = put; c.close(); }
  await assert.rejects(f.repository.inspect("worker-alice"), code("MISSING_IDENTITY"));
});

test("a lost reply after commit is unknown, and reopening recovers without regeneration", async () => {
  const f = setup();
  const c = new IdentityClient("worker-alice", { timeoutMs: 30, createWorker: () => {
    const worker = f.createWorker();
    const send = worker.postMessage;
    worker.postMessage = function (request) {
      // Drop the response at the page boundary, after the host has committed.
      const receive = worker.onmessage;
      worker.onmessage = (event) => { if (event.data.ok && request.command === "create") return; receive(event); };
      send.call(worker, request);
    };
    return worker;
  } });
  await assert.rejects(c.create(), code("WORKER_TIMEOUT", "unknown"));
  const saved = await f.repository.inspect("worker-alice");
  const reopened = f.client();
  try {
    assert.deepEqual(await reopened.open(), saved);
    await assert.rejects(reopened.create(), code("IDENTITY_EXISTS"));
    assert.equal(saved.revision, 1);
  } finally { c.close(); reopened.close(); }
});

test("stopping a worker rejects every pending request and ignores its late response", async () => {
  const held = deferred(); const started = deferred();
  const f = setup({ create: initial, open: async (_, p) => { started.resolve(); await held.promise; return p.identity; } });
  const c = f.client(); await c.create();
  const a = c.open(); const b = c.open();
  const rejected = [assert.rejects(a, code("WORKER_STOPPED", "read_only")), assert.rejects(b, code("WORKER_STOPPED", "read_only"))];
  await started.promise;
  const oldReply = f.workers[0].onmessage;
  c.close(); await Promise.all(rejected);
  oldReply({ data: { version: VERSION, id: 2, ok: true, result: { identity, revision: 99 } } });
  held.resolve();
  try { assert.equal((await c.open()).revision, 1); }
  finally { c.close(); }
});

test("worker messages never contain private snapshots or exception text", async () => {
  const f = setup({ create: initial, open: () => { throw new Error("private sentinel"); } });
  const c = f.client();
  try {
    await c.create();
    await assert.rejects(c.open(), code("OPERATION_FAILED", "read_only"));
    const wire = JSON.stringify(f.replies);
    assert(!wire.includes("snapshot")); assert(!wire.includes("sentinel"));
    assert.deepEqual(Object.keys(f.replies[0].result).sort(), ["identity", "revision"]);
  } finally { c.close(); }
});

test("one worker rejects account switching, duplicate IDs and unrecognized operations", async () => {
  const f = setup();
  const worker = f.createWorker(); const received = [];
  worker.onmessage = (e) => received.push(e.data);
  const send = (id, command, account = "worker-alice", extra = {}) => worker.postMessage({ version: VERSION, id, command, account, ...extra });
  send(1, "create"); send(2, "open", "worker-bob"); send(3, "encrypt"); send(4, "open", "worker-alice", { snapshot: "injected" }); send(1, "create");
  while (received.length < 5) await new Promise((done) => setTimeout(done, 2));
  assert.equal(received.filter((r) => r.ok).length, 1);
  assert.equal(received.filter((r) => r.error?.code === "ACCOUNT_MISMATCH").length, 1);
  assert.equal(received.filter((r) => r.error?.code === "INVALID_REQUEST").length, 3);
  worker.terminate();
});

test("bounded client queue rejects overflow and never retries it", async () => {
  const f = setup(); const c = f.client(); await c.create();
  f.engine.open = () => new Promise(() => {});
  const pending = Array.from({ length: MAX_PENDING }, () => c.open());
  const done = pending.map((p) => assert.rejects(p, code("WORKER_STOPPED")));
  await assert.rejects(c.open(), code("QUEUE_FULL", "not_committed"));
  c.close(); await Promise.all(done);
});

test("malformed response shuts down the worker without exposing its result", async () => {
  let worker;
  const c = new IdentityClient("worker-alice", { createWorker: () => worker = {
    postMessage(request) { queueMicrotask(() => worker.onmessage({ data: {
      version: VERSION, id: request.id, ok: true,
      result: { identity, revision: 1, snapshot: "private sentinel" },
    } })); }, terminate() { worker.terminated = true; },
  } });
  await assert.rejects(c.create(), code("PROTOCOL_ERROR", "unknown"));
  assert.equal(worker.terminated, true);
});

test("runtime initialization failure stays failed until explicit worker restart", async () => {
  const f = setup(); let attempts = 0;
  const c = new IdentityClient("worker-alice", { createWorker: () => {
    const worker = { postMessage: (data) => queueMicrotask(() => scope.onmessage({ data })), terminate() {} };
    const scope = { postMessage: (data) => queueMicrotask(() => worker.onmessage({ data })) };
    attachIdentityWorker(scope, { repository: f.repository, loadEngine: async () => { attempts++; throw new IdentityFailure("RUNTIME_FAILED"); } });
    return worker;
  } });
  try {
    await assert.rejects(c.open(), code("RUNTIME_FAILED"));
    await assert.rejects(c.create(), code("RUNTIME_FAILED"));
    assert.equal(attempts, 1);
    c.close(); await assert.rejects(c.open(), code("RUNTIME_FAILED"));
    assert.equal(attempts, 2);
  } finally { c.close(); }
});

test("an existing worker notices a changed public identity after restart", async () => {
  const f = setup(); const c = f.client(); await c.create(); c.close();
  const other = { device_id: 10, fingerprint: "ef".repeat(32) };
  // Simulate a response from a replaced store; client must retain its anchor.
  c.createWorker = () => ({ postMessage(request) { queueMicrotask(() => this.onmessage({ data: {
    version: VERSION, id: request.id, ok: true, result: { identity: other, revision: 1 },
  } })); }, terminate() {} });
  await assert.rejects(c.open(), code("IDENTITY_CHANGED", "read_only"));
});
