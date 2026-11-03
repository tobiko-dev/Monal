const button = document.querySelector("button");
const status = document.querySelector("#status");
const output = document.querySelector("pre");
let worker;
button.addEventListener("click", () => {
  worker?.terminate();
  button.disabled = true;
  output.textContent = "";
  status.textContent = "Starting…";
  worker = new Worker("./worker.mjs", { type: "module" });
  const finish = () => { worker.terminate(); button.disabled = false; };
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") status.textContent = data.text;
    if (data.type === "result") {
      status.textContent = data.result.passed ? `${data.result.tests} tests passed` : "Checks failed";
      output.textContent = JSON.stringify(data.result, null, 2);
      finish();
    }
    if (data.type === "error") {
      status.textContent = "Checks could not complete";
      output.textContent = data.text;
      finish();
    }
  };
  worker.onerror = (event) => {
    status.textContent = "Worker failed";
    output.textContent = event.message;
    finish();
  };
});
