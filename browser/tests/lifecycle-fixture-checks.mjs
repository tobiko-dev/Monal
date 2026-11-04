import assert from "node:assert/strict";
import { LifecycleFixture } from "../dist/lifecycle-fixture.mjs";

export async function checkLifecycleFixture(pyodide, options) {
  const run = crypto.randomUUID();
  let fixture = new LifecycleFixture(pyodide, run, options);
  try {
    const created = await fixture.create();
    assert.deepEqual(created.revisions, { alice: 3, bob: 3 });
    fixture = new LifecycleFixture(pyodide, run, options);
    assert.deepEqual((await fixture.inspect()).revisions, created.revisions);
    const resumed = await fixture.roundTrip();
    assert.deepEqual(resumed.before, created.revisions);
    assert.deepEqual(resumed.revisions, { alice: 5, bob: 5 });
    let release;
    let ready;
    const held = new Promise((resolve) => { ready = resolve; });
    const holding = fixture.hold(new Promise((resolve) => { release = resolve; }), ready);
    const staged = await held;
    assert.equal(staged.committed, false);
    assert.equal(staged.revision_before, 5);
    const second = new LifecycleFixture(pyodide, run, options);
    try {
      await assert.rejects(second.inspect({ waitMs: 20 }), (error) => error.code === "STORAGE_BUSY");
    } finally { release(); await holding; }
    const after = await second.roundTrip();
    assert.deepEqual(after.before, { alice: 6, bob: 5 });
    assert.deepEqual(after.revisions, { alice: 8, bob: 7 });
    assert.equal(after.identity_preserved, true);
    return { passed: true, reconstructed_fixture: true, contention_blocked: true,
      ratchet_continued_after_held_commit: true, environment: "Node fixture logic; not a browser lifecycle pass" };
  } finally { await fixture.cleanup(); }
}
