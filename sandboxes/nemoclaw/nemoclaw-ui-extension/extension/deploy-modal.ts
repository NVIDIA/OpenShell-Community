/**
 * NeMoClaw DevX — Deploy DGX Modal
 *
 * Topbar button + modal dialog for deploying to NVIDIA DGX Spark/Station.
 */

import {
  ICON_ROCKET,
  ICON_CLOSE,
  ICON_ARROW_RIGHT,
  ICON_LOADER,
  ICON_CHECK,
  ICON_CHIP,
  TARGET_ICONS,
} from "./icons.ts";
import { DEPLOY_TARGETS, getApiKey, isKeyConfigured, type DeployTarget } from "./model-registry.ts";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let modalRoot: HTMLElement | null = null;
let buttonEl: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// Button injection (topbar)
// ---------------------------------------------------------------------------

function createButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "nemoclaw-deploy-btn";
  btn.setAttribute("aria-label", "Deploy DGX Spark/Station");
  btn.setAttribute("title", "Deploy DGX Spark/Station");
  btn.innerHTML = `<span class="nemoclaw-deploy-btn__icon">${ICON_ROCKET}</span><span>Deploy DGX Spark/Station</span>`;
  btn.addEventListener("click", openModal);
  return btn;
}

export function injectButton(): boolean {
  if (buttonEl && document.contains(buttonEl)) return true;

  const topbarStatus = document.querySelector(".topbar-status");
  if (!topbarStatus) return false;

  const btn = createButton();
  topbarStatus.appendChild(btn);
  buttonEl = btn;
  return true;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function buildModal(): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "nemoclaw-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Deploy to DGX");

  const targetsHtml = DEPLOY_TARGETS.map(
    (t) => `
    <button class="nemoclaw-target" data-target-id="${t.id}">
      <span class="nemoclaw-target__icon">${TARGET_ICONS[t.id] ?? ICON_CHIP}</span>
      <span class="nemoclaw-target__info">
        <span class="nemoclaw-target__name">${t.name}</span>
        <span class="nemoclaw-target__desc">${t.description}</span>
      </span>
      <span class="nemoclaw-target__arrow">${ICON_ARROW_RIGHT}</span>
    </button>`,
  ).join("");

  overlay.innerHTML = `
    <div class="nemoclaw-modal">
      <div class="nemoclaw-modal__header">
        <span class="nemoclaw-modal__title">Deploy to NVIDIA DGX</span>
        <button class="nemoclaw-modal__close" aria-label="Close" data-action="close">${ICON_CLOSE}</button>
      </div>
      <div class="nemoclaw-modal__body">
        <p class="nemoclaw-modal__desc">
          Choose a deployment target to provision your OpenClaw agent on NVIDIA DGX hardware.
        </p>
        <div class="nemoclaw-target-list">${targetsHtml}</div>
        <div class="nemoclaw-modal__status" style="display:none"></div>
      </div>
    </div>`;

  overlay.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target === overlay) {
      closeModal();
      return;
    }
    const closeBtn = target.closest("[data-action='close']");
    if (closeBtn) {
      closeModal();
      return;
    }
    const targetBtn = target.closest<HTMLElement>("[data-target-id]");
    if (targetBtn) {
      const id = targetBtn.dataset.targetId!;
      const dt = DEPLOY_TARGETS.find((t) => t.id === id);
      if (dt) handleDeploy(dt, overlay);
    }
  });

  overlay.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") closeModal();
  });

  return overlay;
}

function openModal() {
  if (modalRoot && document.contains(modalRoot)) return;
  modalRoot = buildModal();
  document.body.appendChild(modalRoot);
  const closeBtn = modalRoot.querySelector<HTMLElement>("[data-action='close']");
  closeBtn?.focus();
}

function closeModal() {
  if (!modalRoot) return;
  modalRoot.remove();
  modalRoot = null;
  buttonEl?.focus();
}

// ---------------------------------------------------------------------------
// Deploy action
// ---------------------------------------------------------------------------

function setStatus(overlay: HTMLElement, type: string, message: string) {
  const el = overlay.querySelector<HTMLElement>(".nemoclaw-modal__status");
  if (!el) return;
  el.style.display = "";
  const iconMap: Record<string, string> = {
    loading: ICON_LOADER,
    success: ICON_CHECK,
    error: ICON_CLOSE,
  };
  el.className = `nemoclaw-modal__status nemoclaw-status nemoclaw-status--${type}`;
  el.innerHTML = `${iconMap[type] ?? ""}<span>${message}</span>`;
}

function disableTargets(overlay: HTMLElement, disabled: boolean) {
  overlay.querySelectorAll<HTMLButtonElement>(".nemoclaw-target").forEach((btn) => {
    btn.style.pointerEvents = disabled ? "none" : "";
    btn.style.opacity = disabled ? "0.5" : "";
  });
}

async function handleDeploy(target: DeployTarget, overlay: HTMLElement) {
  const apiKey = getApiKey(target);
  if (!isKeyConfigured(apiKey)) {
    setStatus(overlay, "error", `API key not configured. <a href="#" data-nemoclaw-goto="nemoclaw-api-keys">Add your keys</a> to get started.`);
    return;
  }

  disableTargets(overlay, true);
  setStatus(overlay, "loading", `Initiating deployment to ${target.name}…`);

  try {
    const res = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [target.apiKeyHeader]: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        action: "deploy",
        target: target.id,
        timestamp: new Date().toISOString(),
      }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => null);
      const id = data?.deploymentId ?? data?.id ?? "—";
      setStatus(overlay, "success", `Deployment queued on ${target.name} (ID: ${id})`);
    } else {
      const text = await res.text().catch(() => "");
      setStatus(overlay, "error", `${target.name} returned ${res.status}: ${text || "unknown error"}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(overlay, "error", `Network error: ${msg}`);
  } finally {
    disableTargets(overlay, false);
  }
}
