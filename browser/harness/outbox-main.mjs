const button = document.querySelector("#run");
const status = document.querySelector("#status");
const output = document.querySelector("#report");
button.onclick = () => {
  button.disabled = true; output.textContent = "";
  const started = performance.now(); let progress = "Starting checks…";
  const update = () => { status.textContent = `${progress} (${Math.floor((performance.now() - started) / 1000)}s)`; };
  update();
  const timer = setInterval(update, 1000);
  const worker = new Worker(new URL("./outbox-worker.mjs", import.meta.url), { type: "module" });
  const finish = () => { clearInterval(timer); clearTimeout(watchdog); worker.terminate(); button.disabled = false; };
  const fail = (text) => {
    status.textContent = `Checks stopped: ${text}`;
    output.textContent = JSON.stringify({ passed: false, error: text }, null, 2);
    finish();
  };
  const watchdog = setTimeout(() => fail("Timed out; no pass claimed. Disposable test data may remain after interruption."), 180000);
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") { progress = data.text; update(); }
    else if (data.type === "error") fail(data.text);
    else if (data.type === "result") {
      output.textContent = JSON.stringify(data.result, null, 2);
      status.textContent = data.result.passed ?
        `${data.result.outbox.checks.length} outbox checks passed. Synthetic test data deleted.` : "Checks failed. See the result below.";
      finish();
    }
  };
  worker.onerror = () => fail("Worker failed; no pass claimed.");
  worker.onmessageerror = () => fail("Worker response could not be read; no pass claimed.");
};
