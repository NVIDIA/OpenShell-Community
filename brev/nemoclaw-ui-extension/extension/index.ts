/**
 * NeMoClaw DevX Extension
 *
 * Injects into the OpenClaw UI:
 *   1. A green "Deploy DGX Spark/Station" CTA button in the topbar
 *   2. A "NeMoClaw" collapsible nav group with Policy and Inference Routes pages
 *   3. A model selector wired to NVIDIA endpoints via config.patch
 *
 * Operates purely as an overlay — no original OpenClaw source files are modified.
 */

import "./styles.css";
import { injectButton } from "./deploy-modal.ts";
import { injectNavGroup, watchOpenClawNavClicks } from "./nav-group.ts";
import { injectModelSelector, watchChatCompose } from "./model-selector.ts";

function inject(): boolean {
  const hasButton = injectButton();
  const hasNav = injectNavGroup();
  return hasButton && hasNav;
}

function bootstrap() {
  watchOpenClawNavClicks();
  watchChatCompose();

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
