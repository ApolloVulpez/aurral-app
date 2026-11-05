const form = document.querySelector("form");
const address = document.querySelector("#server");
const button = document.querySelector("button");
const error = document.querySelector("#error");

address.value = new URLSearchParams(location.search).get("server") ?? "";
form.addEventListener("submit", async event => {
  event.preventDefault();
  button.disabled = true;
  button.textContent = "Connecting…";
  error.textContent = "";
  try {
    error.textContent = await window.aurralSetup.connect(address.value);
  } catch {
    error.textContent = "Aurral couldn't connect. Try again.";
  } finally {
    button.disabled = false;
    button.textContent = "Connect";
  }
});
