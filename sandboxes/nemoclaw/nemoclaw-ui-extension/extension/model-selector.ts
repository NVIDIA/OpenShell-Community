/**
 * NeMoClaw DevX — Model Selector
 *
 * Dropdown injected into the chat compose area that lets users pick a
 * model.  For models routed through inference.local (curated + dynamic),
 * switching only updates the NemoClaw cluster-inference route — no
 * OpenClaw config.patch is needed because the NemoClaw proxy rewrites
 * the model field in every request body.  This avoids the gateway
 * disconnect that config.patch causes.
 *
 * Models are fetched dynamically from the NemoClaw runtime (providers
 * and active route configured in the Inference tab).
 */

import { ICON_CHEVRON_DOWN, ICON_LOADER, ICON_CHECK, ICON_CLOSE } from "./icons.ts";
import {
  DEFAULT_MODEL,
  getModelById,
  resolveApiKey,
  isKeyConfigured,
  buildDynamicEntry,
  buildQuickSelectEntry,
  setDynamicModels,
  getDynamicModels,
  CURATED_MODELS,
  curatedToModelEntry,
  getCuratedByModelId,
  type ModelEntry,
} from "./model-registry.ts";
import { patchConfig, waitForReconnect } from "./gateway-bridge.ts";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let selectedModelId = DEFAULT_MODEL.id;
let modelSelectorObserver: MutationObserver | null = null;
let applyInFlight = false;
let currentWrapper: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// Build the config.patch payload for a given model entry
// ---------------------------------------------------------------------------

export function buildModelPatch(entry: ModelEntry): Record<string, unknown> | null {
  let apiKey: string;

  if (entry.isDynamic) {
    apiKey = "proxy-managed";
  } else {
    apiKey = resolveApiKey(entry.keyType);
    if (!isKeyConfigured(apiKey)) {
      return null;
    }
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
        models: {
          [entry.modelRef]: { streaming: true },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Fetch dynamic models from the inference tab's provider API
// ---------------------------------------------------------------------------

interface ProviderInfo {
  name: string;
  type: string;
  credentialKeys: string[];
}

interface ClusterRoute {
  providerName: string | null;
  modelId: string;
  version: number;
}

async function fetchDynamic(): Promise<void> {
  try {
    const [provRes, routeRes] = await Promise.all([
      fetch("/api/providers"),
      fetch("/api/cluster-inference"),
    ]);

    let providers: ProviderInfo[] = [];
    if (provRes.ok) {
      const body = await provRes.json();
      if (body.ok) providers = body.providers || [];
    }

    let route: ClusterRoute | null = null;
    if (routeRes.ok) {
      const body = await routeRes.json();
      if (body.ok && body.providerName != null) {
        route = { providerName: body.providerName, modelId: body.modelId || "", version: body.version || 0 };
      }
    }

    const entries: ModelEntry[] = [];

    if (route && route.providerName && route.modelId) {
      const prov = providers.find((p) => p.name === route!.providerName);
      const provType = prov?.type || "generic";
      entries.push(buildDynamicEntry(route.providerName, route.modelId, provType));
    }

    const curatedIds = new Set(CURATED_MODELS.map((c) => c.modelId));
    const existingModelIds = new Set(entries.map((e) => e.providerConfig.models[0]?.id));
    try {
      const raw = localStorage.getItem("nemoclaw:custom-quick-selects");
      if (raw) {
        const customQS: { modelId: string; name: string; providerName: string }[] = JSON.parse(raw);
        for (const qs of customQS) {
          if (curatedIds.has(qs.modelId) || existingModelIds.has(qs.modelId)) continue;
          entries.push(buildQuickSelectEntry(qs.providerName, qs.modelId, qs.name));
          existingModelIds.add(qs.modelId);
        }
      }
    } catch { /* ignore malformed localStorage data */ }

    setDynamicModels(entries);
  } catch {
    // Non-fatal -- static models still work
  }
}

// ---------------------------------------------------------------------------
// Transition banner lifecycle
// ---------------------------------------------------------------------------

let activeBanner: HTMLElement | null = null;
let propagationTimer: ReturnType<typeof setTimeout> | null = null;

/** Sandbox polls the gateway every 30s for route updates. */
const ROUTE_PROPAGATION_SECS = 30;

function showTransitionBanner(modelName: string): void {
  dismissTransitionBanner();

  document.body.classList.add("nemoclaw-switching");

  const chatCompose = document.querySelector<HTMLElement>(".chat-compose");
  if (!chatCompose) return;

  const banner = document.createElement("div");
  banner.className = "nemoclaw-switching-banner nemoclaw-switching-banner--loading";
  banner.innerHTML = `${ICON_LOADER}<span>Switching to <strong>${escapeHtml(modelName)}</strong>&hellip;</span>`;

  chatCompose.insertBefore(banner, chatCompose.firstChild);
  activeBanner = banner;
}

/** Like showTransitionBanner but without dimming the app (no gateway disconnect). */
function showTransitionBannerLight(modelName: string): void {
  dismissTransitionBanner();

  const chatCompose = document.querySelector<HTMLElement>(".chat-compose");
  if (!chatCompose) return;

  const banner = document.createElement("div");
  banner.className = "nemoclaw-switching-banner nemoclaw-switching-banner--loading";
  banner.innerHTML = `${ICON_LOADER}<span>Switching to <strong>${escapeHtml(modelName)}</strong>&hellip;</span>`;

  chatCompose.insertBefore(banner, chatCompose.firstChild);
  activeBanner = banner;
}

/**
 * Show an honest propagation banner for proxy-managed models.
 * The NemoClaw sandbox polls for route updates every 30 seconds, so the
 * switch isn't truly instant.  This banner shows a progress bar that
 * counts down from ROUTE_PROPAGATION_SECS and transitions to a success
 * state when the propagation window has elapsed.
 */
function showPropagationBanner(modelName: string): void {
  if (!activeBanner) return;

  activeBanner.className = "nemoclaw-switching-banner nemoclaw-switching-banner--propagating";
  activeBanner.innerHTML = [
    `${ICON_LOADER}`,
    `<div class="nemoclaw-switching-banner__content">`,
    `<span>Activating <strong>${escapeHtml(modelName)}</strong> &mdash; route configured, propagating to sandbox&hellip;</span>`,
    `<div class="nemoclaw-propagation-bar"><div class="nemoclaw-propagation-bar__fill"></div></div>`,
    `</div>`,
  ].join("");

  document.body.classList.remove("nemoclaw-switching");

  const fill = activeBanner.querySelector<HTMLElement>(".nemoclaw-propagation-bar__fill");
  if (fill) {
    fill.style.transition = `width ${ROUTE_PROPAGATION_SECS}s linear`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { fill.style.width = "100%"; });
    });
  }

  propagationTimer = setTimeout(() => {
    propagationTimer = null;
    updateTransitionBannerSuccess(modelName);
  }, ROUTE_PROPAGATION_SECS * 1000);
}

function updateTransitionBannerSuccess(modelName: string): void {
  if (!activeBanner) return;

  activeBanner.className = "nemoclaw-switching-banner nemoclaw-switching-banner--success";
  activeBanner.innerHTML = `${ICON_CHECK}<span>Now using <strong>${escapeHtml(modelName)}</strong></span>`;

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
  if (propagationTimer) {
    clearTimeout(propagationTimer);
    propagationTimer = null;
  }
  if (activeBanner) {
    activeBanner.remove();
    activeBanner = null;
  }
  document.body.classList.remove("nemoclaw-switching");
}

// ---------------------------------------------------------------------------
// Apply model selection to backend
// ---------------------------------------------------------------------------

/**
 * Returns true if the model routes through inference.local, meaning the
 * NemoClaw proxy manages credential injection and model rewriting.
 * For these models we only need to update the cluster-inference route —
 * no OpenClaw config.patch (and therefore no gateway disconnect).
 */
function isProxyManaged(entry: ModelEntry): boolean {
  return entry.isDynamic === true ||
    entry.providerConfig.baseUrl === "https://inference.local/v1";
}

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

  try {
    if (isProxyManaged(entry)) {
      // Proxy-managed models route through inference.local.  We update the
      // NemoClaw cluster-inference route (no OpenClaw config.patch, no
      // gateway disconnect).  The sandbox polls every ~30s for route
      // updates, so we show an honest propagation countdown.
      const curated = getCuratedByModelId(entry.providerConfig.models[0]?.id || "");
      const provName = curated?.providerName || entry.providerKey.replace(/^dynamic-/, "");
      const modelId = entry.providerConfig.models[0]?.id || "";

      if (!provName || !modelId) {
        throw new Error("Missing provider or model ID");
      }

      showTransitionBannerLight(entry.name);

      const res = await fetch("/api/cluster-inference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName: provName, modelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      }

      if (valueEl) valueEl.textContent = entry.name;
      showPropagationBanner(entry.name);
    } else {
      // Slow path: non-proxy models (direct API keys, custom baseUrls).
      // Must use config.patch which causes a brief gateway restart.
      showTransitionBanner(entry.name);

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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Populate dropdown with grouped entries
// ---------------------------------------------------------------------------

function populateDropdown(dropdown: HTMLElement): void {
  dropdown.innerHTML = "";

  const curatedModelIds = new Set(CURATED_MODELS.map((c) => c.modelId));

  for (const curated of CURATED_MODELS) {
    const entry = curatedToModelEntry(curated);
    dropdown.appendChild(buildOption(entry));
  }

  const dynamic = getDynamicModels();
  const customDynamic = dynamic.filter((m) => {
    const mid = m.providerConfig.models[0]?.id || "";
    return !curatedModelIds.has(mid);
  });

  if (customDynamic.length > 0) {
    const divider = document.createElement("div");
    divider.className = "nemoclaw-model-dropdown__divider";
    dropdown.appendChild(divider);

    for (const model of customDynamic) {
      dropdown.appendChild(buildOption(model));
    }
  }

  const divider2 = document.createElement("div");
  divider2.className = "nemoclaw-model-dropdown__divider";
  dropdown.appendChild(divider2);

  const routeLink = document.createElement("button");
  routeLink.className = "nemoclaw-model-dropdown__route-link";
  routeLink.type = "button";
  routeLink.textContent = "Configure inference \u2192";
  routeLink.dataset.nemoclawGoto = "nemoclaw-inference-routes";
  dropdown.appendChild(routeLink);
}

function buildOption(model: ModelEntry): HTMLElement {
  const option = document.createElement("button");
  option.className = `nemoclaw-model-option${model.id === selectedModelId ? " nemoclaw-model-option--selected" : ""}`;
  option.type = "button";
  option.setAttribute("role", "option");
  option.setAttribute("aria-selected", String(model.id === selectedModelId));
  option.dataset.modelId = model.id;
  option.textContent = model.name;
  return option;
}

// ---------------------------------------------------------------------------
// Build selector DOM
// ---------------------------------------------------------------------------

function buildModelSelector(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "nemoclaw-model-selector";
  wrapper.dataset.nemoclawModelSelector = "true";

  const trigger = document.createElement("button");
  trigger.className = "nemoclaw-model-trigger";
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = `<span class="nemoclaw-model-trigger__label">Model</span><span class="nemoclaw-model-trigger__value">Loading\u2026</span><span class="nemoclaw-model-trigger__chevron">${ICON_CHEVRON_DOWN}</span>`;

  const dropdown = document.createElement("div");
  dropdown.className = "nemoclaw-model-dropdown";
  dropdown.setAttribute("role", "listbox");
  dropdown.style.display = "none";

  populateDropdown(dropdown);

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

  currentWrapper = wrapper;

  // Fetch dynamic models, sync selection, and refresh dropdown
  fetchDynamic().then(() => {
    populateDropdown(dropdown);
    syncSelectionToActiveRoute();
    const current = getModelById(selectedModelId);
    const valueEl = trigger.querySelector<HTMLElement>(".nemoclaw-model-trigger__value");
    if (valueEl) {
      valueEl.textContent = current ? current.name : "No model";
    }
  });

  return wrapper;
}

// ---------------------------------------------------------------------------
// Selection sync helpers
// ---------------------------------------------------------------------------

function syncSelectionToActiveRoute(): void {
  const dynamic = getDynamicModels();
  if (dynamic.length > 0) {
    const activeModelId = dynamic[0]?.providerConfig.models[0]?.id || "";
    const curated = getCuratedByModelId(activeModelId);
    if (curated) {
      selectedModelId = curated.id;
    } else if (!dynamic.find((m) => m.id === selectedModelId)) {
      selectedModelId = dynamic[0].id;
    }
  }
}

// ---------------------------------------------------------------------------
// Public: set active model from inference tab or external callers
// ---------------------------------------------------------------------------

export function setActiveModelFromExternal(modelId: string): void {
  const curated = getCuratedByModelId(modelId);
  if (curated) {
    selectedModelId = curated.id;
  } else {
    const dynamic = getDynamicModels();
    const match = dynamic.find((m) => m.providerConfig.models[0]?.id === modelId);
    if (match) selectedModelId = match.id;
  }
  if (!currentWrapper) return;
  const dropdown = currentWrapper.querySelector<HTMLElement>(".nemoclaw-model-dropdown");
  if (dropdown) populateDropdown(dropdown);
  const current = getModelById(selectedModelId);
  const valueEl = currentWrapper.querySelector<HTMLElement>(".nemoclaw-model-trigger__value");
  if (valueEl) {
    valueEl.textContent = current ? current.name : "No model";
  }
  updateDropdownSelection(currentWrapper, selectedModelId);
}

// ---------------------------------------------------------------------------
// Public refresh — called by inference-page after save
// ---------------------------------------------------------------------------

export async function refreshModelSelector(): Promise<void> {
  await fetchDynamic();
  if (!currentWrapper) return;
  const dropdown = currentWrapper.querySelector<HTMLElement>(".nemoclaw-model-dropdown");
  if (dropdown) populateDropdown(dropdown);

  syncSelectionToActiveRoute();
  const current = getModelById(selectedModelId);
  const valueEl = currentWrapper.querySelector<HTMLElement>(".nemoclaw-model-trigger__value");
  if (valueEl) {
    valueEl.textContent = current ? current.name : "No model";
  }
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
