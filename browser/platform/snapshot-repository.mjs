// GPL-3.0-only. This stores private state locally; it is NOT encryption at rest.
import { validEntries } from "./outbox-model.mjs";
const DATABASE_VERSION = 2;
const FORMAT = 1;
const LIMIT = 32 * 1024 * 1024;

export class StorageFailure extends Error {
  constructor(code) {
    super(code);
    this.name = "StorageFailure";
    this.code = code;
  }
}

const fail = (code) => { throw new StorageFailure(code); };
const identityOK = (value) => value && Number.isInteger(value.device_id) &&
  value.device_id > 0 && value.device_id <= 2147483647 &&
  typeof value.fingerprint === "string" && /^[a-f0-9]{64}$/.test(value.fingerprint);
const sameIdentity = (a, b) => a.device_id === b.device_id && a.fingerprint === b.fingerprint;

/** One short lock per account operation; never a permanent sign-in lock.
 *
 * The callback must use a fresh disposable crypto working copy, return its full
 * snapshot, and perform no network I/O. Results are exposed only after IDB's
 * transaction-complete event. A failed operation is never retried implicitly.
 * updateOutbox commits prepared ciphertext and session changes together. A
 * network dispatcher still needs recipient-policy and delivery reconciliation.
 */
export class SnapshotRepository {
  constructor({ indexedDB = globalThis.indexedDB, locks = globalThis.navigator?.locks,
    crypto = globalThis.crypto, database = "gajim-browser-identities-v1" } = {}) {
    if (!indexedDB?.open || !locks?.request || !crypto?.subtle) fail("STORAGE_UNAVAILABLE");
    this.idb = indexedDB;
    this.locks = locks;
    this.crypto = crypto;
    this.database = database;
  }

  async #hash(bytes) {
    const digest = new Uint8Array(await this.crypto.subtle.digest("SHA-256", bytes));
    return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async #exclusive(account, task, { signal, waitMs = 10000 } = {}) {
    if (typeof account !== "string" || !account || account.length > 3071) fail("INVALID_ACCOUNT");
    if (!Number.isFinite(waitMs) || waitMs < 1) fail("INVALID_WAIT");
    const key = await this.#hash(new TextEncoder().encode(account));
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, waitMs);
    let entered = false;
    try {
      return await this.locks.request(`${this.database}:${key}`, {
        mode: "exclusive", signal: controller.signal,
      }, async () => {
        entered = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        return task();
      });
    } catch (error) {
      if (!entered && controller.signal.aborted) fail("STORAGE_BUSY");
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  #open() {
    return new Promise((resolve, reject) => {
      let rejected = false;
      const stop = () => { rejected = true; reject(new StorageFailure("STORAGE_UNAVAILABLE")); };
      let request;
      try { request = this.idb.open(this.database, DATABASE_VERSION); } catch { stop(); return; }
      request.onupgradeneeded = () => {
        // Upgrade in place: never rewrite or delete existing identity records.
        for (const name of ["snapshots", "outbox"]) {
          if (!request.result.objectStoreNames.contains(name)) {
            request.result.createObjectStore(name, { keyPath: "account" });
          }
        }
      };
      request.onerror = stop;
      request.onblocked = stop;
      request.onsuccess = () => {
        const db = request.result;
        if (rejected) { db.close(); return; }
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }

  #read(db, account, withOutbox = false) {
    return new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = db.transaction(withOutbox ? ["snapshots", "outbox"] : "snapshots", "readonly");
        const request = transaction.objectStore("snapshots").get(account);
        const queue = withOutbox ? transaction.objectStore("outbox").get(account) : null;
        transaction.oncomplete = () => resolve(withOutbox ? { record: request.result, queue: queue.result } : request.result);
        transaction.onabort = () => reject(new StorageFailure("STORAGE_READ_FAILED"));
        transaction.onerror = () => {}; // The abort event is the final outcome.
      } catch { reject(new StorageFailure("STORAGE_READ_FAILED")); }
    });
  }

  async #validate(record, account) {
    if (record === undefined) return;
    if (!record || record.format !== FORMAT || record.account !== account ||
        !Number.isSafeInteger(record.revision) || record.revision < 1 ||
        !identityOK(record.identity) || !(record.snapshot instanceof Uint8Array) ||
        !record.snapshot.byteLength || record.snapshot.byteLength > LIMIT ||
        (record.outbox_revision !== undefined && (!Number.isSafeInteger(record.outbox_revision) ||
          record.outbox_revision < 1 || !/^[a-f0-9]{64}$/.test(record.outbox_sha256))) ||
        (record.outbox_revision === undefined && record.outbox_sha256 !== undefined) ||
        await this.#hash(record.snapshot) !== record.sha256) fail("CORRUPT_STATE");
  }

  #commit(db, previous, next, outbox) {
    return new Promise((resolve, reject) => {
      let transaction;
      let code = "STORAGE_WRITE_FAILED";
      try {
        // Strict is a browser durability hint, not a power-loss guarantee.
        transaction = db.transaction(outbox ? ["snapshots", "outbox"] : "snapshots", "readwrite", { durability: "strict" });
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(new StorageFailure(code));
        transaction.onerror = () => {};
        const store = transaction.objectStore("snapshots");
        const request = store.get(next.account);
        request.onsuccess = () => {
          const current = request.result;
          if (previous ? !current || current.revision !== previous.revision ||
              current.sha256 !== previous.sha256 ||
              current.outbox_revision !== previous.outbox_revision ||
              current.outbox_sha256 !== previous.outbox_sha256 : current !== undefined) {
            code = "STALE_STATE";
            transaction.abort();
            return;
          }
          const put = () => {
            try {
              store.put(next);
              if (outbox) transaction.objectStore("outbox").put(outbox.next);
            } catch { transaction.abort(); }
          };
          if (!outbox) { put(); return; }
          const queued = transaction.objectStore("outbox").get(next.account);
          queued.onsuccess = () => {
            const currentQueue = queued.result, expected = outbox.previous;
            if (expected ? !currentQueue || currentQueue.revision !== expected.revision ||
                currentQueue.sha256 !== expected.sha256 : currentQueue !== undefined) {
              code = "STALE_STATE";
              transaction.abort();
              return;
            }
            put();
          };
        };
      } catch {
        if (transaction) transaction.abort();
        reject(new StorageFailure(code));
      }
    });
  }

  async inspect(account, options) {
    return this.read(account, ({ identity, revision }) => ({ identity, revision }), options);
  }

  // Worker-internal read: validate SQLite as well as the envelope without
  // advancing the revision. Never pass this callback or snapshot to page code.
  async read(account, operation, options) {
    return this.#exclusive(account, async () => {
      const db = await this.#open();
      try {
        const record = await this.#read(db, account);
        await this.#validate(record, account);
        if (!record) fail("MISSING_IDENTITY");
        return await operation({ snapshot: record.snapshot.slice(),
          identity: { ...record.identity }, revision: record.revision });
      } finally { db.close(); }
    }, options);
  }

  async provision(account, operation, options) {
    return this.#change(account, true, operation, options);
  }

  async update(account, operation, options) {
    return this.#change(account, false, operation, options);
  }

  async #validateQueue(queue, account, record) {
    if (queue === undefined) {
      if (record.outbox_revision !== undefined) fail("CORRUPT_OUTBOX");
      return;
    }
    if (!queue || queue.format !== FORMAT || queue.account !== account ||
        !Number.isSafeInteger(queue.revision) || queue.revision < 1 ||
        queue.revision !== record.outbox_revision || queue.sha256 !== record.outbox_sha256 ||
        !validEntries(queue.entries) ||
        await this.#hash(new TextEncoder().encode(JSON.stringify(queue.entries))) !== queue.sha256) {
      fail("CORRUPT_OUTBOX");
    }
  }

  // Internal callbacks receive disposable copies, never a live IDB record.
  async readOutbox(account, operation, options) {
    return this.#outbox(account, operation, false, options);
  }

  async updateOutbox(account, operation, options) {
    return this.#outbox(account, operation, true, options);
  }

  async #outbox(account, operation, writing, options) {
    return this.#exclusive(account, async () => {
      const db = await this.#open();
      try {
        const { record: previous, queue } = await this.#read(db, account, true);
        await this.#validate(previous, account);
        if (!previous) fail("MISSING_IDENTITY");
        await this.#validateQueue(queue, account, previous);
        const value = await operation({ snapshot: previous.snapshot.slice(),
          identity: { ...previous.identity }, revision: previous.revision,
          entries: structuredClone(queue?.entries ?? []) });
        if (!writing) return value;
        if (value?.unchanged === true) return value.result;
        if (!value || !validEntries(value.entries)) fail("INVALID_OUTBOX_CHANGE");
        // The session snapshot is optional for enqueue/blocked status updates,
        // but a supplied snapshot must be valid and preserve the identity.
        const next = Object.hasOwn(value, "snapshot") ? await this.#next(account, previous, value) : { ...previous };
        const nextQueue = { format: FORMAT, account, revision: (queue?.revision ?? 0) + 1,
          entries: structuredClone(value.entries) };
        if (!Number.isSafeInteger(nextQueue.revision)) fail("INVALID_REVISION");
        nextQueue.sha256 = await this.#hash(new TextEncoder().encode(JSON.stringify(nextQueue.entries)));
        // Bind queue presence/version to the identity record. A deleted or
        // rolled-back queue must not silently look like an empty first queue.
        next.outbox_revision = nextQueue.revision;
        next.outbox_sha256 = nextQueue.sha256;
        await this.#commit(db, previous, next, { previous: queue, next: nextQueue });
        return value.result; // Neither result nor ciphertext escapes before commit.
      } finally { db.close(); }
    }, options);
  }

  async #next(account, previous, change) {
    if (!change || !(change.snapshot instanceof Uint8Array) ||
        !change.snapshot.byteLength || change.snapshot.byteLength > LIMIT ||
        !identityOK(change.identity)) fail("INVALID_CHANGE");
    if (previous && !sameIdentity(previous.identity, change.identity)) fail("IDENTITY_CHANGED");
    const next = {
      format: FORMAT, account, revision: (previous?.revision ?? 0) + 1,
      identity: { device_id: change.identity.device_id, fingerprint: change.identity.fingerprint },
      snapshot: change.snapshot.slice(),
    };
    if (previous?.outbox_revision !== undefined) {
      next.outbox_revision = previous.outbox_revision;
      next.outbox_sha256 = previous.outbox_sha256;
    }
    if (!Number.isSafeInteger(next.revision)) fail("INVALID_REVISION");
    next.sha256 = await this.#hash(next.snapshot);
    return next;
  }

  async #change(account, creating, operation, options) {
    return this.#exclusive(account, async () => {
      const db = await this.#open();
      try {
        const previous = await this.#read(db, account);
        await this.#validate(previous, account);
        if (creating && previous) fail("IDENTITY_EXISTS");
        if (!creating && !previous) fail("MISSING_IDENTITY");
        const change = await operation(previous ? {
          snapshot: previous.snapshot.slice(), identity: { ...previous.identity },
          revision: previous.revision,
        } : null);
        const next = await this.#next(account, previous, change);
        await this.#commit(db, previous, next);
        return change.result;
      } finally { db.close(); }
    }, options);
  }
}
