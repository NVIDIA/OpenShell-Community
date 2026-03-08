/**
 * NeMoClaw DevX Extension
 *
 * Injects into the OpenClaw UI:
 *   1. A green "Deploy DGX Spark/Station" CTA button in the topbar
 *   2. A "NeMoClaw" collapsible nav group with Policy, Inference Routes,
 *      and API Keys pages
 *   3. A model selector wired to NVIDIA endpoints via config.patch
 *
 * Operates purely as an overlay — no original OpenClaw source files are modified.
 */

import "./styles.css";
import { injectButton } from "./deploy-modal.ts";
import { injectNavGroup, activateNemoPage, watchOpenClawNavClicks } from "./nav-group.ts";
import { injectModelSelector, watchChatCompose } from "./model-selector.ts";
import { ingestKeysFromUrl, DEFAULT_MODEL, resolveApiKey } from "./model-registry.ts";
import { waitForClient, patchConfig, waitForReconnect } from "./gateway-bridge.ts";

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
 * When API keys arrive via URL parameters (from the welcome UI), apply
 * the default model's provider config so the gateway has a valid key
 * immediately rather than the placeholder set during onboarding.
 */
function applyIngestedKeys(): void {
  waitForClient().then(async () => {
    const apiKey = resolveApiKey(DEFAULT_MODEL.keyType);
    await patchConfig({
      models: {
        providers: {
          [DEFAULT_MODEL.providerKey]: {
            baseUrl: DEFAULT_MODEL.providerConfig.baseUrl,
            api: DEFAULT_MODEL.providerConfig.api,
            models: DEFAULT_MODEL.providerConfig.models,
            apiKey,
          },
        },
      },
      agents: {
        defaults: { model: { primary: DEFAULT_MODEL.modelRef } },
      },
    });
  }).catch((err) => {
    console.error("[NeMoClaw] Failed to apply ingested API key:", err);
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

  waitForReconnect(30_000).then(revealApp).catch(revealApp);

  const keysIngested = ingestKeysFromUrl();

  watchOpenClawNavClicks();
  watchChatCompose();
  watchGotoLinks();

  if (keysIngested) {
    applyIngestedKeys();
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
