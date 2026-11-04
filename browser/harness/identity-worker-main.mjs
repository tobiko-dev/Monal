import { runIdentityWorkerChecks } from "./identity-worker-checks.mjs";

const button = document.querySelector("#run");
const status = document.querySelector("#status");
const output = document.querySelector("#report");
button.onclick = async () => {
  button.disabled = true; output.textContent = "";
  const started = performance.now(); let progress = "Starting workers…";
  const update = () => { status.textContent = `${progress} (${Math.floor((performance.now() - started) / 1000)}s)`; };
  update(); const timer = setInterval(update, 1000);
  try {
    const result = await runIdentityWorkerChecks((text) => { progress = text; update(); });
    output.textContent = JSON.stringify({ ...result, elapsed_ms: Math.round(performance.now() - started) }, null, 2);
    status.textContent = `${result.checks.length} worker checks passed. Synthetic test data deleted.`;
  } catch (error) {
    status.textContent = `Check stopped: ${error.code ?? error.message}`;
    output.textContent = JSON.stringify({ passed: false, error: error.code ?? error.message });
  } finally { clearInterval(timer); button.disabled = false; }
};
