// Cloudflare Workers adapter for the private QA site, never an XMPP relay.
import { attachPeer, SCENARIOS } from "./peer.mjs";
let active = 0;
export function handleSyntheticPeer(request) {
  const url = new URL(request.url);
  if (url.pathname !== "/qa-xmpp") return null;
  const fail = status => new Response("Synthetic fixture unavailable", { status });
  if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return fail(400);
  if (request.headers.get("Origin") !== url.origin) return fail(403);
  const protocol = request.headers.get("Sec-WebSocket-Protocol")?.split(",").map(s=>s.trim());
  const scenario = url.searchParams.get("scenario");
  if (!protocol?.includes("xmpp") || !SCENARIOS.includes(scenario) || [...url.searchParams].length !== 1) return fail(400);
  if (active >= 4) return fail(429);
  const pair = new WebSocketPair(), client = pair[0], server = pair[1];
  server.accept(); active++;
  let released = false;
  const release = () => { if (!released) { released = true; active--; } };
  server.addEventListener("close", release); server.addEventListener("error", release);
  attachPeer(server, scenario);
  return new Response(null, { status: 101, webSocket: client,
    headers: scenario === "bad-subprotocol" ? {} : { "Sec-WebSocket-Protocol": "xmpp" } });
}
