import { IdentityFailure, VERSION, MAX_PENDING, codes, validAccount, publicIdentity, sameIdentity } from "./identity-protocol.mjs";

// Page-facing API: public fingerprints only; never snapshots, keys or callbacks.
export class IdentityClient {
  #worker;
  #requests = new Map();
  #nextID = 1;
  #identity;
  #account;
  constructor(account, { createWorker = () => new Worker(new URL("./identity-worker.mjs", import.meta.url),
    { type: "module" }), timeoutMs = 180000 } = {}) {
    if (!validAccount(account)) throw new IdentityFailure("INVALID_REQUEST");
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new IdentityFailure("INVALID_REQUEST");
    this.#account = account;
    this.createWorker = createWorker;
    this.timeoutMs = timeoutMs;
  }

  open() { return this.#request("open"); }
  create() { return this.#request("create"); }
  close() { this.#stop("WORKER_STOPPED"); }
  get account() { return this.#account; }

  #stop(code) {
    const worker = this.#worker;
    this.#worker = undefined;
    worker?.terminate();
    for (const request of this.#requests.values()) {
      clearTimeout(request.timer);
      request.reject(new IdentityFailure(code, request.command === "create" ? "unknown" : "read_only"));
    }
    this.#requests.clear();
  }

  #start() {
    const worker = this.createWorker();
    this.#worker = worker;
    worker.onmessage = ({ data }) => {
      if (this.#worker !== worker) return; // Ignore a stopped worker's late reply.
      const request = this.#requests.get(data?.id);
      if (!request || data.version !== VERSION || typeof data.ok !== "boolean") {
        this.#stop("PROTOCOL_ERROR"); return;
      }
      try {
        if (data.ok) {
          const result = publicIdentity(data.result);
          if (this.#identity && !sameIdentity(result.identity, this.#identity)) {
            throw new IdentityFailure("IDENTITY_CHANGED");
          }
          this.#identity = { ...result.identity };
          request.resolve(result);
        } else {
          if (!codes.has(data.error?.code) || !["not_committed", "unknown", "read_only"].includes(data.error?.outcome)) {
            throw new IdentityFailure("PROTOCOL_ERROR");
          }
          request.reject(new IdentityFailure(data.error.code, data.error.outcome));
        }
      } catch (error) {
        this.#stop(error.code === "IDENTITY_CHANGED" ? "IDENTITY_CHANGED" : "PROTOCOL_ERROR");
        return;
      }
      clearTimeout(request.timer);
      this.#requests.delete(data.id);
    };
    worker.onerror = (event) => { event.preventDefault?.(); if (this.#worker === worker) this.#stop("WORKER_FAILED"); };
    worker.onmessageerror = () => { if (this.#worker === worker) this.#stop("PROTOCOL_ERROR"); };
  }

  #request(command) {
    if (this.#requests.size >= MAX_PENDING) return Promise.reject(new IdentityFailure("QUEUE_FULL"));
    try { if (!this.#worker) this.#start(); }
    catch { return Promise.reject(new IdentityFailure("WORKER_FAILED")); }
    const id = this.#nextID++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#stop("WORKER_TIMEOUT"), this.timeoutMs);
      this.#requests.set(id, { resolve, reject, timer, command });
      try { this.#worker.postMessage({ version: VERSION, id, command, account: this.#account }); }
      catch { this.#stop("WORKER_FAILED"); }
    });
  }
}
