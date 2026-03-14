/**
 * NeMoClaw DevX Extension
 *
 * Injects into the OpenClaw UI:
 *   1. A green "Deploy DGX Spark/Station" CTA button in the topbar
 *   2. A "NeMoClaw" collapsible nav group with Policy, Inference Routes,
 *      and API Keys pages
 *   3. A model selector wired to NVIDIA endpoints
 *
 * Operates purely as an overlay — no original OpenClaw source files are modified.
 */

import "./styles.css";
import { injectButton } from "./deploy-modal.ts";
import { injectNavGroup, activateNemoPage, watchOpenClawNavClicks } from "./nav-group.ts";
import { injectModelSelector, watchChatCompose } from "./model-selector.ts";
import { ingestKeysFromUrl, DEFAULT_MODEL, resolveApiKey, isKeyConfigured } from "./model-registry.ts";
import { waitForReconnect, waitForStableConnection } from "./gateway-bridge.ts";
import { syncKeysToProviders } from "./api-keys-page.ts";

const INITIAL_CONNECT_TIMEOUT_MS = 30_000;
const EXTENDED_CONNECT_TIMEOUT_MS = 300_000;
const POST_PAIRING_SETTLE_DELAY_MS = 15_000;
const STABLE_CONNECTION_WINDOW_MS = 10_000;
const STABLE_CONNECTION_TIMEOUT_MS = 45_000;
const PAIRING_RELOAD_FLAG = "nemoclaw:pairing-bootstrap-reloaded";
const FORCED_RELOAD_DELAY_MS = 1_000;

function inject(): boolean {
  const hasButton = injectButton();
  const hasNav = injectNavGroup();
  return hasButton && hasNav;
}

/**
 * Delegated click handler for [data-nemoclaw-goto] links embedded in
 * error messages (deploy modal, model selector banners). Navigates to
 * the target NeMoClaw page without a full page reload.
 */
function watchGotoLinks() {
  document.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement).closest<HTMLElement>("[data-nemoclaw-goto]");
    if (!link) return;
    e.preventDefault();
    const pageId = link.dataset.nemoclawGoto;
    if (pageId) activateNemoPage(pageId);
  });
}

/**
 * Insert a full-screen loading overlay that covers the OpenClaw UI while the
 * gateway connects and auto-pairs the device.  The overlay is styled via
 * styles.css and is automatically faded out once `data-nemoclaw-ready` is set
 * on <body>.  We remove it from the DOM after the CSS transition completes.
 */
function showConnectOverlay(): void {
  if (document.querySelector(".nemoclaw-connect-overlay")) return;
  const overlay = document.createElement("div");
  overlay.className = "nemoclaw-connect-overlay";
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML =
    '<div class="nemoclaw-connect-overlay__spinner"></div>' +
    '<div class="nemoclaw-connect-overlay__text">Auto-approving device pairing. Hang tight...</div>';
  document.body.prepend(overlay);
}

function setConnectOverlayText(text: string): void {
  const textNode = document.querySelector<HTMLElement>(".nemoclaw-connect-overlay__text");
  if (textNode) textNode.textContent = text;
}

function revealApp(): void {
  document.body.setAttribute("data-nemoclaw-ready", "");
  const overlay = document.querySelector(".nemoclaw-connect-overlay");
  if (overlay) {
    overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
    setTimeout(() => overlay.remove(), 600);
  }
}

function shouldForcePairingReload(): boolean {
  try {
    return sessionStorage.getItem(PAIRING_RELOAD_FLAG) !== "1";
  } catch {
    return true;
  }
}

function markPairingReloadComplete(): void {
  try {
    sessionStorage.setItem(PAIRING_RELOAD_FLAG, "1");
  } catch {
    // ignore storage failures
  }
}

function clearPairingReloadFlag(): void {
  try {
    sessionStorage.removeItem(PAIRING_RELOAD_FLAG);
  } catch {
    // ignore storage failures
  }
}

function forcePairingReload(reason: string, overlayText: string): void {
  console.info(`[NeMoClaw] pairing bootstrap: forcing one-time reload (${reason})`);
  markPairingReloadComplete();
  setConnectOverlayText(overlayText);
  window.setTimeout(() => window.location.reload(), FORCED_RELOAD_DELAY_MS);
}

function bootstrap() {
  console.info("[NeMoClaw] pairing bootstrap: start");
  showConnectOverlay();

  const finalizeConnectedState = async () => {
    setConnectOverlayText("Device pairing approved. Finalizing dashboard...");
    console.info("[NeMoClaw] pairing bootstrap: reconnect detected");
    if (shouldForcePairingReload()) {
      forcePairingReload("post-reconnect", "Device pairing approved. Reloading dashboard...");
      return;
    }
    setConnectOverlayText("Device pairing approved. Verifying dashboard health...");
    try {
      console.info("[NeMoClaw] pairing bootstrap: waiting for stable post-reload connection");
      await waitForStableConnection(
        STABLE_CONNECTION_WINDOW_MS,
        STABLE_CONNECTION_TIMEOUT_MS,
      );
    } catch {
      console.warn("[NeMoClaw] pairing bootstrap: stable post-reload connection check timed out; delaying reveal");
      await new Promise((resolve) => setTimeout(resolve, POST_PAIRING_SETTLE_DELAY_MS));
    }
    console.info("[NeMoClaw] pairing bootstrap: reveal app");
    clearPairingReloadFlag();
    revealApp();
  };

  waitForReconnect(INITIAL_CONNECT_TIMEOUT_MS)
    .then(finalizeConnectedState)
    .catch(async () => {
      console.warn("[NeMoClaw] pairing bootstrap: initial reconnect timed out; extending wait");
      if (shouldForcePairingReload()) {
        forcePairingReload("initial-timeout", "Pairing is still settling. Reloading dashboard...");
        return;
      }
      setConnectOverlayText("Still waiting for device pairing approval...");
      try {
        await waitForReconnect(EXTENDED_CONNECT_TIMEOUT_MS);
        await finalizeConnectedState();
      } catch {
        console.warn("[NeMoClaw] pairing bootstrap: extended reconnect timed out; revealing app anyway");
        clearPairingReloadFlag();
        revealApp();
      }
    });

  const keysIngested = ingestKeysFromUrl();

  watchOpenClawNavClicks();
  watchChatCompose();
  watchGotoLinks();

  const defaultKey = resolveApiKey(DEFAULT_MODEL.keyType);
  if (keysIngested || isKeyConfigured(defaultKey)) {
    syncKeysToProviders().catch((e) =>
      console.warn("[NeMoClaw] bootstrap provider key sync failed:", e),
    );
  }

  if (inject()) {
    injectModelSelector();
    return;
  }

  const observer = new MutationObserver(() => {
    if (inject()) {
      injectModelSelector();
      observer.disconnect();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 30_000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
