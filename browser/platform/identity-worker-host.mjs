import { StorageFailure } from "./snapshot-repository.mjs";
import { IdentityService } from "./identity-service.mjs";
import { IdentityFailure, VERSION, MAX_PENDING, codes, validRequest, publicIdentity } from "./identity-protocol.mjs";

// One account per worker, with bounded serial work. Web Locks additionally
// serialize independent workers/tabs. Never reuse a Python working copy.
export function attachIdentityWorker(scope, { repository, loadEngine, account }) {
  let lastID = 0;
  let pending = 0;
  let tail = Promise.resolve();
  let service;
  const respond = (data) => scope.postMessage(data);
  const reject = (id, code, outcome = "not_committed") => respond({
    version: VERSION, id, ok: false, error: { code, outcome },
  });
  scope.onmessage = ({ data }) => {
    if (!validRequest(data) || data.id <= lastID) {
      reject(Number.isSafeInteger(data?.id) ? data.id : 0, "INVALID_REQUEST"); return;
    }
    lastID = data.id;
    if (account !== undefined && account !== data.account) { reject(data.id, "ACCOUNT_MISMATCH"); return; }
    if (pending >= MAX_PENDING) { reject(data.id, "QUEUE_FULL"); return; }
    account = data.account;
    pending++;
    // Promise callbacks serialize runtime initialization and every operation,
    // including failures. No retry/reprovision occurs in an error handler.
    tail = tail.then(async () => {
      try {
        service ??= loadEngine().then((engine) => new IdentityService(repository, engine));
        const handler = await service;
        const result = publicIdentity(await handler[data.command](account));
        respond({ version: VERSION, id: data.id, ok: true, result });
      } catch (error) {
        const known = error instanceof StorageFailure || error instanceof IdentityFailure;
        const code = known && codes.has(error.code) ? error.code : "OPERATION_FAILED";
        // Unknown interruption/exception may occur after commit. Never claim
        // that an unacknowledged create was rolled back.
        const outcome = data.command === "open" ? "read_only" :
          known ? (error.outcome ?? "not_committed") : "unknown";
        reject(data.id, code, outcome);
      } finally { pending--; }
    }).catch(() => {}); // A failed postMessage is recovered by the client's watchdog.
  };
}
