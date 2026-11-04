// Node TLS fixture only. Never disable certificate validation in the client.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { attachPeer, SCENARIOS } from "../test-peer/peer.mjs";

const temporary = await mkdtemp(join(tmpdir(), "xmpp-tls-fixture-"));
let server, wss, child, timeout;
try {
  const cert = join(temporary, "cert.pem"), key = join(temporary, "key.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", key, "-out", cert], { stdio: "ignore" });
  server = createServer({ cert: await readFile(cert), key: await readFile(key) }, (_req, res) => {res.writeHead(404);res.end();});
  wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false,
    handleProtocols: (protocols, request) => new URL(request.url,"https://localhost").searchParams.get("scenario") !== "bad-subprotocol" && protocols.has("xmpp") ? "xmpp" : false });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url,"https://localhost"), scenario = url.searchParams.get("scenario");
    if (url.pathname !== "/qa-xmpp" || !SCENARIOS.includes(scenario)) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => attachPeer(ws, scenario));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `wss://127.0.0.1:${server.address().port}/qa-xmpp`;
  const args = [fileURLToPath(new URL("./transport-wasm-client.mjs", import.meta.url)), endpoint];
  if (process.argv[2]) args.push(process.argv[2]);
  child = spawn(process.execPath, args, { env: { ...process.env, NODE_EXTRA_CA_CERTS: cert }, stdio: "inherit" });
  timeout = setTimeout(() => child.kill("SIGTERM"), 90000);
  const code = await new Promise((resolve, reject) => { child.on("error",reject); child.on("exit",(code)=>resolve(code)); });
  if (code !== 0) process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  if (child && child.exitCode === null) child.kill("SIGTERM");
  for (const socket of wss?.clients ?? []) socket.terminate();
  wss?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
