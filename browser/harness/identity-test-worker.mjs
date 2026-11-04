// QA entry point only. Failure injection cannot be requested through the app API.
import { SnapshotRepository } from "./platform/snapshot-repository.mjs";
import { attachIdentityWorker } from "./platform/identity-worker-host.mjs";
import { loadIdentityEngine } from "./platform/identity-runtime.mjs";

const params = new URL(self.location.href).searchParams;
const run = params.get("run");
if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(run ?? "")) throw new Error("Invalid synthetic run");
const mode = params.get("mode") ?? "normal";
if (!["normal", "before-commit", "after-commit"].includes(mode)) throw new Error("Invalid synthetic mode");
const repository = new SnapshotRepository({ database: `gajim-qa-worker-${run}` });
let release;
let delayed;
let held = false;
const scope = { postMessage: (data) => {
  if (mode === "after-commit" && data.ok && !held) {
    held = true; delayed = data;
    self.postMessage({ qa: "committed-response-held" });
  } else self.postMessage(data);
} };
attachIdentityWorker(scope, { repository, account: "synthetic-worker", loadEngine: async () => {
  const engine = await loadIdentityEngine();
  return {
    open: (account, previous) => engine.open(account, previous),
    create: async (account) => {
      const result = await engine.create(account);
      if (mode === "before-commit") {
        await new Promise((resolve) => { release = resolve; self.postMessage({ qa: "uncommitted-create-held" }); });
      }
      return result;
    },
  };
} });
self.onmessage = (event) => {
  if (event.data?.qa === "release") {
    release?.(); release = undefined;
    if (delayed) { self.postMessage(delayed); delayed = undefined; }
  } else scope.onmessage(event);
};
