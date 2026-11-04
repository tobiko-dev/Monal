import { SnapshotRepository } from "./snapshot-repository.mjs";
import { attachIdentityWorker } from "./identity-worker-host.mjs";
import { loadIdentityEngine } from "./identity-runtime.mjs";

attachIdentityWorker(self, {
  repository: new SnapshotRepository(), loadEngine: loadIdentityEngine,
});
