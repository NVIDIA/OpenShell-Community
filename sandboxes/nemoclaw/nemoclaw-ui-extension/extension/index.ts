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
import { waitForClient, patchConfig } from "./gateway-bridge.ts";

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

function bootstrap() {
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
