// GPL-3.0-only. Intentionally small: no eval, arbitrary callbacks or key export.
export const VERSION = 1;
export const MAX_PENDING = 32;
export const commands = new Set(["create", "open"]);
export const codes = new Set([
  "INVALID_REQUEST", "ACCOUNT_MISMATCH", "QUEUE_FULL", "RUNTIME_FAILED",
  "CRYPTO_FAILED", "OPERATION_FAILED", "STORAGE_UNAVAILABLE", "STORAGE_BUSY",
  "STORAGE_READ_FAILED", "STORAGE_WRITE_FAILED", "MISSING_IDENTITY",
  "IDENTITY_EXISTS", "CORRUPT_STATE", "INVALID_CHANGE", "IDENTITY_CHANGED",
  "INVALID_REVISION", "STALE_STATE", "WORKER_STOPPED", "WORKER_FAILED",
  "WORKER_TIMEOUT", "PROTOCOL_ERROR",
]);

export class IdentityFailure extends Error {
  constructor(code, outcome = "not_committed") {
    super(code);
    this.name = "IdentityFailure";
    this.code = code;
    this.outcome = outcome;
  }
}

const exact = (value, keys) => value && typeof value === "object" &&
  !Array.isArray(value) && Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

// An opaque canonical identifier supplied by upstream account handling later.
// Do not lower-case, trim or otherwise invent JID normalization here.
export function validAccount(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 3071 &&
    value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function validRequest(data) {
  return exact(data, ["version", "id", "command", "account"]) &&
    data.version === VERSION && Number.isSafeInteger(data.id) && data.id > 0 &&
    commands.has(data.command) && validAccount(data.account);
}

export function publicIdentity(value) {
  if (!exact(value, ["identity", "revision"]) ||
      !exact(value.identity, ["device_id", "fingerprint"]) ||
      !Number.isInteger(value.identity.device_id) || value.identity.device_id < 1 ||
      value.identity.device_id > 2147483647 ||
      typeof value.identity.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.identity.fingerprint) ||
      !Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new IdentityFailure("PROTOCOL_ERROR", "unknown");
  }
  return { identity: { ...value.identity }, revision: value.revision };
}

export function sameIdentity(a, b) {
  return a.device_id === b.device_id && a.fingerprint === b.fingerprint;
}
