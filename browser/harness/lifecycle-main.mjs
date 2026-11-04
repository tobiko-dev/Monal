const status = document.querySelector("#status");
const report = document.querySelector("#report");
const create = document.querySelector("#create");
const actions = [...document.querySelectorAll("[data-action]")];
const release = document.querySelector("#release");
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
  worker?.terminate(); worker = undefined;
  release.disabled = true;
  setBusy(false);
}
function send(action) {
  if (busy) return;
  if (!worker) { start(action); return; }
  setBusy(true);
  status.textContent = "Running synthetic storage operation…";
  worker.postMessage({ action });
}
function start(action) {
  initialAction = action;
  setBusy(true);
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
      status.textContent = "Holding an uncommitted change. Use the second tab, then close this tab or stop its worker.";
      release.disabled = false;
      append({ type: "held", ...data.result });
    } else {
      setBusy(false); release.disabled = true;
      if (data.type === "error") {
        status.textContent = `Test stopped: ${data.text}`;
        append({ type: "error", action: data.action, error: data.text });
      } else {
        status.textContent = data.result.cleaned ? "Synthetic test data deleted." :
          data.result.identity_preserved ? "Operation passed. Saved identities are unchanged." : "Operation completed.";
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
  run = crypto.randomUUID(); events = [];
  const url = new URL(location.href); url.searchParams.set("run", run); history.replaceState(null, "", url);
  start("create");
};
actions.forEach((button) => { button.onclick = () => send(button.dataset.action); });
release.onclick = () => { release.disabled = true; worker?.postMessage({ action: "release" }); };
document.querySelector("#terminate").onclick = () => {
  stop(); status.textContent = "Worker stopped. Resume to verify the last committed state.";
  append({ type: "worker_stopped", saved_state_needs_verification: true });
};
document.querySelector("#queue").onclick = async () => {
  const { held, pending } = await navigator.locks.query();
  const prefix = `gajim-qa-lifecycle-${run}:`;
  const count = (items) => items.filter((item) => item.name.startsWith(prefix)).length;
  append({ type: "lock_queue", held: count(held), pending: count(pending) });
};
addEventListener("pagehide", stop);
addEventListener("pageshow", (event) => { if (event.persisted && run && !worker) start("inspect"); });
if (run) start("inspect");
