// GPL-3.0-only. Worker-internal service; deliberately has no network dispatcher.
import {
  OUTBOX_LIMIT, OutboxFailure, PreparationBlocked, encodePrepared,
  validDraft, validMessageId, visibleMessage,
} from "./outbox-model.mjs";

export class OutboxService {
  constructor(repository, engine, { now = () => Date.now() } = {}) {
    this.repository = repository;
    this.engine = engine;
    this.now = now;
  }

  async enqueue(account, draft) {
    if (!validDraft(draft)) throw new OutboxFailure("INVALID_MESSAGE");
    // Capture the intent before waiting for storage/locks; later caller edits
    // must not change which body/conversation a stable message ID represents.
    const intent = { ...draft };
    return this.repository.updateOutbox(account, ({ entries }) => {
      const existing = entries.find((entry) => entry.id === intent.id);
      if (existing) {
        if (existing.conversation !== intent.conversation || existing.text !== intent.text) {
          throw new OutboxFailure("MESSAGE_CONFLICT");
        }
        return { unchanged: true, result: visibleMessage(existing) };
      }
      if (entries.length >= OUTBOX_LIMIT) throw new OutboxFailure("OUTBOX_FULL");
      const entry = { ...intent, created_at: this.now(), state: "queued", error: null, prepared: null };
      return { entries: [...entries, entry], result: visibleMessage(entry) };
    });
  }

  async list(account) {
    return this.repository.readOutbox(account, ({ entries }) => entries.map(visibleMessage));
  }

  // A deliberate call retries a blocked preparation. Already committed work is
  // returned without invoking crypto again. No implicit retries or plaintext
  // fallback exist. The injected engine is trusted worker-internal code, not a
  // callback accepted from the page, and must return only encrypted payloads.
  async prepare(account, id) {
    if (!validMessageId(id)) throw new OutboxFailure("INVALID_MESSAGE");
    return this.repository.updateOutbox(account, async ({ entries, ...saved }) => {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index === -1) throw new OutboxFailure("MESSAGE_NOT_FOUND");
      const entry = entries[index];
      if (entry.state === "prepared") return { unchanged: true, result: visibleMessage(entry) };
      if (entries.slice(0, index).some((earlier) => earlier.conversation === entry.conversation &&
          earlier.state !== "prepared")) throw new OutboxFailure("EARLIER_MESSAGE_PENDING");
      if (!this.engine?.prepare) throw new OutboxFailure("PREPARER_UNAVAILABLE");
      let change;
      try {
        change = await this.engine.prepare(account, saved, { ...entry });
      } catch (error) {
        if (!(error instanceof PreparationBlocked)) throw error;
        entries[index] = { ...entry, state: "blocked", error: error.code, prepared: null };
        return { entries, result: visibleMessage(entries[index]) };
      }
      if (!change) throw new OutboxFailure("INVALID_PREPARATION");
      entries[index] = { ...entry, state: "prepared", error: null,
        prepared: encodePrepared(change.format, change.ciphertext) };
      return { entries, snapshot: change.snapshot, identity: change.identity,
        result: visibleMessage(entries[index]) };
    });
  }
}
