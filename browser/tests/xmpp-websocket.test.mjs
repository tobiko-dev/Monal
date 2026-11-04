import { test } from "node:test";
import assert from "node:assert/strict";
import { XmppWebSocket, checkedEndpoint } from "../platform/xmpp-websocket.mjs";

class PeerSocket extends EventTarget {
  static all = [];
  constructor(url, protocols) {
    super(); this.url = url; this.protocols = protocols; this.protocol = "xmpp";
    this.readyState = 0; this.bufferedAmount = 0; this.sent = [];
    PeerSocket.all.push(this);
  }
  emit(type, data) { const event = new Event(type); event.data = data; this.dispatchEvent(event); }
  open() { this.readyState = 1; this.emit("open"); }
  send(data) { if (this.failSend) throw new Error("synthetic-private-value"); this.sent.push(data); }
  close() { this.readyState = 3; this.emit("close"); }
}
function fixture() {
  const events = [], timers = new Map(); let next = 0;
  const clock = { setTimeout(fn) { timers.set(++next, fn); return next; }, clearTimeout(id) { timers.delete(id); } };
  const adapter = new XmppWebSocket("wss://example.invalid/xmpp", (...args) => events.push(args),
    { WebSocketClass: PeerSocket, clock, limits: { frameBytes: 32, bufferedBytes: 64, connectMs: 50 } });
  adapter.connect(); const socket = PeerSocket.all.at(-1);
  return { adapter, socket, events, timers };
}
test("only explicit WSS endpoints without credentials, fragments or ambiguous characters are accepted", () => {
  assert.equal(checkedEndpoint("wss://example.invalid/xmpp"), "wss://example.invalid/xmpp");
  for (const url of ["ws://example.invalid/", "https://example.invalid/", "wss://u:p@example.invalid/", "wss://example.invalid/#x", " wss://example.invalid", "wss://example.invalid/\n", "wss:\\example.invalid", "relative"])
    assert.throws(() => checkedEndpoint(url), /INVALID_ENDPOINT/);
});
test("negotiates xmpp and passes ordered text frames without claiming delivery", () => {
  const {adapter,socket,events,timers}=fixture();
  assert.deepEqual(socket.protocols,["xmpp"]); assert.equal(adapter.send("early"),"NOT_OPEN");
  socket.open(); socket.emit("message","<one/>"); socket.emit("message","<two/>");
  assert.equal(adapter.send("<out/>"),"ACCEPTED");
  assert.deepEqual(events,[["connected",""],["data-received","<one/>"],["data-received","<two/>"]]);
  assert.deepEqual(socket.sent,["<out/>"]); assert.equal(timers.size,0); adapter.dispose();
});
test("missing or wrong subprotocol fails before data or connection success", () => {
  for (const protocol of ["", "other"]) {
    const {adapter,socket,events}=fixture(); socket.protocol=protocol; socket.open(); socket.emit("message","secret");
    assert.deepEqual(events,[["connection-failed","BAD_SUBPROTOCOL"]]); assert.equal(adapter.state,"closed");
  }
});
test("binary frames close the connection without forwarding content", () => {
  const {adapter,socket,events}=fixture();socket.open();socket.emit("message",new Uint8Array([1,2]).buffer);
  assert.deepEqual(events.at(-1),["disconnected","BINARY_FRAME"]); assert.equal(adapter.state,"closed");
});
test("incoming size is bounded in UTF-8 bytes as well as code units", () => {
  for (const data of ["x".repeat(33), "가".repeat(11)]) {
    const {socket,events}=fixture();socket.open();socket.emit("message",data);
    assert.deepEqual(events.at(-1),["disconnected","FRAME_TOO_LARGE"]); assert.equal(events.length,2);
  }
});
test("backpressure refuses writes without dropping them into an unbounded queue", () => {
  const {adapter,socket,events}=fixture();socket.open();socket.bufferedAmount=60;
  assert.equal(adapter.send("12345"),"BACKPRESSURE");assert.deepEqual(socket.sent,[]);
  socket.bufferedAmount=0;assert.equal(adapter.send("12345"),"ACCEPTED");
  assert.equal(events.length,1);adapter.dispose();
});
test("oversized outgoing text is rejected before socket.send", () => {
  const {adapter,socket}=fixture();socket.open();assert.equal(adapter.send("가".repeat(11)),"FRAME_TOO_LARGE");
  assert.deepEqual(socket.sent,[]);adapter.dispose();
});
test("connect timeout finalizes once and ignores late open, error and message events", () => {
  const {adapter,socket,events,timers}=fixture();[...timers.values()][0]();
  socket.open();socket.emit("error");socket.emit("message","late");
  assert.deepEqual(events,[["connection-failed","CONNECT_TIMEOUT"]]);assert.equal(timers.size,0);
  assert.throws(()=>adapter.connect(),/SOCKET_ALREADY_USED/);
});
test("cancellation while connecting cleans listeners and timers", () => {
  const {adapter,socket,events,timers}=fixture();adapter.disconnect();socket.open();socket.emit("message","late");
  assert.deepEqual(events,[["disconnected","LOCAL_CLOSE"]]);assert.equal(timers.size,0);
});
test("send exception produces a redacted terminal outcome once", () => {
  const {adapter,socket,events}=fixture();socket.open();socket.failSend=true;
  assert.equal(adapter.send("sensitive"),"SEND_FAILED");socket.emit("error");socket.emit("close");
  assert.deepEqual(events,[["connected",""],["disconnected","SEND_FAILED"]]);
});
test("disposal silences a former owner while a new connection remains usable", () => {
  const first=fixture();first.socket.open();first.adapter.dispose();const second=fixture();second.socket.open();
  first.socket.emit("message","stale");first.socket.emit("close");second.socket.emit("message","current");
  assert.deepEqual(first.events,[["connected",""]]);assert.deepEqual(second.events.at(-1),["data-received","current"]);second.adapter.dispose();
});
test("half close blocks only the corresponding direction and closes when both finish", () => {
  const {adapter,socket,events}=fixture();socket.open();adapter.shutdownOutput();
  assert.equal(adapter.send("no"),"NOT_OPEN");socket.emit("message","<close/>");
  assert.deepEqual(events.at(-1),["data-received","<close/>"]);adapter.shutdownInput();assert.equal(adapter.state,"closed");
});
test("failed constructor is redacted and reports no successful connection", () => {
  const events=[];const adapter=new XmppWebSocket("wss://example.invalid",(...a)=>events.push(a),{
    WebSocketClass:class { constructor(){throw new Error("private-url");} }
  });adapter.connect();assert.deepEqual(events,[["connection-failed","CONNECT_FAILED"]]);
});
