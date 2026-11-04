// Byte transport only. nbxmpp owns XML, authentication and stream state.
export const SOCKET_LIMITS = Object.freeze({
  frameBytes: 1024 * 1024, bufferedBytes: 2 * 1024 * 1024, connectMs: 15000,
});
const encoder = new TextEncoder();

export function checkedEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048 || /[\s\x00-\x1f\x7f\\]/.test(value)) {
    throw new Error("INVALID_ENDPOINT");
  }
  let url;
  try { url = new URL(value); } catch { throw new Error("INVALID_ENDPOINT"); }
  if (url.protocol !== "wss:" || !url.hostname || url.username || url.password || url.hash) {
    throw new Error("INVALID_ENDPOINT");
  }
  return url.href;
}

export class XmppWebSocket {
  #socket; #callback; #listeners = []; #timer; #state = "new";
  #inputClosed = false; #outputClosed = false; #opened = false;
  #endpoint; #WebSocketClass; #clock; #limits;
  constructor(endpoint, callback, { WebSocketClass = globalThis.WebSocket,
    limits = SOCKET_LIMITS, clock = globalThis } = {}) {
    this.#endpoint = checkedEndpoint(endpoint);
    if (typeof callback !== "function" || typeof WebSocketClass !== "function") throw new Error("SOCKET_UNAVAILABLE");
    this.#callback = callback;
    this.#WebSocketClass = WebSocketClass; this.#clock = clock;
    this.#limits = { ...limits };
    for (const key of Object.keys(SOCKET_LIMITS)) {
      if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > SOCKET_LIMITS[key]) {
        throw new Error("INVALID_SOCKET_LIMIT");
      }
    }
  }
  get state() { return this.#state; }
  get endpoint() { return this.#endpoint; }
  get bufferedAmount() { return this.#socket?.bufferedAmount ?? 0; }
  #listen(type, listener) {
    this.#socket.addEventListener(type, listener);
    this.#listeners.push([type, listener]);
  }
  #finish(code, notify = true) {
    if (this.#state === "closed") return;
    this.#state = "closed";
    this.#inputClosed = this.#outputClosed = true;
    this.#clock.clearTimeout(this.#timer);
    const socket = this.#socket;
    for (const [type, listener] of this.#listeners) socket.removeEventListener(type, listener);
    this.#listeners = []; this.#socket = undefined;
    // Close even while CONNECTING. A queued event can no longer reach this owner.
    try { if (socket && socket.readyState < 2) socket.close(1000); } catch { /* already unusable */ }
    const callback = this.#callback;
    this.#callback = undefined;
    if (notify) callback(this.#opened ? "disconnected" : "connection-failed", code);
  }
  connect() {
    if (this.#state !== "new") throw new Error("SOCKET_ALREADY_USED");
    this.#state = "connecting";
    try {
      this.#socket = new this.#WebSocketClass(this.#endpoint, ["xmpp"]);
      this.#socket.binaryType = "arraybuffer";
      this.#listen("open", () => {
        if (this.#state !== "connecting") return;
        if (this.#socket.protocol !== "xmpp") { this.#finish("BAD_SUBPROTOCOL"); return; }
        this.#clock.clearTimeout(this.#timer);
        this.#state = "open"; this.#opened = true;
        this.#callback("connected", "");
      });
      this.#listen("message", ({ data }) => {
        if (this.#state !== "open" || this.#inputClosed) return;
        if (typeof data !== "string") { this.#finish("BINARY_FRAME"); return; }
        // Reject by code-unit length first, before allocating encoded bytes.
        if (data.length > this.#limits.frameBytes || encoder.encode(data).length > this.#limits.frameBytes) {
          this.#finish("FRAME_TOO_LARGE"); return;
        }
        this.#callback("data-received", data);
      });
      this.#listen("error", () => this.#finish("SOCKET_ERROR"));
      this.#listen("close", () => this.#finish("SOCKET_CLOSED"));
      this.#timer = this.#clock.setTimeout(() => this.#finish("CONNECT_TIMEOUT"), this.#limits.connectMs);
    } catch {
      this.#finish("CONNECT_FAILED");
    }
  }
  send(text) {
    if (this.#state !== "open" || this.#outputClosed || this.#socket.readyState !== 1) return "NOT_OPEN";
    if (typeof text !== "string" || text.length > this.#limits.frameBytes) return "FRAME_TOO_LARGE";
    const size = encoder.encode(text).length;
    if (size > this.#limits.frameBytes) return "FRAME_TOO_LARGE";
    if (this.#socket.bufferedAmount + size > this.#limits.bufferedBytes) return "BACKPRESSURE";
    try { this.#socket.send(text); } catch { this.#finish("SEND_FAILED"); return "SEND_FAILED"; }
    // Browser acceptance is not server acknowledgement, delivery or reading.
    return "ACCEPTED";
  }
  shutdownInput() {
    this.#inputClosed = true;
    if (this.#outputClosed) this.disconnect();
  }
  shutdownOutput() {
    this.#outputClosed = true;
    if (this.#inputClosed) this.disconnect();
  }
  disconnect() {
    this.#opened = true; // Deliberate cancellation reports disconnected, not failure.
    this.#finish("LOCAL_CLOSE");
  }
  dispose() { this.#finish("DISPOSED", false); }
}

// Installed explicitly per client, never as a default automatic network route.
export function makeSocket(endpoint, callback) {
  return new XmppWebSocket(endpoint, callback);
}
