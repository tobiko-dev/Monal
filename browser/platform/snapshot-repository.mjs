// GPL-3.0-only. This stores private state locally; it is NOT encryption at rest.
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
 * M4 must persist prepared ciphertext/outbox data atomically before any send.
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
      try { request = this.idb.open(this.database, FORMAT); } catch { stop(); return; }
      request.onupgradeneeded = () => request.result.createObjectStore("snapshots", { keyPath: "account" });
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

  #read(db, account) {
    return new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = db.transaction("snapshots", "readonly");
        const request = transaction.objectStore("snapshots").get(account);
        transaction.oncomplete = () => resolve(request.result);
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
        await this.#hash(record.snapshot) !== record.sha256) fail("CORRUPT_STATE");
  }

  #commit(db, previous, next) {
    return new Promise((resolve, reject) => {
      let transaction;
      let code = "STORAGE_WRITE_FAILED";
      try {
        // Strict is a browser durability hint, not a power-loss guarantee.
        transaction = db.transaction("snapshots", "readwrite", { durability: "strict" });
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(new StorageFailure(code));
        transaction.onerror = () => {};
        const store = transaction.objectStore("snapshots");
        const request = store.get(next.account);
        request.onsuccess = () => {
          const current = request.result;
          if (previous ? !current || current.revision !== previous.revision ||
              current.sha256 !== previous.sha256 : current !== undefined) {
            code = "STALE_STATE";
            transaction.abort();
            return;
          }
          try { store.put(next); } catch {
            transaction.abort();
          }
        };
      } catch {
        if (transaction) transaction.abort();
        reject(new StorageFailure(code));
      }
    });
  }

  async inspect(account, options) {
    return this.#exclusive(account, async () => {
      const db = await this.#open();
      try {
        const record = await this.#read(db, account);
        await this.#validate(record, account);
        if (!record) fail("MISSING_IDENTITY");
        return { identity: record.identity, revision: record.revision };
      } finally { db.close(); }
    }, options);
  }

  async provision(account, operation, options) {
    return this.#change(account, true, operation, options);
  }

  async update(account, operation, options) {
    return this.#change(account, false, operation, options);
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
        if (!change || !(change.snapshot instanceof Uint8Array) ||
            !change.snapshot.byteLength || change.snapshot.byteLength > LIMIT ||
            !identityOK(change.identity)) fail("INVALID_CHANGE");
        if (previous && !sameIdentity(previous.identity, change.identity)) fail("IDENTITY_CHANGED");
        const next = {
          format: FORMAT, account, revision: (previous?.revision ?? 0) + 1,
          identity: { device_id: change.identity.device_id, fingerprint: change.identity.fingerprint },
          snapshot: change.snapshot.slice(),
        };
        if (!Number.isSafeInteger(next.revision)) fail("INVALID_REVISION");
        next.sha256 = await this.#hash(next.snapshot);
        await this.#commit(db, previous, next);
        return change.result;
      } finally { db.close(); }
    }, options);
  }
}
