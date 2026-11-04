const status = document.querySelector("#status");
const report = document.querySelector("#report");
const create = document.querySelector("#create");
const actions = [...document.querySelectorAll("[data-action]")];
const release = document.querySelector("#release");
const activity = document.querySelector("#activity");
const latest = document.querySelector("#latest-result");
const labels = {
  create: "Create test", inspect: "Inspect saved identity", exchange: "Resume and exchange",
  hold: "Hold an uncommitted change", contend: "Check competing owner", cleanup: "Delete synthetic test",
};
let completed = 0;
let timer;
function begin(action) {
  clearInterval(timer);
  const started = performance.now();
  const update = () => {
    const seconds = Math.floor((performance.now() - started) / 1000);
    activity.textContent = `${labels[action] ?? action} · ${seconds}s elapsed` +
      (seconds >= 30 ? ". Still waiting. If it remains stuck, Stop this test worker preserves the last committed state." : "");
  };
  status.textContent = `${labels[action] ?? action}: starting…`;
  update(); timer = setInterval(update, 1000);
}
function finish() {
  clearInterval(timer); timer = undefined;
  activity.textContent = "";
}
function showResult(action, result) {
  const revisions = result.revisions ? ` Alice ${result.revisions.alice} / Bob ${result.revisions.bob}.` : "";
  const detail = action === "exchange" ? `${result.encrypted_exchanges} encrypted messages exchanged successfully.` :
    action === "inspect" ? "Saved identity inspected. Inspection does not change the revisions." :
    action === "create" ? "Test created. Save this page's URL, then reload and resume." :
    action === "hold" ? "Held change committed." :
    action === "contend" ? "Competing operation blocked; lock not stolen." : "Synthetic test data deleted.";
  latest.textContent = `Result ${++completed} — ${detail}${revisions}` +
    (result.identity_preserved ? " Identities unchanged." : "");
  status.textContent = `${labels[action] ?? action}: completed (result ${completed}).`;
}
let worker;
let run = new URL(location.href).searchParams.get("run");
let busy = false;
let initialAction = "inspect";
let events = [];

function append(event) {
  events.push(event);
  report.textContent = JSON.stringify({ run, events }, null, 2);
}
function setBusy(value) {
  busy = value;
  create.disabled = value || !!run;
  actions.forEach((button) => { button.disabled = value; });
}
function stop() {
  finish();
  worker?.terminate(); worker = undefined;
  release.disabled = true;
  setBusy(false);
}
function send(action) {
  if (busy) return;
  if (!worker) { start(action); return; }
  setBusy(true);
  begin(action);
  worker.postMessage({ action });
}
function start(action) {
  initialAction = action;
  setBusy(true);
  begin(action);
  status.textContent = "Starting the encryption worker and loading its test assets…";
  const link = document.querySelector("#same-test");
  link.href = location.href; link.hidden = false;
  document.querySelector("#operations").hidden = false;
  worker = new Worker(new URL("./lifecycle-worker.mjs", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") { status.textContent = data.text; return; }
    if (data.type === "ready") {
      append({ type: "runtime", ...data.baseline });
      worker.postMessage({ action: initialAction });
    } else if (data.type === "held") {
      finish();
      status.textContent = "Holding an uncommitted change. Use the second tab, then close this tab or stop its worker.";
      release.disabled = false;
      append({ type: "held", ...data.result });
    } else {
      finish();
      setBusy(false); release.disabled = true;
      if (data.type === "error") {
        status.textContent = `Test stopped: ${data.text}`;
        latest.textContent = `${labels[data.action] ?? data.action ?? "Operation"} failed: ${data.text}. Saved data was not reset.`;
        append({ type: "error", action: data.action, error: data.text });
      } else {
        showResult(data.action, data.result);
        append({ type: "result", action: data.action, ...data.result });
        if (data.result.cleaned) {
          stop(); run = null;
          const url = new URL(location.href); url.searchParams.delete("run"); history.replaceState(null, "", url);
          document.querySelector("#same-test").hidden = true;
          document.querySelector("#operations").hidden = true;
          setBusy(false);
        }
      }
    }
  };
  worker.onerror = () => {
    stop(); status.textContent = "Test worker failed; saved data was not reset.";
    append({ type: "error", error: "WORKER_FAILED" });
  };
  worker.postMessage({ action: "init", run });
}

create.onclick = () => {
  run = crypto.randomUUID(); events = []; completed = 0; latest.textContent = "";
  const url = new URL(location.href); url.searchParams.set("run", run); history.replaceState(null, "", url);
  start("create");
};
actions.forEach((button) => { button.onclick = () => send(button.dataset.action); });
release.onclick = () => {
  release.disabled = true; begin("hold");
  status.textContent = "Committing the held change…";
  worker?.postMessage({ action: "release" });
};
document.querySelector("#terminate").onclick = () => {
  stop(); status.textContent = "Worker stopped. Resume to verify the last committed state.";
  append({ type: "worker_stopped", saved_state_needs_verification: true });
};
document.querySelector("#queue").onclick = async () => {
  latest.textContent = "Inspecting the lock queue…";
  try {
    const { held, pending } = await navigator.locks.query();
    const prefix = `gajim-qa-lifecycle-${run}:`;
    const count = (items) => items.filter((item) => item.name.startsWith(prefix)).length;
    const result = { type: "lock_queue", held: count(held), pending: count(pending) };
    latest.textContent = `Result ${++completed} — Lock queue: ${result.held} held, ${result.pending} waiting.`;
    append(result);
  } catch (error) {
    latest.textContent = `Lock queue inspection failed: ${error.message}`;
    append({ type: "error", action: "queue", error: error.message });
  }
};
addEventListener("pagehide", stop);
addEventListener("pageshow", (event) => { if (event.persisted && run && !worker) start("inspect"); });
if (run) start("inspect");
