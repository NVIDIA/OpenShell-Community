/**
 * NeMoClaw DevX — Model Selector
 *
 * Dropdown injected into the chat compose area that lets users pick an
 * NVIDIA model. On selection, sends a config.patch RPC through the
 * gateway bridge to register the provider and switch the primary model.
 */

import { ICON_CHEVRON_DOWN, ICON_LOADER, ICON_CHECK, ICON_CLOSE } from "./icons.ts";
import {
  MODEL_REGISTRY,
  DEFAULT_MODEL,
  getModelById,
  resolveApiKey,
  isKeyConfigured,
  type ModelEntry,
} from "./model-registry.ts";
import { patchConfig, waitForReconnect } from "./gateway-bridge.ts";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let selectedModelId = DEFAULT_MODEL.id;
let modelSelectorObserver: MutationObserver | null = null;
let applyInFlight = false;

// ---------------------------------------------------------------------------
// Build the config.patch payload for a given model entry
// ---------------------------------------------------------------------------

export function buildModelPatch(entry: ModelEntry): Record<string, unknown> | null {
  const apiKey = resolveApiKey(entry.keyType);

  if (!isKeyConfigured(apiKey)) {
    return null;
  }

  const providerDef: Record<string, unknown> = {
    baseUrl: entry.providerConfig.baseUrl,
    api: entry.providerConfig.api,
    models: entry.providerConfig.models,
    apiKey,
  };

  return {
    models: {
      providers: {
        [entry.providerKey]: providerDef,
      },
    },
    agents: {
      defaults: {
        model: { primary: entry.modelRef },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Transition banner lifecycle
// ---------------------------------------------------------------------------

let activeBanner: HTMLElement | null = null;

function showTransitionBanner(modelName: string): void {
  dismissTransitionBanner();

  document.body.classList.add("nemoclaw-switching");

  const chatCompose = document.querySelector<HTMLElement>(".chat-compose");
  if (!chatCompose) return;

  const banner = document.createElement("div");
  banner.className = "nemoclaw-switching-banner nemoclaw-switching-banner--loading";
  banner.innerHTML = `${ICON_LOADER}<span>Switching to <strong>${modelName}</strong>&hellip;</span>`;

  chatCompose.insertBefore(banner, chatCompose.firstChild);
  activeBanner = banner;
}

function updateTransitionBannerSuccess(modelName: string): void {
  if (!activeBanner) return;

  activeBanner.className = "nemoclaw-switching-banner nemoclaw-switching-banner--success";
  activeBanner.innerHTML = `${ICON_CHECK}<span>Now using <strong>${modelName}</strong></span>`;

  document.body.classList.remove("nemoclaw-switching");

  setTimeout(() => {
    if (!activeBanner) return;
    activeBanner.classList.add("nemoclaw-switching-banner--dismiss");
    activeBanner.addEventListener("animationend", () => {
      dismissTransitionBanner();
    }, { once: true });
  }, 2000);
}

function updateTransitionBannerError(message: string): void {
  if (!activeBanner) return;

  activeBanner.className = "nemoclaw-switching-banner nemoclaw-switching-banner--error";
  activeBanner.innerHTML = `${ICON_CLOSE}<span>${message}</span>`;

  document.body.classList.remove("nemoclaw-switching");

  setTimeout(() => dismissTransitionBanner(), 6000);
}

function dismissTransitionBanner(): void {
  if (activeBanner) {
    activeBanner.remove();
    activeBanner = null;
  }
  document.body.classList.remove("nemoclaw-switching");
}

// ---------------------------------------------------------------------------
// Apply model selection to backend
// ---------------------------------------------------------------------------

async function applyModelSelection(
  entry: ModelEntry,
  wrapper: HTMLElement,
  trigger: HTMLElement,
  previousModelId: string,
) {
  if (applyInFlight) return;
  applyInFlight = true;

  const valueEl = trigger.querySelector<HTMLElement>(".nemoclaw-model-trigger__value");
  const chevronEl = trigger.querySelector<HTMLElement>(".nemoclaw-model-trigger__chevron");
  const originalChevron = chevronEl?.innerHTML ?? "";

  if (chevronEl) {
    chevronEl.innerHTML = ICON_LOADER;
    chevronEl.classList.add("nemoclaw-model-trigger__chevron--loading");
  }
  trigger.style.pointerEvents = "none";

  showTransitionBanner(entry.name);

  try {
    const patch = buildModelPatch(entry);
    if (!patch) {
      selectedModelId = previousModelId;
      const prev = getModelById(previousModelId) ?? DEFAULT_MODEL;
      if (valueEl) valueEl.textContent = prev.name;
      updateDropdownSelection(wrapper, previousModelId);
      updateTransitionBannerError(
        `API key not configured. <a href="#" data-nemoclaw-goto="nemoclaw-api-keys">Add your keys</a> to switch models.`,
      );
      return;
    }
    await patchConfig(patch);

    if (valueEl) valueEl.textContent = entry.name;

    try {
      await waitForReconnect(15_000);
      updateTransitionBannerSuccess(entry.name);
    } catch {
      updateTransitionBannerError("Model applied but gateway reconnection timed out");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[NeMoClaw] Failed to apply model:", msg);

    selectedModelId = previousModelId;
    const prev = getModelById(previousModelId) ?? DEFAULT_MODEL;
    if (valueEl) valueEl.textContent = prev.name;

    updateDropdownSelection(wrapper, previousModelId);
    updateTransitionBannerError(`Failed to switch model: ${msg}`);
  } finally {
    if (chevronEl) {
      chevronEl.innerHTML = originalChevron;
      chevronEl.classList.remove("nemoclaw-model-trigger__chevron--loading");
    }
    trigger.style.pointerEvents = "";
    applyInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Dropdown selection helpers
// ---------------------------------------------------------------------------

function updateDropdownSelection(wrapper: HTMLElement, modelId: string) {
  wrapper.querySelectorAll<HTMLElement>(".nemoclaw-model-option").forEach((el) => {
    const isSelected = el.dataset.modelId === modelId;
    el.classList.toggle("nemoclaw-model-option--selected", isSelected);
    el.setAttribute("aria-selected", String(isSelected));
  });
}

// ---------------------------------------------------------------------------
// Build selector DOM
// ---------------------------------------------------------------------------

function buildModelSelector(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "nemoclaw-model-selector";
  wrapper.dataset.nemoclawModelSelector = "true";

  const current = getModelById(selectedModelId) ?? DEFAULT_MODEL;

  const trigger = document.createElement("button");
  trigger.className = "nemoclaw-model-trigger";
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = `<span class="nemoclaw-model-trigger__label">Model</span><span class="nemoclaw-model-trigger__value">${current.name}</span><span class="nemoclaw-model-trigger__chevron">${ICON_CHEVRON_DOWN}</span>`;

  const dropdown = document.createElement("div");
  dropdown.className = "nemoclaw-model-dropdown";
  dropdown.setAttribute("role", "listbox");
  dropdown.style.display = "none";

  for (const model of MODEL_REGISTRY) {
    const option = document.createElement("button");
    option.className = `nemoclaw-model-option${model.id === selectedModelId ? " nemoclaw-model-option--selected" : ""}`;
    option.type = "button";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(model.id === selectedModelId));
    option.dataset.modelId = model.id;
    option.textContent = model.name;
    dropdown.appendChild(option);
  }

  const poweredBy = document.createElement("a");
  poweredBy.className = "nemoclaw-model-powered";
  poweredBy.href = "https://build.nvidia.com/models";
  poweredBy.target = "_blank";
  poweredBy.rel = "noopener noreferrer";
  poweredBy.textContent = "Powered by NVIDIA endpoints from build.nvidia.com";

  wrapper.appendChild(poweredBy);
  wrapper.appendChild(trigger);
  wrapper.appendChild(dropdown);

  // Toggle dropdown
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (applyInFlight) return;
    const open = dropdown.style.display !== "none";
    dropdown.style.display = open ? "none" : "";
    trigger.setAttribute("aria-expanded", String(!open));
    wrapper.classList.toggle("nemoclaw-model-selector--open", !open);
  });

  // Handle model selection
  dropdown.addEventListener("click", (e) => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>("[data-model-id]");
    if (!opt) return;
    e.stopPropagation();

    const newModelId = opt.dataset.modelId!;
    if (newModelId === selectedModelId) {
      dropdown.style.display = "none";
      trigger.setAttribute("aria-expanded", "false");
      wrapper.classList.remove("nemoclaw-model-selector--open");
      return;
    }

    const entry = getModelById(newModelId);
    if (!entry) return;

    const previousModelId = selectedModelId;
    selectedModelId = newModelId;

    updateDropdownSelection(wrapper, newModelId);
    const valueEl = trigger.querySelector(".nemoclaw-model-trigger__value");
    if (valueEl) valueEl.textContent = entry.name;

    dropdown.style.display = "none";
    trigger.setAttribute("aria-expanded", "false");
    wrapper.classList.remove("nemoclaw-model-selector--open");

    applyModelSelection(entry, wrapper, trigger, previousModelId);
  });

  // Close on outside click
  const closeOnOutsideClick = (e: MouseEvent) => {
    if (!wrapper.contains(e.target as Node)) {
      dropdown.style.display = "none";
      trigger.setAttribute("aria-expanded", "false");
      wrapper.classList.remove("nemoclaw-model-selector--open");
    }
  };
  document.addEventListener("click", closeOnOutsideClick, true);

  return wrapper;
}

// ---------------------------------------------------------------------------
// Injection into .chat-compose__actions
// ---------------------------------------------------------------------------

export function injectModelSelector() {
  const actionsEl = document.querySelector<HTMLElement>(".chat-compose__actions");
  if (!actionsEl) return;

  if (actionsEl.parentElement?.classList.contains("nemoclaw-actions-column")) return;

  const row = actionsEl.parentElement;
  if (!row) return;

  const column = document.createElement("div");
  column.className = "nemoclaw-actions-column";

  const selector = buildModelSelector();
  row.insertBefore(column, actionsEl);
  column.appendChild(selector);
  column.appendChild(actionsEl);
}

export function watchChatCompose() {
  if (modelSelectorObserver) return;

  modelSelectorObserver = new MutationObserver(() => {
    const actionsEl = document.querySelector<HTMLElement>(".chat-compose__actions");
    if (actionsEl && !actionsEl.parentElement?.classList.contains("nemoclaw-actions-column")) {
      injectModelSelector();
    }
  });

  modelSelectorObserver.observe(document.body, { childList: true, subtree: true });
}
