const button = document.querySelector("#run");
const status = document.querySelector("#status");
const output = document.querySelector("#report");
button.onclick = () => {
  button.disabled = true; output.textContent = "";
  const started = performance.now();
  let progress = "Starting checks…", finished = false, worker, timer, watchdog;
  const update = () => { status.textContent = `${progress} (${Math.floor((performance.now() - started) / 1000)}s)`; };
  const finish = () => {
    finished = true; clearInterval(timer); clearTimeout(watchdog);
    worker?.terminate(); button.disabled = false;
  };
  const fail = (text) => {
    if (finished) return;
    status.textContent = `Checks stopped: ${text}`;
    output.textContent = JSON.stringify({ passed: false, error: text }, null, 2);
    finish();
  };
  update();
  try {
    worker = new Worker(new URL("./transport-worker.mjs", import.meta.url), { type: "module" });
  } catch {
    fail("Worker could not start; no pass claimed."); return;
  }
  timer = setInterval(update, 1000);
  watchdog = setTimeout(() => fail("Timed out; no pass claimed."), 180000);
  worker.onmessage = ({ data }) => {
    if (finished) return;
    if (data.type === "progress") { progress = data.text; update(); }
    else if (data.type === "error") fail(data.text);
    else if (data.type === "result") {
      output.textContent = JSON.stringify(data.result, null, 2);
      const r = data.result;
      status.textContent = r.passed ?
        `${r.checks.length} WebSocket connection checks passed.` :
        "Checks failed. See the result below.";
      finish();
    }
  };
  worker.onerror = () => fail("Worker failed; no pass claimed.");
  worker.onmessageerror = () => fail("Worker response could not be read; no pass claimed.");
};
