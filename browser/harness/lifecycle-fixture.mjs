// Disposable, synthetic lifecycle experiment. No transport or real accounts.
import { SnapshotRepository } from "./platform/snapshot-repository.mjs";
import { fixtureOperation } from "./fixture-bridge.mjs";

const ALICE = "synthetic-alice";
const BOB = "synthetic-bob";
const validRun = (run) => /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(run);

export class LifecycleFixture {
  constructor(pyodide, run, options = {}) {
    if (!validRun(run)) throw new Error("Invalid synthetic test identifier");
    this.pyodide = pyodide;
    this.run = run;
    this.idb = options.indexedDB ?? globalThis.indexedDB;
    this.database = `gajim-qa-lifecycle-${run}`;
    this.repo = new SnapshotRepository({ ...options, indexedDB: this.idb, database: this.database });
  }

  operation(account, action, extra) { return fixtureOperation(this.pyodide, account, action, extra); }

  // Public bundles and expected fingerprints only; private state remains in the
  // repository's snapshots. This is test setup metadata, not a production outbox.
  async metadata(value) {
    const db = await new Promise((resolve, reject) => {
      const request = this.idb.open(this.database + "-fixture", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("fixture");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Cannot open synthetic metadata"));
      request.onblocked = () => reject(new Error("Synthetic metadata is blocked"));
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("fixture", value ? "readwrite" : "readonly");
        const store = tx.objectStore("fixture");
        const request = value ? store.add(value, "baseline") : store.get("baseline");
        tx.oncomplete = () => resolve(value ?? request.result);
        tx.onabort = () => reject(new Error("Synthetic metadata transaction failed"));
      });
    } finally { db.close(); }
  }

  async create() {
    if (await this.metadata()) throw new Error("Synthetic test already exists; resume it");
    const aBundle = await this.repo.provision(ALICE, this.operation(ALICE, "provision"));
    const bBundle = await this.repo.provision(BOB, this.operation(BOB, "provision"));
    const a = await this.repo.inspect(ALICE);
    const b = await this.repo.inspect(BOB);
    const first = await this.repo.update(ALICE, this.operation(ALICE, "send", { peer: BOB, bundle: bBundle }));
    await this.repo.update(BOB, this.operation(BOB, "receive", { peer: ALICE, message: first, bundle: aBundle }));
    const reply = await this.repo.update(BOB, this.operation(BOB, "send", { peer: ALICE }));
    await this.repo.update(ALICE, this.operation(ALICE, "receive", { peer: BOB, message: reply, bundle: bBundle }));
    await this.metadata({ run: this.run, identities: { alice: a.identity, bob: b.identity }, aBundle, bBundle });
    return { ...await this.inspect(), created: true, encrypted_exchanges: 2 };
  }

  async inspect(options) {
    const baseline = await this.metadata();
    if (!baseline || baseline.run !== this.run) throw new Error("No complete synthetic test exists; no keys were generated");
    const alice = await this.repo.inspect(ALICE, options);
    const bob = await this.repo.inspect(BOB, options);
    for (const [name, current] of Object.entries({ alice, bob })) {
      if (JSON.stringify(current.identity) !== JSON.stringify(baseline.identities[name])) {
        throw new Error("Synthetic identity changed");
      }
    }
    return { run: this.run, identity_preserved: true, revisions: { alice: alice.revision, bob: bob.revision } };
  }

  async roundTrip(options) {
    const before = await this.inspect(options);
    const { aBundle, bBundle } = await this.metadata();
    const outgoing = await this.repo.update(ALICE, this.operation(ALICE, "send", { peer: BOB }), options);
    await this.repo.update(BOB, this.operation(BOB, "receive", { peer: ALICE, message: outgoing, bundle: aBundle }), options);
    const reply = await this.repo.update(BOB, this.operation(BOB, "send", { peer: ALICE }), options);
    await this.repo.update(ALICE, this.operation(ALICE, "receive", { peer: BOB, message: reply, bundle: bBundle }), options);
    return { ...await this.inspect(options), before: before.revisions, encrypted_exchanges: 2, passed: true };
  }

  async hold(waitForRelease, held) {
    await this.inspect();
    const result = await this.repo.update(ALICE, async (previous) => {
      const change = await this.operation(ALICE, "send", { peer: BOB })(previous);
      held({ run: this.run, held: true, committed: false, revision_before: previous.revision });
      // This intentional interruption point is test-only. No network work occurs.
      await waitForRelease;
      return { ...change, result: { previous_revision: previous.revision } };
    });
    return { ...await this.inspect(), ...result, held_change_committed: true };
  }

  async cleanup() {
    // Only the two known disposable databases belonging to this validated UUID.
    for (const name of [this.database, this.database + "-fixture"]) {
      await new Promise((resolve, reject) => {
        const request = this.idb.deleteDatabase(name);
        request.onsuccess = resolve;
        request.onerror = () => reject(new Error("Synthetic cleanup failed"));
        request.onblocked = () => reject(new Error("Close the other test tab before cleanup"));
      });
    }
  }
}
