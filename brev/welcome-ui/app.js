(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  // -- DOM refs --------------------------------------------------------

  const cardOpenclaw = $("#card-openclaw");
  const cardOther = $("#card-other");
  const overlayInstall = $("#overlay-install");
  const overlayInstr = $("#overlay-instructions");
  const closeInstall = $("#close-install");
  const closeInstr = $("#close-instructions");

  // Path 1 elements
  const stepKey = $("#install-step-key");
  const stepProgress = $("#install-step-progress");
  const stepSuccess = $("#install-step-success");
  const stepError = $("#install-step-error");
  const apiKeyInput = $("#api-key-input");
  const toggleKeyVis = $("#toggle-key-vis");
  const btnInstall = $("#btn-install");
  const btnRetry = $("#btn-retry");
  const btnOpenOpenclaw = $("#btn-open-openclaw");
  const errorMessage = $("#error-message");

  // Progress steps
  const pstepSandbox = $("#pstep-sandbox");
  const pstepGateway = $("#pstep-gateway");
  const pstepReady = $("#pstep-ready");

  // Path 2 elements
  const connectCmd = $("#connect-cmd");
  const copyConnect = $("#copy-connect");

  // -- SVG icons -------------------------------------------------------

  const iconEye = `<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const iconEyeOff = `<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" x2="23" y1="1" y2="23"/></svg>`;

  // -- Modal helpers ---------------------------------------------------

  function showOverlay(el) {
    el.hidden = false;
  }
  function hideOverlay(el) {
    el.hidden = true;
  }

  function closeOnBackdrop(overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) hideOverlay(overlay);
    });
  }

  // -- Visibility toggle for API key ----------------------------------

  let keyVisible = false;
  toggleKeyVis.addEventListener("click", () => {
    keyVisible = !keyVisible;
    apiKeyInput.type = keyVisible ? "text" : "password";
    toggleKeyVis.innerHTML = keyVisible ? iconEyeOff : iconEye;
  });

  // -- Copy to clipboard ----------------------------------------------

  function flashCopied(btn) {
    const original = btn.innerHTML;
    btn.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`;
    btn.classList.add("copy-btn--done");
    setTimeout(() => {
      btn.innerHTML = original;
      btn.classList.remove("copy-btn--done");
    }, 1500);
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".copy-btn");
    if (!btn) return;
    const text = btn.dataset.copy || btn.closest(".code-block")?.textContent?.trim();
    if (text) {
      navigator.clipboard.writeText(text).then(() => flashCopied(btn));
    }
  });

  // -- Progress step state machine ------------------------------------

  function setStepState(el, state) {
    el.classList.remove("progress-step--active", "progress-step--done", "progress-step--error");
    if (state) el.classList.add(`progress-step--${state}`);
  }

  // -- Path 1: Install flow -------------------------------------------

  function showInstallStep(step) {
    stepKey.hidden = step !== "key";
    stepProgress.hidden = step !== "progress";
    stepSuccess.hidden = step !== "success";
    stepError.hidden = step !== "error";
  }

  let pollTimer = null;

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function startInstall() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      apiKeyInput.focus();
      apiKeyInput.classList.add("form-field__input--error");
      setTimeout(() => apiKeyInput.classList.remove("form-field__input--error"), 1500);
      return;
    }

    showInstallStep("progress");
    setStepState(pstepSandbox, "active");
    setStepState(pstepGateway, null);
    setStepState(pstepReady, null);

    try {
      const res = await fetch("/api/install-openclaw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();

      if (!data.ok) {
        showError(data.error || "Failed to start sandbox creation");
        return;
      }

      setStepState(pstepSandbox, "done");
      setStepState(pstepGateway, "active");
      startPolling();
    } catch (err) {
      showError("Could not reach the server. Please try again.");
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch("/api/sandbox-status");
        const data = await res.json();

        if (data.status === "running") {
          stopPolling();
          setStepState(pstepGateway, "done");
          setStepState(pstepReady, "done");

          btnOpenOpenclaw.href = data.url || "http://127.0.0.1:18789/";
          showInstallStep("success");
        } else if (data.status === "error") {
          stopPolling();
          showError(data.error || "Sandbox creation failed");
        }
      } catch {
        // transient fetch error, keep polling
      }
    }, 3000);
  }

  function showError(msg) {
    stopPolling();
    errorMessage.textContent = msg;
    showInstallStep("error");
  }

  function resetInstall() {
    showInstallStep("key");
    setStepState(pstepSandbox, null);
    setStepState(pstepGateway, null);
    setStepState(pstepReady, null);
  }

  btnInstall.addEventListener("click", startInstall);
  apiKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startInstall();
  });
  btnRetry.addEventListener("click", resetInstall);

  // -- Path 1: Check if sandbox already running on load ---------------

  async function checkExistingSandbox() {
    try {
      const res = await fetch("/api/sandbox-status");
      const data = await res.json();
      if (data.status === "running" && data.url) {
        btnOpenOpenclaw.href = data.url;
        showInstallStep("success");
        showOverlay(overlayInstall);
      } else if (data.status === "creating") {
        showInstallStep("progress");
        setStepState(pstepSandbox, "done");
        setStepState(pstepGateway, "active");
        showOverlay(overlayInstall);
        startPolling();
      }
    } catch {
      // server not ready yet, ignore
    }
  }

  // -- Path 2: Load connection details --------------------------------

  async function loadConnectionDetails() {
    try {
      const res = await fetch("/api/connection-details");
      const data = await res.json();
      const cmd = `nemoclaw cluster connect ${data.hostname}`;
      connectCmd.textContent = cmd;
      copyConnect.dataset.copy = cmd;
    } catch {
      connectCmd.textContent = "nemoclaw cluster connect <hostname>";
    }
  }

  // -- Event wiring ---------------------------------------------------

  cardOpenclaw.addEventListener("click", () => {
    showOverlay(overlayInstall);
  });

  cardOther.addEventListener("click", () => {
    loadConnectionDetails();
    showOverlay(overlayInstr);
  });

  closeInstall.addEventListener("click", () => hideOverlay(overlayInstall));
  closeInstr.addEventListener("click", () => hideOverlay(overlayInstr));

  closeOnBackdrop(overlayInstall);
  closeOnBackdrop(overlayInstr);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideOverlay(overlayInstall);
      hideOverlay(overlayInstr);
    }
  });

  // -- Init -----------------------------------------------------------

  checkExistingSandbox();
})();
