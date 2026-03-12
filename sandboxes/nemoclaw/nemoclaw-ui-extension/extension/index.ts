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
import { waitForReconnect } from "./gateway-bridge.ts";
import { syncKeysToProviders } from "./api-keys-page.ts";

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

function revealApp(): void {
  document.body.setAttribute("data-nemoclaw-ready", "");
  const overlay = document.querySelector(".nemoclaw-connect-overlay");
  if (overlay) {
    overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
    setTimeout(() => overlay.remove(), 600);
  }
}

function bootstrap() {
  showConnectOverlay();

  waitForReconnect(30_000)
    .then(revealApp)
    .catch(revealApp);

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
