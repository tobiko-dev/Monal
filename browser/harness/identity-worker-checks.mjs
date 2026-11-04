import { IdentityClient } from "./platform/identity-client.mjs";

const require = (condition, label) => { if (!condition) throw new Error(label); };
const same = (a, b) => a.device_id === b.device_id && a.fingerprint === b.fingerprint;
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const fails = async (promise, code, outcome) => {
  try { await promise; } catch (error) {
    require(error.code === code && (!outcome || error.outcome === outcome), `Expected ${code}, got ${error.code}`);
    return { code: error.code, outcome: error.outcome };
  }
  throw new Error(`Expected ${code}, operation succeeded`);
};

export async function runIdentityWorkerChecks(progress = () => {}) {
  const clients = [];
  const databases = [];
  const checks = [];
  const run = () => {
    const id = crypto.randomUUID(); databases.push(`gajim-qa-worker-${id}`); return id;
  };
  const fixture = (id, mode = "normal") => {
    const held = deferred();
    const ready = deferred();
    let native;
    const client = new IdentityClient("synthetic-worker", { createWorker: () => {
      const url = new URL("./identity-test-worker.mjs", import.meta.url);
      url.searchParams.set("run", id); url.searchParams.set("mode", mode);
      native = new Worker(url, { type: "module" });
      const wrapper = { postMessage: (data) => native.postMessage(data), terminate: () => native.terminate() };
      native.onmessage = (event) => {
        if (event.data.qa) held.resolve(event.data.qa);
        else { ready.resolve(); wrapper.onmessage?.(event); }
      };
      native.onerror = (event) => wrapper.onerror?.(event);
      native.onmessageerror = (event) => wrapper.onmessageerror?.(event);
      return wrapper;
    } });
    clients.push(client);
    return { client, held: held.promise, ready: ready.promise, release: () => native.postMessage({ qa: "release" }) };
  };
  const check = (name, detail = {}) => { checks.push({ name, passed: true, ...detail }); progress(`${checks.length} checks passed: ${name}`); };
  // Each wait has a bounded diagnostic deadline; no operation is auto-retried.
  const bounded = async (promise) => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Worker check timed out")), 180000); })]); }
    finally { clearTimeout(timer); }
  };
  const waitForQueuedLock = async (id) => {
    const end = Date.now() + 90000;
    while (Date.now() < end) {
      const value = await navigator.locks.query();
      const prefix = `gajim-qa-worker-${id}:`;
      const held = value.held.filter((x) => x.name.startsWith(prefix)).length;
      const pending = value.pending.filter((x) => x.name.startsWith(prefix)).length;
      if (held === 1 && pending === 1) return { held, pending };
      await new Promise((done) => setTimeout(done, 25));
    }
    throw new Error("Competing worker never queued on the owned lock");
  };
  try {
    progress("Starting actual application identity workers…");
    const first = fixture(run());
    await fails(first.client.open(), "MISSING_IDENTITY", "read_only"); check("missing state does not create keys");
    const created = await first.client.create();
    require(created.revision === 1, "Unexpected initial revision");
    await fails(first.client.create(), "IDENTITY_EXISTS", "not_committed"); check("existing identity cannot be replaced");
    const opened = await Promise.all([first.client.open(), first.client.open()]);
    require(opened.every((r) => r.revision === 1 && same(r.identity, created.identity)), "Queued read changed identity");
    check("queued reads preserve identity and revision");
    first.client.close();
    const restored = await first.client.open();
    require(restored.revision === 1 && same(restored.identity, created.identity), "Restart changed identity");
    check("fresh application worker restores the same identity"); first.client.close();

    progress("Checking two actual workers and commit handoff…");
    const committedRun = run();
    const owner = fixture(committedRun, "before-commit");
    const peer = fixture(committedRun);
    // Warm the peer first so the owner does not block while its runtime downloads.
    await fails(peer.client.open(), "MISSING_IDENTITY");
    const creating = owner.client.create(); creating.catch(() => {});
    require(await bounded(Promise.race([owner.held, creating.then(() => { throw new Error("Creation ended before its hold point"); })])) === "uncommitted-create-held", "Wrong hold point");
    const reading = peer.client.open(); reading.catch(() => {});
    const queue = await waitForQueuedLock(committedRun);
    owner.release();
    const [saved, read] = await Promise.all([creating, reading]);
    require(read.revision === 1 && same(saved.identity, read.identity), "Handoff did not load committed identity");
    check("queued worker reads committed creation", { queue }); owner.client.close(); peer.client.close();

    progress("Stopping an owner before its write commits…");
    const interruptedRun = run();
    const interrupted = fixture(interruptedRun, "before-commit");
    const waiting = fixture(interruptedRun);
    await fails(waiting.client.open(), "MISSING_IDENTITY");
    const interruptedCreate = fails(interrupted.client.create(), "WORKER_STOPPED", "unknown");
    await bounded(Promise.race([interrupted.held, interruptedCreate.then(() => { throw new Error("Creation ended before interruption"); })]));
    const waitingRead = fails(waiting.client.open(), "MISSING_IDENTITY", "read_only");
    const interruptedQueue = await waitForQueuedLock(interruptedRun);
    interrupted.client.close();
    await Promise.all([interruptedCreate, waitingRead]);
    check("terminated owner leaves no partial identity and releases lock", { queue: interruptedQueue });
    const replacement = await waiting.client.create();
    require(replacement.revision === 1, "Interrupted creation unexpectedly committed");
    check("explicit creation can proceed after interrupted first provisioning"); waiting.client.close();

    progress("Losing an acknowledgement after a successful commit…");
    const lostRun = run(); const lost = fixture(lostRun, "after-commit");
    const lostCreate = fails(lost.client.create(), "WORKER_STOPPED", "unknown");
    require(await bounded(Promise.race([lost.held, lostCreate.then(() => { throw new Error("Creation ended before its lost reply"); })])) === "committed-response-held", "Reply was not held after commit");
    lost.client.close(); await lostCreate;
    const recovery = fixture(lostRun);
    const recovered = await recovery.client.open();
    require(recovered.revision === 1, "Lost acknowledgement lost committed identity");
    await fails(recovery.client.create(), "IDENTITY_EXISTS");
    check("lost acknowledgement recovers saved identity without reprovisioning"); recovery.client.close();
    return { passed: true, checks, user_agent: navigator.userAgent,
      environment: "Actual browser module workers, IndexedDB, Web Locks and Gajim WASM identity bridge" };
  } finally {
    clients.forEach((client) => client.close());
    for (const name of databases) await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = resolve; request.onerror = () => reject(new Error("Synthetic cleanup failed"));
      request.onblocked = () => reject(new Error("Synthetic cleanup blocked"));
    });
  }
}
