const status = document.querySelector(".copy-status");

for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    const source = document.getElementById(button.dataset.copy);
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source.textContent ?? "");
      button.textContent = "Copied";
      status.textContent = "Command copied to clipboard.";
    } catch {
      status.textContent = "Copy was blocked. Select the command manually.";
    }
    status.classList.add("visible");
    window.setTimeout(() => {
      status.classList.remove("visible");
      button.textContent = "Copy";
    }, 1800);
  });
}
