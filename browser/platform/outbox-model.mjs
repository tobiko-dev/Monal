// GPL-3.0-only. Local queue data is not encrypted at rest.
import { validAccount } from "./identity-protocol.mjs";

export const OUTBOX_LIMIT = 256;
export const TEXT_LIMIT = 64 * 1024;
export const PAYLOAD_LIMIT = 1024 * 1024;
export const QUEUE_BYTES_LIMIT = 24 * 1024 * 1024;
const encoder = new TextEncoder();
const exact = (value, keys) => value && typeof value === "object" &&
  !Array.isArray(value) && Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
export const validMessageId = (id) => typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
export const blockCodes = new Set(["MISSING_KEYS", "UNVERIFIED_KEYS", "RECIPIENT_CHANGED", "ENCRYPTION_FAILED"]);

export class OutboxFailure extends Error {
  constructor(code) { super(code); this.name = "OutboxFailure"; this.code = code; }
}

// Only known, actionable preparation failures become a persisted blocked state.
// Unknown exceptions remain failures; do not copy their text into saved records.
export class PreparationBlocked extends OutboxFailure {
  constructor(code) {
    super(blockCodes.has(code) ? code : "ENCRYPTION_FAILED");
    this.name = "PreparationBlocked";
  }
}

export function validDraft(draft) {
  return exact(draft, ["id", "conversation", "text"]) && validMessageId(draft.id) &&
    validAccount(draft.conversation) && typeof draft.text === "string" &&
    draft.text.length > 0 && draft.text.length <= TEXT_LIMIT &&
    encoder.encode(draft.text).byteLength <= TEXT_LIMIT;
}

export function encodePrepared(format, bytes) {
  if (typeof format !== "string" || !/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(format) ||
      !(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > PAYLOAD_LIMIT) {
    throw new OutboxFailure("INVALID_PREPARATION");
  }
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return { format, base64: btoa(binary) };
}

export function validEntries(entries) {
  if (!Array.isArray(entries) || entries.length > OUTBOX_LIMIT) return false;
  const ids = new Set();
  for (const entry of entries) {
    if (!exact(entry, ["id", "conversation", "text", "created_at", "state", "error", "prepared"]) ||
        !validDraft({ id: entry.id, conversation: entry.conversation, text: entry.text }) ||
        ids.has(entry.id) || !Number.isSafeInteger(entry.created_at) || entry.created_at < 0) return false;
    ids.add(entry.id);
    if (entry.state === "queued") {
      if (entry.error !== null || entry.prepared !== null) return false;
    } else if (entry.state === "blocked") {
      if (!blockCodes.has(entry.error) || entry.prepared !== null) return false;
    } else if (entry.state === "prepared") {
      const value = entry.prepared;
      if (entry.error !== null || !exact(value, ["format", "base64"]) ||
          typeof value.format !== "string" || !/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(value.format) ||
          typeof value.base64 !== "string" || !value.base64.length ||
          value.base64.length > 4 * Math.ceil(PAYLOAD_LIMIT / 3) ||
          value.base64.length % 4 !== 0 ||
          value.base64.length / 4 * 3 - (value.base64.endsWith("==") ? 2 : value.base64.endsWith("=") ? 1 : 0) > PAYLOAD_LIMIT ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(value.base64)) return false;
    } else return false;
  }
  return encoder.encode(JSON.stringify(entries)).byteLength <= QUEUE_BYTES_LIMIT;
}

// The UI may display its own queued text. Crypto snapshots and prepared payloads
// stay behind the worker/service boundary. Prepared is never called sent/read.
export function visibleMessage(entry) {
  const { id, conversation, text, created_at, state, error } = entry;
  return { id, conversation, text, created_at, state, error };
}
