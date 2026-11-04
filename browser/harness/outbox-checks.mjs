// Synthetic QA only. Uses the actual Gajim store and unchanged omemo-dr engine.
// The fixture explicitly trusts its own generated peers. No network send exists.
import { SnapshotRepository } from "./platform/snapshot-repository.mjs";
import { OutboxService } from "./platform/outbox-service.mjs";
import { fixtureOperation } from "./fixture-bridge.mjs";

const check = (condition, message) => { if (!condition) throw new Error(message); };
async function rejects(operation, code) {
  try { await operation(); } catch (error) {
    check(error.code === code, `Expected ${code}, got ${error.code ?? "unexpected error"}`);
    return;
  }
  throw new Error(`Expected ${code}, but operation succeeded`);
}

export async function runOutboxChecks(pyodide, options = {}, progress = () => {}) {
  const indexedDB = options.indexedDB ?? globalThis.indexedDB;
  const prototype = options.objectStorePrototype ?? globalThis.IDBObjectStore?.prototype;
  if (!prototype?.put) throw new Error("The transactional fault-injection API is unavailable");
  const database = "gajim-qa-outbox-" + crypto.randomUUID();
  const settings = { indexedDB, locks: options.locks ?? navigator.locks, database };
  const repo = () => new SnapshotRepository(settings);
  const alice = "synthetic-alice", bob = "synthetic-bob";
  const operation = (account, action, extra) => fixtureOperation(pyodide, account, action, extra);
  const checks = [];
  const pass = (name) => { checks.push({ name, passed: true }); progress(name); };
  let encryptions = 0;
  const engine = { async prepare(account, saved, entry) {
    encryptions++;
    const change = await operation(account, "send", { peer: entry.conversation, text: entry.text })(saved);
    return { snapshot: change.snapshot, identity: change.identity,
      format: "qa-omemo-json-v1", ciphertext: new TextEncoder().encode(JSON.stringify(change.result)) };
  } };
  const service = () => new OutboxService(repo(), engine);
  const state = () => repo().readOutbox(alice, ({ snapshot, ...saved }) => ({ ...saved,
    snapshot: Array.from(snapshot) }));
  const payload = async (id) => repo().readOutbox(alice, ({ entries }) => entries.find((entry) => entry.id === id).prepared);
  const decode = (prepared) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(prepared.base64), (c) => c.charCodeAt(0))));
  try {
    progress("Creating disposable Gajim identities and establishing a synthetic session…");
    const aBundle = await repo().provision(alice, operation(alice, "provision"));
    const bBundle = await repo().provision(bob, operation(bob, "provision"));
    const aIdentity = (await repo().inspect(alice)).identity;
    // Test-only trust/bootstrap, outside the outbox implementation.
    const seed = await repo().update(alice, operation(alice, "send", { peer: bob, bundle: bBundle }));
    await repo().update(bob, operation(bob, "receive", { peer: alice, message: seed, bundle: aBundle }));
    const first = { id: crypto.randomUUID(), conversation: bob, text: "Synthetic queued message one" };
    const second = { id: crypto.randomUUID(), conversation: bob, text: "Synthetic queued message two" };
    await service().enqueue(alice, first); await service().enqueue(alice, second);
    const resumed = await service().list(alice);
    check(resumed.length === 2 && resumed[0].id === first.id && resumed[1].text === second.text,
      "Queued intent did not survive repository reconstruction");
    check((await repo().inspect(alice)).revision === 2, "Enqueue changed the crypto revision");
    pass("queued text survives reconstruction without advancing the crypto session");

    await Promise.all([service().enqueue(alice, first), service().enqueue(alice, first)]);
    await rejects(() => service().enqueue(alice, { ...first, text: "conflicting synthetic text" }), "MESSAGE_CONFLICT");
    check((await service().list(alice)).length === 2, "Repeated enqueue duplicated the message");
    pass("stable IDs deduplicate repeated intent and reject conflicting reuse");

    await rejects(() => service().prepare(alice, second.id), "EARLIER_MESSAGE_PENDING");
    check(encryptions === 0, "Out-of-order preparation ran crypto");
    check((await service().list(bob)).length === 0, "Outbox leaked across accounts");
    pass("conversation ordering and account isolation are preserved");

    const before = await state();
    const put = prototype.put;
    let aborted = false;
    prototype.put = function (...args) {
      const request = put.apply(this, args);
      if (this.name === "outbox" && this.transaction.db.name === database) {
        request.addEventListener("success", () => { aborted = true; this.transaction.abort(); });
      }
      return request;
    };
    try { await rejects(() => service().prepare(alice, first.id), "STORAGE_WRITE_FAILED"); }
    finally { prototype.put = put; }
    check(aborted, "Late transaction-abort injection did not execute");
    check(JSON.stringify(await state()) === JSON.stringify(before), "Abort left a partial session or prepared payload");
    pass("abort after the outbox write rolls back ciphertext and the actual Gajim session together");

    const preparedFirst = await service().prepare(alice, first.id);
    check(preparedFirst.state === "prepared" && !("prepared" in preparedFirst) && !("snapshot" in preparedFirst),
      "Preparation exposed worker-internal bytes or reported the wrong status");
    await repo().update(bob, operation(bob, "receive", {
      peer: alice, message: decode(await payload(first.id)), bundle: aBundle, text: first.text,
    }));
    pass("deliberate retry after rollback produces a decryptable committed message");

    await service().prepare(alice, second.id); // Discard the reply to model caller uncertainty.
    const committed = await state(), callsBeforeRetry = encryptions;
    await Promise.all([service().prepare(alice, second.id), service().prepare(alice, second.id)]);
    check(encryptions === callsBeforeRetry && JSON.stringify(await state()) === JSON.stringify(committed),
      "Reconciliation encrypted or saved already committed work again");
    await repo().update(bob, operation(bob, "receive", {
      peer: alice, message: decode(await payload(second.id)), bundle: aBundle, text: second.text,
    }));
    pass("lost-reply reconciliation reuses the identical ciphertext without advancing the ratchet");

    const reply = await repo().update(bob, operation(bob, "send", { peer: alice }));
    await repo().update(alice, operation(alice, "receive", { peer: bob, message: reply, bundle: bBundle }));
    check(JSON.stringify((await repo().inspect(alice)).identity) === JSON.stringify(aIdentity), "Identity changed");
    check((await service().list(alice)).every((entry) => entry.state === "prepared"), "A crypto update lost outbox state");
    pass("bidirectional encrypted continuation preserves identity and prepared queue entries");
    return { passed: true, checks, encrypted_exchanges: 4, discarded_preparations: 1,
      identity_preserved: true, format: "Test-only JSON OMEMO payload; not an XMPP stanza or production dispatcher" };
  } finally {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(database);
      request.onsuccess = resolve;
      request.onerror = () => reject(new Error("Synthetic outbox cleanup failed"));
      request.onblocked = () => reject(new Error("Synthetic outbox cleanup blocked"));
    });
  }
}
