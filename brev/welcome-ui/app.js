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

  // Install modal elements
  const installMain = $("#install-main");
  const stepError = $("#install-step-error");
  const apiKeyInput = $("#api-key-input");
  const toggleKeyVis = $("#toggle-key-vis");
  const keyHint = $("#key-hint");
  const btnLaunch = $("#btn-launch");
  const btnLaunchLabel = $("#btn-launch-label");
  const btnSpinner = $("#btn-spinner");
  const btnRetry = $("#btn-retry");
  const errorMessage = $("#error-message");

  // Console log lines
  const logSandbox = $("#log-sandbox");
  const logSandboxIcon = $("#log-sandbox-icon");
  const logGateway = $("#log-gateway");
  const logGatewayIcon = $("#log-gateway-icon");
  const logReady = $("#log-ready");

  // Path 2 elements
  const connectCmd = $("#connect-cmd");
  const copyConnect = $("#copy-connect");

  // -- SVG icons -------------------------------------------------------

  const iconEye = `<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const iconEyeOff = `<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" x2="23" y1="1" y2="23"/></svg>`;

  const SPINNER_CHAR = "↻";
  const CHECK_CHAR = "✓";

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

  // -- API key validation ---------------------------------------------

  function isApiKeyValid() {
    const v = apiKeyInput.value.trim();
    return v.startsWith("nvapi-") || v.startsWith("sk-");
  }

  // -- Console log helpers --------------------------------------------

  function setLogIcon(iconEl, state) {
    if (state === "spin") {
      iconEl.textContent = SPINNER_CHAR;
      iconEl.className = "console__icon console__icon--spin";
    } else if (state === "done") {
      iconEl.textContent = CHECK_CHAR;
      iconEl.className = "console__icon console__icon--done";
    } else {
      iconEl.textContent = "";
      iconEl.className = "console__icon";
    }
  }

  // -- Install state ---------------------------------------------------

  let sandboxReady = false;
  let sandboxUrl = null;
  let installTriggered = false;
  let pollTimer = null;
  let keyInjected = false;
  let injectInFlight = false;
  let injectTimer = null;
  let lastSubmittedKey = "";

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function submitKeyForInjection(key) {
    if (key === lastSubmittedKey) return;
    lastSubmittedKey = key;
    keyInjected = false;
    injectInFlight = true;
    updateButtonState();
    try {
      await fetch("/api/inject-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
    } catch {}
    injectInFlight = false;
    if (!pollTimer && sandboxReady) startPolling();
  }

  function onApiKeyInput() {
    updateButtonState();
    const key = apiKeyInput.value.trim();
    if (!isApiKeyValid()) return;
    if (injectTimer) clearTimeout(injectTimer);
    injectTimer = setTimeout(() => submitKeyForInjection(key), 300);
  }

  /**
   * Five-state CTA button:
   *  1. API empty  + tasks running        -> "Waiting for API key…"      (disabled)
   *  2. API valid  + tasks running        -> "Provisioning Sandbox…"     (disabled, spinner)
   *  3. API empty  + tasks complete       -> "Waiting for API key…"      (disabled)
   *  4. API valid  + sandbox ready + !key -> "Configuring API key…"      (disabled, spinner)
   *  5. API valid  + sandbox ready + key  -> "Open NemoClaw"             (enabled)
   */
  function updateButtonState() {
    const keyValid = isApiKeyValid();
    const keyRaw = apiKeyInput.value.trim();

    // Hint feedback below input
    if (keyRaw.length === 0) {
      keyHint.textContent = "";
      keyHint.className = "form-field__hint";
    } else if (keyValid) {
      keyHint.textContent = "Valid key format";
      keyHint.className = "form-field__hint form-field__hint--ok";
    } else {
      keyHint.textContent = "Key must start with nvapi- or sk-";
      keyHint.className = "form-field__hint form-field__hint--warn";
    }

    // Console "ready" line
    if (sandboxReady && keyValid && keyInjected) {
      logReady.hidden = false;
      logReady.querySelector(".console__icon").textContent = CHECK_CHAR;
      logReady.querySelector(".console__icon").className = "console__icon console__icon--done";
    } else {
      logReady.hidden = true;
    }

    if (sandboxReady && keyValid && keyInjected) {
      btnLaunch.disabled = false;
      btnLaunch.classList.add("btn--ready");
      btnSpinner.hidden = true;
      btnSpinner.style.display = "none";
      btnLaunchLabel.textContent = "Open NemoClaw";
    } else if (sandboxReady && keyValid && !keyInjected) {
      btnLaunch.disabled = true;
      btnLaunch.classList.remove("btn--ready");
      btnSpinner.hidden = false;
      btnSpinner.style.display = "";
      btnLaunchLabel.textContent = "Configuring API key\u2026";
    } else if (!sandboxReady && keyValid) {
      btnLaunch.disabled = true;
      btnLaunch.classList.remove("btn--ready");
      btnSpinner.hidden = false;
      btnSpinner.style.display = "";
      btnLaunchLabel.textContent = "Provisioning Sandbox\u2026";
    } else {
      btnLaunch.disabled = true;
      btnLaunch.classList.remove("btn--ready");
      btnSpinner.hidden = true;
      btnSpinner.style.display = "none";
      btnLaunchLabel.textContent = "Waiting for API key\u2026";
    }
  }

  function showMainView() {
    installMain.hidden = false;
    stepError.hidden = true;
  }

  function showError(msg) {
    stopPolling();
    installMain.hidden = true;
    stepError.hidden = false;
    errorMessage.textContent = msg;
  }

  async function triggerInstall() {
    if (installTriggered) return;
    installTriggered = true;

    setLogIcon(logSandboxIcon, "spin");
    setLogIcon(logGatewayIcon, null);
    logReady.hidden = true;
    updateButtonState();

    try {
      const res = await fetch("/api/install-openclaw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();

      if (!data.ok) {
        installTriggered = false;
        showError(data.error || "Failed to start sandbox creation");
        return;
      }

      setLogIcon(logSandboxIcon, "done");
      logSandbox.querySelector(".console__text").textContent =
        "Secure NemoClaw sandbox created.";
      setLogIcon(logGatewayIcon, "spin");
      startPolling();
    } catch {
      installTriggered = false;
      showError("Could not reach the server. Please try again.");
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch("/api/sandbox-status");
        const data = await res.json();

        if (!injectInFlight) {
          keyInjected = !!data.key_injected;
        }

        if (data.status === "running") {
          sandboxReady = true;
          sandboxUrl = data.url || null;

          setLogIcon(logGatewayIcon, "done");
          logGateway.querySelector(".console__text").textContent =
            "OpenClaw agent gateway online.";

          if (keyInjected) {
            stopPolling();
          }
          updateButtonState();
        } else if (data.status === "error") {
          stopPolling();
          installTriggered = false;
          showError(data.error || "Sandbox creation failed");
        } else {
          updateButtonState();
        }
      } catch {
        // transient fetch error, keep polling
      }
    }, 3000);
  }

  function openOpenClaw() {
    if (!sandboxReady || !isApiKeyValid() || !keyInjected || !sandboxUrl) return;

    const apiKey = apiKeyInput.value.trim();
    const url = new URL(sandboxUrl);
    url.searchParams.set("nvapi", apiKey);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }

  function resetInstall() {
    sandboxReady = false;
    sandboxUrl = null;
    installTriggered = false;
    keyInjected = false;
    lastSubmittedKey = "";
    stopPolling();

    setLogIcon(logSandboxIcon, null);
    setLogIcon(logGatewayIcon, null);
    logSandbox.querySelector(".console__text").textContent =
      "Initializing secure NemoClaw sandbox...";
    logGateway.querySelector(".console__text").textContent =
      "Launching OpenClaw agent gateway...";
    logReady.hidden = true;

    showMainView();
    updateButtonState();
    triggerInstall();
  }

  apiKeyInput.addEventListener("input", onApiKeyInput);
  btnLaunch.addEventListener("click", openOpenClaw);
  btnRetry.addEventListener("click", resetInstall);

  // -- Check if sandbox already running on load -----------------------

  async function checkExistingSandbox() {
    try {
      const res = await fetch("/api/sandbox-status");
      const data = await res.json();

      if (data.key_injected) {
        keyInjected = true;
      }

      if (data.status === "running" && data.url) {
        sandboxReady = true;
        sandboxUrl = data.url;
        installTriggered = true;

        setLogIcon(logSandboxIcon, "done");
        logSandbox.querySelector(".console__text").textContent =
          "Secure NemoClaw sandbox created.";
        setLogIcon(logGatewayIcon, "done");
        logGateway.querySelector(".console__text").textContent =
          "OpenClaw agent gateway online.";
        updateButtonState();

        showOverlay(overlayInstall);
        if (!keyInjected) {
          startPolling();
        }
      } else if (data.status === "creating") {
        installTriggered = true;

        setLogIcon(logSandboxIcon, "done");
        logSandbox.querySelector(".console__text").textContent =
          "Secure NemoClaw sandbox created.";
        setLogIcon(logGatewayIcon, "spin");
        updateButtonState();

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
    showMainView();
    if (!installTriggered) {
      triggerInstall();
    }
    apiKeyInput.focus();
    updateButtonState();
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
