/**
 * NeMoClaw DevX — Inference Page
 *
 * Model-first design with four sections:
 *   [1] Gateway Status Strip — immutable info about inference.local
 *   [2] Quick Model Picker — 3 curated presets for one-click switching
 *   [3] Active Configuration — current provider + model + endpoint
 *   [4] Providers (Advanced) — collapsible CRUD for power users
 *   Save Bar — persists changes, then refreshes model selector
 */

import {
  ICON_LOCK,
  ICON_INFO,
  ICON_PLUS,
  ICON_TRASH,
  ICON_CHECK,
  ICON_CHEVRON_RIGHT,
  ICON_LOADER,
  ICON_CLOSE,
  ICON_CHEVRON_DOWN,
  ICON_EYE,
  ICON_EYE_OFF,
} from "./icons.ts";
import { refreshModelSelector, setActiveModelFromExternal } from "./model-selector.ts";
import {
  CURATED_MODELS,
  getCuratedByModelId,
} from "./model-registry.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InferenceProvider {
  id: string;
  name: string;
  type: string;
  credentialKeys: string[];
  configKeys: string[];
  configValues?: Record<string, string>;
  _draft?: ProviderDraft;
  _isNew?: boolean;
  _modelId?: string;
}

interface ClusterInferenceRoute {
  providerName: string | null;
  modelId: string;
  version: number;
}

interface ProviderDraft {
  type: string;
  credentials: Record<string, string>;
  config: Record<string, string>;
}

interface ProviderProfile {
  defaultUrl: string;
  credentialKey: string;
  configUrlKey: string;
  authStyle: string;
}

// ---------------------------------------------------------------------------
// Provider profiles — mirrors InferenceProviderProfile from navigator-core
// ---------------------------------------------------------------------------

const PROVIDER_PROFILES: Record<string, ProviderProfile> = {
  openai: {
    defaultUrl: "https://api.openai.com/v1",
    credentialKey: "OPENAI_API_KEY",
    configUrlKey: "OPENAI_BASE_URL",
    authStyle: "Bearer",
  },
  anthropic: {
    defaultUrl: "https://api.anthropic.com/v1",
    credentialKey: "ANTHROPIC_API_KEY",
    configUrlKey: "ANTHROPIC_BASE_URL",
    authStyle: "x-api-key",
  },
  nvidia: {
    defaultUrl: "https://integrate.api.nvidia.com/v1",
    credentialKey: "NVIDIA_API_KEY",
    configUrlKey: "NVIDIA_BASE_URL",
    authStyle: "Bearer",
  },
  generic: {
    defaultUrl: "",
    credentialKey: "API_KEY",
    configUrlKey: "BASE_URL",
    authStyle: "Bearer",
  },
};

const PROVIDER_TEMPLATES: { label: string; name: string; type: string; config: Record<string, string> }[] = [
  { label: "NVIDIA NIM", name: "nvidia_nim", type: "nvidia", config: { NVIDIA_BASE_URL: "https://integrate.api.nvidia.com/v1" } },
  { label: "OpenAI", name: "openai", type: "openai", config: { OPENAI_BASE_URL: "https://api.openai.com/v1" } },
  { label: "Anthropic", name: "anthropic", type: "anthropic", config: { ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1" } },
  { label: "Local (LM Studio)", name: "local_lmstudio", type: "openai", config: { OPENAI_BASE_URL: "http://localhost:1234/v1" } },
];

const PROVIDER_TYPE_OPTIONS = ["openai", "anthropic", "nvidia"];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let providers: InferenceProvider[] = [];
let activeRoute: ClusterInferenceRoute | null = null;
let pendingActivation: { providerName: string; modelId: string } | null = null;
const changeTracker = {
  modified: new Set<string>(),
  added: new Set<string>(),
  deleted: new Set<string>(),
};
let deletedProviders: string[] = [];
let pageContainer: HTMLElement | null = null;
let saveBarEl: HTMLElement | null = null;
let providersExpanded = true;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchProviders(): Promise<InferenceProvider[]> {
  const res = await fetch("/api/providers");
  if (!res.ok) throw new Error(`Failed to load providers: ${res.status}`);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || "Failed to load providers");
  return body.providers || [];
}

async function apiCreateProvider(draft: { name: string; type: string; credentials: Record<string, string>; config: Record<string, string> }): Promise<void> {
  const res = await fetch("/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || "Create failed");
}

async function apiUpdateProvider(name: string, draft: { type: string; credentials: Record<string, string>; config: Record<string, string> }): Promise<void> {
  const res = await fetch(`/api/providers/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || "Update failed");
}

async function apiDeleteProvider(name: string): Promise<void> {
  const res = await fetch(`/api/providers/${encodeURIComponent(name)}`, { method: "DELETE" });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || "Delete failed");
}

async function fetchClusterInference(): Promise<ClusterInferenceRoute | null> {
  const res = await fetch("/api/cluster-inference");
  if (!res.ok) return null;
  const body = await res.json();
  if (!body.ok || body.providerName == null) return null;
  return { providerName: body.providerName, modelId: body.modelId || "", version: body.version || 0 };
}

async function apiSetClusterInference(providerName: string, modelId: string): Promise<void> {
  const res = await fetch("/api/cluster-inference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerName, modelId }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || "Activation failed");
}

// ---------------------------------------------------------------------------
// Render entry point
// ---------------------------------------------------------------------------

export function renderInferencePage(container: HTMLElement): void {
  container.innerHTML = `
    <section class="content-header">
      <div>
        <div class="page-title">Inference</div>
        <div class="page-sub">Configure which model handles AI requests</div>
      </div>
    </section>
    <div class="nemoclaw-inference-page">
      <div class="nemoclaw-policy-loading">
        <span class="nemoclaw-policy-loading__spinner">${ICON_LOADER}</span>
        <span>Loading&hellip;</span>
      </div>
    </div>`;

  pageContainer = container;
  loadAndRender(container);
}

async function loadAndRender(container: HTMLElement): Promise<void> {
  const page = container.querySelector<HTMLElement>(".nemoclaw-inference-page")!;
  try {
    const [providerList, route] = await Promise.all([fetchProviders(), fetchClusterInference()]);
    providers = providerList;
    activeRoute = route;
    pendingActivation = null;
    providers.forEach((p) => {
      p._draft = undefined;
      p._isNew = false;
      if (activeRoute && p.name === activeRoute.providerName) {
        p._modelId = activeRoute.modelId;
      }
    });
    changeTracker.modified.clear();
    changeTracker.added.clear();
    changeTracker.deleted.clear();
    deletedProviders = [];
    renderPageContent(page);
  } catch (err) {
    page.innerHTML = `
      <div class="nemoclaw-policy-error">
        <p>Could not load inference configuration.</p>
        <p class="nemoclaw-policy-error__detail">${escapeHtml(String(err))}</p>
        <button class="nemoclaw-policy-retry-btn" type="button">Retry</button>
      </div>`;
    page.querySelector(".nemoclaw-policy-retry-btn")?.addEventListener("click", () => {
      page.innerHTML = `
        <div class="nemoclaw-policy-loading">
          <span class="nemoclaw-policy-loading__spinner">${ICON_LOADER}</span>
          <span>Loading&hellip;</span>
        </div>`;
      loadAndRender(container);
    });
  }
}

// ---------------------------------------------------------------------------
// Main page layout
// ---------------------------------------------------------------------------

function renderPageContent(page: HTMLElement): void {
  page.innerHTML = "";
  page.appendChild(buildGatewayStrip());
  page.appendChild(buildQuickPicker());
  page.appendChild(buildActiveConfig());
  page.appendChild(buildProviderSection());
  saveBarEl = buildSaveBar();
  page.appendChild(saveBarEl);
}

// ---------------------------------------------------------------------------
// Section 1 — Gateway Status Strip
// ---------------------------------------------------------------------------

function buildGatewayStrip(): HTMLElement {
  const strip = document.createElement("div");
  strip.className = "nc-gateway-strip";

  const left = document.createElement("div");
  left.className = "nc-gateway-strip__left";
  left.innerHTML = `<code class="nc-gateway-strip__endpoint">${ICON_LOCK} inference.local</code>`;

  const center = document.createElement("span");
  center.className = "nc-gateway-strip__desc";
  center.textContent = "All AI requests from this sandbox route here";

  const helpBtn = document.createElement("button");
  helpBtn.type = "button";
  helpBtn.className = "nc-gateway-strip__help";
  helpBtn.innerHTML = ICON_INFO;
  helpBtn.title = "How inference routing works";

  const tooltip = document.createElement("div");
  tooltip.className = "nc-gateway-strip__tooltip";
  tooltip.innerHTML = `
    <div class="nc-gateway-tooltip__row"><strong>Your Code</strong> sends requests to <code>inference.local</code></div>
    <div class="nc-gateway-tooltip__arrow">&darr;</div>
    <div class="nc-gateway-tooltip__row"><strong>NemoClaw Proxy</strong> intercepts, injects credentials</div>
    <div class="nc-gateway-tooltip__arrow">&darr;</div>
    <div class="nc-gateway-tooltip__row"><strong>Provider API</strong> receives authenticated request</div>
    <div class="nc-gateway-tooltip__footer">${ICON_LOCK} Enforced by the NemoClaw runtime. Cannot be changed from within the sandbox.</div>`;
  tooltip.style.display = "none";

  let tooltipOpen = false;
  helpBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    tooltipOpen = !tooltipOpen;
    tooltip.style.display = tooltipOpen ? "" : "none";
    helpBtn.classList.toggle("nc-gateway-strip__help--active", tooltipOpen);
  });
  document.addEventListener("click", () => {
    if (tooltipOpen) {
      tooltipOpen = false;
      tooltip.style.display = "none";
      helpBtn.classList.remove("nc-gateway-strip__help--active");
    }
  });

  strip.appendChild(left);
  strip.appendChild(center);
  strip.appendChild(helpBtn);
  strip.appendChild(tooltip);
  return strip;
}

// ---------------------------------------------------------------------------
// Section 2 — Quick Model Picker
// ---------------------------------------------------------------------------

function getCustomQuickSelects(): { modelId: string; name: string; providerName: string }[] {
  try {
    const raw = localStorage.getItem("nemoclaw:custom-quick-selects");
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveCustomQuickSelects(items: { modelId: string; name: string; providerName: string }[]): void {
  localStorage.setItem("nemoclaw:custom-quick-selects", JSON.stringify(items));
}

function buildQuickPicker(): HTMLElement {
  const section = document.createElement("div");
  section.className = "nc-quick-picker";

  const label = document.createElement("div");
  label.className = "nc-quick-picker__label";
  label.textContent = "Quick Select";
  section.appendChild(label);

  const strip = document.createElement("div");
  strip.className = "nc-quick-picker__strip";

  const currentModelId = pendingActivation?.modelId ?? activeRoute?.modelId ?? "";

  for (const curated of CURATED_MODELS) {
    strip.appendChild(buildQuickChip(curated.modelId, curated.name, curated.providerName, currentModelId, section, false));
  }

  const custom = getCustomQuickSelects();
  const curatedIds = new Set(CURATED_MODELS.map((c) => c.modelId));
  for (const item of custom) {
    if (curatedIds.has(item.modelId)) continue;
    strip.appendChild(buildQuickChip(item.modelId, item.name, item.providerName, currentModelId, section, true));
  }

  section.appendChild(strip);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "nc-quick-picker__add-btn";
  addBtn.innerHTML = `${ICON_PLUS} Add`;
  addBtn.addEventListener("click", () => showAddQuickSelectForm(section));
  section.appendChild(addBtn);

  return section;
}

function buildQuickChip(modelId: string, name: string, providerName: string, currentModelId: string, section: HTMLElement, removable: boolean): HTMLElement {
  const chip = document.createElement("button");
  chip.type = "button";
  const isActive = modelId === currentModelId;
  chip.className = "nc-quick-chip" + (isActive ? " nc-quick-chip--active" : "");
  chip.dataset.modelId = modelId;

  const nameSpan = document.createElement("span");
  nameSpan.className = "nc-quick-chip__name";
  nameSpan.textContent = name;
  chip.appendChild(nameSpan);

  if (removable) {
    const removeBtn = document.createElement("span");
    removeBtn.className = "nc-quick-chip__remove";
    removeBtn.innerHTML = ICON_CLOSE;
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const items = getCustomQuickSelects().filter((i) => i.modelId !== modelId);
      saveCustomQuickSelects(items);
      chip.remove();
      refreshModelSelector().catch(() => {});
    });
    chip.appendChild(removeBtn);
  }

  chip.addEventListener("click", () => {
    pendingActivation = { providerName, modelId };
    markDirty();
    rerenderQuickPicker(section);
    rerenderActiveConfig();
  });

  return chip;
}

function showAddQuickSelectForm(section: HTMLElement): void {
  const existing = section.querySelector(".nc-quick-picker__add-form");
  if (existing) { existing.remove(); return; }

  const form = document.createElement("div");
  form.className = "nc-quick-picker__add-form";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "nemoclaw-policy-input nc-quick-picker__add-input";
  nameInput.placeholder = "Display name";

  const modelInput = document.createElement("input");
  modelInput.type = "text";
  modelInput.className = "nemoclaw-policy-input nc-quick-picker__add-input";
  modelInput.placeholder = "Model ID (e.g. nvidia/meta/llama-3.3-70b-instruct)";

  const provInput = document.createElement("input");
  provInput.type = "text";
  provInput.className = "nemoclaw-policy-input nc-quick-picker__add-input";
  provInput.placeholder = "Provider name (e.g. nvidia-inference)";
  provInput.value = "nvidia-inference";

  const btns = document.createElement("div");
  btns.className = "nc-quick-picker__add-actions";
  const addConfirm = document.createElement("button");
  addConfirm.type = "button";
  addConfirm.className = "nemoclaw-policy-confirm-btn nemoclaw-policy-confirm-btn--create";
  addConfirm.textContent = "Add";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "nemoclaw-policy-confirm-btn nemoclaw-policy-confirm-btn--cancel";
  cancelBtn.textContent = "Cancel";

  cancelBtn.addEventListener("click", () => form.remove());
  addConfirm.addEventListener("click", () => {
    const name = nameInput.value.trim();
    const mid = modelInput.value.trim();
    const prov = provInput.value.trim();
    if (!name || !mid || !prov) return;
    const items = getCustomQuickSelects();
    if (items.some((i) => i.modelId === mid)) { form.remove(); return; }
    items.push({ modelId: mid, name, providerName: prov });
    saveCustomQuickSelects(items);
    form.remove();
    rerenderQuickPicker(section);
    refreshModelSelector().catch(() => {});
  });

  btns.appendChild(addConfirm);
  btns.appendChild(cancelBtn);
  form.appendChild(nameInput);
  form.appendChild(modelInput);
  form.appendChild(provInput);
  form.appendChild(btns);
  section.appendChild(form);
  requestAnimationFrame(() => nameInput.focus());
}

function rerenderQuickPicker(section: HTMLElement): void {
  const fresh = buildQuickPicker();
  section.replaceWith(fresh);
}

// ---------------------------------------------------------------------------
// Section 3 — Active Configuration
// ---------------------------------------------------------------------------

function buildActiveConfig(): HTMLElement {
  const card = document.createElement("div");
  card.className = "nc-active-config";

  const title = document.createElement("div");
  title.className = "nc-active-config__title";
  title.textContent = "Active Configuration";
  card.appendChild(title);

  const routeProviderName = pendingActivation?.providerName ?? activeRoute?.providerName ?? "";
  const routeModelId = pendingActivation?.modelId ?? activeRoute?.modelId ?? "";

  // Provider row
  const provRow = document.createElement("div");
  provRow.className = "nc-active-config__row";
  const provLabel = document.createElement("label");
  provLabel.className = "nc-active-config__label";
  provLabel.textContent = "Provider";
  const provSelect = document.createElement("select");
  provSelect.className = "nemoclaw-policy-select nc-active-config__provider-select";
  for (const p of providers) {
    if (p._isNew) continue;
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name;
    if (p.name === routeProviderName) opt.selected = true;
    provSelect.appendChild(opt);
  }
  const activeProvider = providers.find((p) => p.name === routeProviderName);
  const activeType = activeProvider?._draft?.type || activeProvider?.type || "";
  const typePill = document.createElement("span");
  typePill.className = `nemoclaw-inference-type-pill nemoclaw-inference-type-pill--${PROVIDER_PROFILES[activeType] ? activeType : "generic"}`;
  typePill.textContent = activeType || "—";
  provRow.appendChild(provLabel);
  provRow.appendChild(provSelect);
  provRow.appendChild(typePill);
  card.appendChild(provRow);

  provSelect.addEventListener("change", () => {
    pendingActivation = {
      providerName: provSelect.value,
      modelId: modelInput.value || routeModelId,
    };
    markDirty();
    rerenderActiveConfig();
    const pickerSection = pageContainer?.querySelector(".nc-quick-picker");
    if (pickerSection) rerenderQuickPicker(pickerSection as HTMLElement);
  });

  // Model row
  const modelRow = document.createElement("div");
  modelRow.className = "nc-active-config__row";
  const modelLabel = document.createElement("label");
  modelLabel.className = "nc-active-config__label";
  modelLabel.textContent = "Model";
  const modelInput = document.createElement("input");
  modelInput.type = "text";
  modelInput.className = "nemoclaw-policy-input nc-active-config__model-input";
  modelInput.placeholder = "e.g. meta/llama-3.1-8b-instruct";
  modelInput.value = routeModelId;
  modelInput.addEventListener("input", () => {
    pendingActivation = {
      providerName: provSelect.value || routeProviderName,
      modelId: modelInput.value,
    };
    markDirty();
    const pickerSection = pageContainer?.querySelector(".nc-quick-picker");
    if (pickerSection) rerenderQuickPicker(pickerSection as HTMLElement);
  });
  modelRow.appendChild(modelLabel);
  modelRow.appendChild(modelInput);
  card.appendChild(modelRow);

  // Endpoint row (read-only, derived from provider config)
  const endpointRow = document.createElement("div");
  endpointRow.className = "nc-active-config__row";
  const endpointLabel = document.createElement("label");
  endpointLabel.className = "nc-active-config__label";
  endpointLabel.textContent = "Endpoint";
  const endpointValue = document.createElement("code");
  endpointValue.className = "nc-active-config__endpoint-value";
  endpointValue.textContent = resolveEndpoint(activeProvider) || "Not configured";
  const endpointHint = document.createElement("span");
  endpointHint.className = "nc-active-config__hint";
  endpointHint.textContent = "Resolved from provider config";
  endpointRow.appendChild(endpointLabel);
  const endpointWrap = document.createElement("div");
  endpointWrap.className = "nc-active-config__endpoint-wrap";
  endpointWrap.appendChild(endpointValue);
  endpointWrap.appendChild(endpointHint);
  endpointRow.appendChild(endpointWrap);
  card.appendChild(endpointRow);

  // Status row
  const statusRow = document.createElement("div");
  statusRow.className = "nc-active-config__row";
  const statusLabel = document.createElement("label");
  statusLabel.className = "nc-active-config__label";
  statusLabel.textContent = "Status";
  const hasCreds = activeProvider && (activeProvider.credentialKeys.length > 0 || Object.keys(activeProvider._draft?.credentials || {}).length > 0);
  const statusValue = document.createElement("span");
  statusValue.className = "nc-active-config__status";
  statusValue.innerHTML = `<span class="nemoclaw-inference-status-dot ${hasCreds ? "nemoclaw-inference-status-dot--ok" : "nemoclaw-inference-status-dot--missing"}"></span> ${hasCreds ? "Credentials configured" : "No credentials"}`;
  statusRow.appendChild(statusLabel);
  statusRow.appendChild(statusValue);
  card.appendChild(statusRow);

  return card;
}

function rerenderActiveConfig(): void {
  const existing = pageContainer?.querySelector(".nc-active-config");
  if (!existing) return;
  const fresh = buildActiveConfig();
  existing.replaceWith(fresh);
}

function resolveEndpoint(provider: InferenceProvider | undefined): string {
  if (!provider) return "";
  const draft = provider._draft;
  const profile = PROVIDER_PROFILES[draft?.type || provider.type];
  if (draft) {
    const urlKey = profile?.configUrlKey || "";
    if (draft.config[urlKey]) return draft.config[urlKey];
  }
  if (provider.configValues && profile) {
    const val = provider.configValues[profile.configUrlKey];
    if (val) return val;
  }
  if (provider._isNew || provider.configKeys.length === 0) {
    return profile?.defaultUrl || "";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Section 4 — Providers (Advanced, collapsible)
// ---------------------------------------------------------------------------

function buildProviderSection(): HTMLElement {
  const section = document.createElement("div");
  section.className = "nc-providers-section nc-providers-section--expanded";
  section.dataset.section = "providers";

  const headerRow = document.createElement("div");
  headerRow.className = "nc-providers-section__header nc-providers-section__header--static";
  headerRow.innerHTML = `
    <span class="nc-providers-section__title">Providers</span>
    <span class="nemoclaw-inference-provider-count nemoclaw-policy-section__count">${providers.length}</span>
    <span class="nc-providers-section__subtitle">Configure backend endpoints and credentials</span>`;

  const body = document.createElement("div");
  body.className = "nc-providers-section__body";

  section.appendChild(headerRow);

  // Provider list
  const list = document.createElement("div");
  list.className = "nemoclaw-policy-netpolicies nemoclaw-inference-provider-list";
  if (providers.length === 0) {
    list.appendChild(buildProviderEmptyState(list));
  } else {
    for (const provider of providers) {
      list.appendChild(buildProviderCard(provider, list));
    }
  }
  body.appendChild(list);

  // Add provider button
  const addWrap = document.createElement("div");
  addWrap.className = "nemoclaw-policy-add-wrap";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "nemoclaw-policy-add-btn";
  addBtn.innerHTML = `${ICON_PLUS} <span>Add Provider</span> <span class="nemoclaw-policy-add-btn__chevron">${ICON_CHEVRON_DOWN}</span>`;

  let dropdownOpen = false;
  let dropdownEl: HTMLElement | null = null;

  function closeDropdown() {
    dropdownOpen = false;
    dropdownEl?.remove();
    dropdownEl = null;
  }

  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdownOpen) { closeDropdown(); return; }
    dropdownOpen = true;
    dropdownEl = document.createElement("div");
    dropdownEl.className = "nemoclaw-policy-templates";

    const blankOpt = document.createElement("button");
    blankOpt.type = "button";
    blankOpt.className = "nemoclaw-policy-template-option nemoclaw-policy-template-option--blank";
    blankOpt.innerHTML = `<span class="nemoclaw-policy-template-option__label">Blank</span>
      <span class="nemoclaw-policy-template-option__meta">Start from scratch</span>`;
    blankOpt.addEventListener("click", (ev) => {
      ev.stopPropagation(); closeDropdown();
      showInlineNewProviderForm(list);
    });
    dropdownEl.appendChild(blankOpt);

    for (const tmpl of PROVIDER_TEMPLATES) {
      const profile = PROVIDER_PROFILES[tmpl.type];
      const urlPreview = Object.values(tmpl.config)[0] || profile?.defaultUrl || "";
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "nemoclaw-policy-template-option";
      opt.innerHTML = `<span class="nemoclaw-policy-template-option__label">${escapeHtml(tmpl.label)}</span>
        <span class="nemoclaw-policy-template-option__meta">${escapeHtml(tmpl.type)} &mdash; ${escapeHtml(urlPreview)}</span>`;
      opt.addEventListener("click", (ev) => {
        ev.stopPropagation(); closeDropdown();
        showInlineNewProviderForm(list, tmpl);
      });
      dropdownEl.appendChild(opt);
    }
    addWrap.appendChild(dropdownEl);
  });

  document.addEventListener("click", () => { if (dropdownOpen) closeDropdown(); });
  addWrap.appendChild(addBtn);
  body.appendChild(addWrap);
  section.appendChild(body);
  return section;
}

function buildProviderEmptyState(list: HTMLElement): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "nemoclaw-inference-empty-tiles";
  for (const tmpl of PROVIDER_TEMPLATES) {
    const profile = PROVIDER_PROFILES[tmpl.type];
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "nemoclaw-inference-empty-tile";
    tile.innerHTML = `
      <span class="nemoclaw-inference-empty-tile__label">${escapeHtml(tmpl.label)}</span>
      <span class="nemoclaw-inference-empty-tile__type">${escapeHtml(tmpl.type)}</span>
      <span class="nemoclaw-inference-empty-tile__url">${escapeHtml(profile?.defaultUrl || "")}</span>`;
    tile.addEventListener("click", () => {
      wrap.remove();
      showInlineNewProviderForm(list, tmpl);
    });
    wrap.appendChild(tile);
  }
  return wrap;
}

// ---------------------------------------------------------------------------
// Provider card
// ---------------------------------------------------------------------------

function getProviderDraft(p: InferenceProvider): ProviderDraft {
  if (!p._draft) {
    p._draft = { type: p.type, credentials: {}, config: { ...(p.configValues || {}) } };
  }
  return p._draft;
}

function getUrlPreview(p: InferenceProvider): string {
  const draft = p._draft;
  const profile = PROVIDER_PROFILES[draft?.type || p.type];
  if (draft) {
    const urlKey = profile?.configUrlKey || "";
    if (draft.config[urlKey]) return draft.config[urlKey];
  }
  if (p.configValues && profile) {
    const val = p.configValues[profile.configUrlKey];
    if (val) return val;
  }
  if (p._isNew || p.configKeys.length === 0) {
    return profile?.defaultUrl || "";
  }
  return "";
}

function buildProviderCard(provider: InferenceProvider, list: HTMLElement): HTMLElement {
  const isActive = !provider._isNew && activeRoute?.providerName === provider.name;
  const card = document.createElement("div");
  card.className = "nemoclaw-policy-netcard" + (isActive ? " nemoclaw-policy-netcard--active" : "");
  card.dataset.providerName = provider.name;
  card.dataset.providerType = provider._draft?.type || provider.type;

  const header = document.createElement("div");
  header.className = "nemoclaw-policy-netcard__header";

  const effectiveType = provider._draft?.type || provider.type;
  const hasCreds = provider.credentialKeys.length > 0 || Object.keys(provider._draft?.credentials || {}).length > 0;
  const typePill = buildTypePill(effectiveType);
  const statusDot = `<span class="nemoclaw-inference-status-dot ${hasCreds ? "nemoclaw-inference-status-dot--ok" : "nemoclaw-inference-status-dot--missing"}" title="${hasCreds ? "Credentials configured" : "No credentials"}"></span>`;
  const urlPreview = getUrlPreview(provider);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "nemoclaw-policy-netcard__toggle";
  toggle.innerHTML = `<span class="nemoclaw-policy-netcard__chevron">${ICON_CHEVRON_RIGHT}</span>
    <span class="nemoclaw-policy-netcard__name">${escapeHtml(provider.name)}</span>
    ${typePill}
    <span class="nemoclaw-policy-netcard__summary">${escapeHtml(urlPreview)}</span>
    ${statusDot}`;

  const actions = document.createElement("div");
  actions.className = "nemoclaw-policy-netcard__actions";

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "nemoclaw-policy-icon-btn nemoclaw-policy-icon-btn--danger";
  deleteBtn.title = "Delete provider";
  deleteBtn.innerHTML = ICON_TRASH;
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showDeleteConfirmation(actions, deleteBtn, provider, card, list);
  });
  actions.appendChild(deleteBtn);

  header.appendChild(toggle);
  header.appendChild(actions);

  const body = document.createElement("div");
  body.className = "nemoclaw-policy-netcard__body";
  body.style.display = "none";
  renderProviderBody(body, provider);

  let expanded = provider._isNew || false;
  if (expanded) {
    body.style.display = "";
    card.classList.add("nemoclaw-policy-netcard--expanded");
  }

  toggle.addEventListener("click", () => {
    expanded = !expanded;
    body.style.display = expanded ? "" : "none";
    card.classList.toggle("nemoclaw-policy-netcard--expanded", expanded);
  });

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function buildTypePill(type: string): string {
  const cls = PROVIDER_PROFILES[type] ? type : "generic";
  return `<span class="nemoclaw-inference-type-pill nemoclaw-inference-type-pill--${cls}">${escapeHtml(type)}</span>`;
}

// ---------------------------------------------------------------------------
// Delete confirmation
// ---------------------------------------------------------------------------

function showDeleteConfirmation(actions: HTMLElement, deleteBtn: HTMLElement, provider: InferenceProvider, card: HTMLElement, list: HTMLElement): void {
  const isDeletingActive = !provider._isNew && activeRoute?.providerName === provider.name;

  deleteBtn.style.display = "none";
  const confirmWrap = document.createElement("div");
  confirmWrap.className = "nemoclaw-policy-confirm-actions";

  if (isDeletingActive) {
    const warning = document.createElement("span");
    warning.className = "nemoclaw-inference-delete-warning";
    warning.textContent = "Active provider \u2014 deleting will break inference.";
    confirmWrap.appendChild(warning);
  }

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "nemoclaw-policy-confirm-btn nemoclaw-policy-confirm-btn--delete";
  confirmBtn.textContent = isDeletingActive ? "Delete anyway" : "Delete";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "nemoclaw-policy-confirm-btn nemoclaw-policy-confirm-btn--cancel";
  cancelBtn.textContent = "Cancel";

  confirmWrap.appendChild(confirmBtn);
  confirmWrap.appendChild(cancelBtn);
  actions.appendChild(confirmWrap);
  card.classList.add("nemoclaw-policy-netcard--confirming");
  if (isDeletingActive) card.classList.add("nemoclaw-policy-netcard--confirming-danger");

  const revert = () => {
    confirmWrap.remove();
    deleteBtn.style.display = "";
    card.classList.remove("nemoclaw-policy-netcard--confirming", "nemoclaw-policy-netcard--confirming-danger");
  };
  const timeout = setTimeout(revert, 5000);

  cancelBtn.addEventListener("click", (e) => { e.stopPropagation(); clearTimeout(timeout); revert(); });
  confirmBtn.addEventListener("click", (e) => {
    e.stopPropagation(); clearTimeout(timeout);
    const idx = providers.indexOf(provider);
    if (idx >= 0) providers.splice(idx, 1);
    if (!provider._isNew) deletedProviders.push(provider.name);
    changeTracker.added.delete(provider.name);
    changeTracker.modified.delete(provider.name);
    changeTracker.deleted.add(provider.name);
    markDirty();
    card.remove();
    updateProviderCount();
    if (providers.length === 0) {
      const listEl = pageContainer?.querySelector<HTMLElement>(".nemoclaw-inference-provider-list");
      if (listEl) listEl.appendChild(buildProviderEmptyState(listEl));
    }
  });
}

// ---------------------------------------------------------------------------
// Inline new-provider form
// ---------------------------------------------------------------------------

function showInlineNewProviderForm(
  list: HTMLElement,
  template?: { name: string; type: string; config: Record<string, string> },
): void {
  const existing = list.querySelector(".nemoclaw-policy-newcard");
  if (existing) existing.remove();
  const emptyState = list.querySelector(".nemoclaw-policy-net-empty, .nemoclaw-inference-empty-tiles");
  if (emptyState) emptyState.remove();

  const form = document.createElement("div");
  form.className = "nemoclaw-policy-newcard";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "nemoclaw-policy-input";
  input.placeholder = "e.g. my_openai_provider";
  input.value = template ? template.name : "";

  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.className = "nemoclaw-policy-confirm-btn nemoclaw-policy-confirm-btn--create";
  createBtn.textContent = "Create";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "nemoclaw-policy-confirm-btn nemoclaw-policy-confirm-btn--cancel";
  cancelBtn.textContent = "Cancel";

  const hint = document.createElement("div");
  hint.className = "nemoclaw-policy-newcard__hint";
  hint.textContent = "Use snake_case. Only letters, numbers, _ and - allowed.";
  const error = document.createElement("div");
  error.className = "nemoclaw-policy-newcard__error";

  form.appendChild(input);
  form.appendChild(createBtn);
  form.appendChild(cancelBtn);
  form.appendChild(hint);
  form.appendChild(error);
  list.prepend(form);
  requestAnimationFrame(() => input.focus());

  const cancel = () => {
    form.remove();
    if (providers.length === 0) list.appendChild(buildProviderEmptyState(list));
  };
  cancelBtn.addEventListener("click", cancel);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cancel();
    if (e.key === "Enter") doCreate();
  });

  function doCreate() {
    const raw = input.value.trim();
    if (!raw) { error.textContent = "Name is required."; return; }
    const key = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
    if (providers.some((p) => p.name === key)) {
      error.textContent = `A provider named "${key}" already exists.`;
      input.classList.add("nemoclaw-policy-input--error");
      return;
    }
    const type = template?.type || "openai";
    const profile = PROVIDER_PROFILES[type] || PROVIDER_PROFILES.openai;
    const newProvider: InferenceProvider = {
      id: "(pending)", name: key, type,
      credentialKeys: [], configKeys: Object.keys(template?.config || {}),
      _isNew: true,
      _draft: {
        type, credentials: {},
        config: template?.config ? { ...template.config } : { [profile.configUrlKey]: profile.defaultUrl },
      },
    };
    providers.push(newProvider);
    changeTracker.added.add(key);
    markDirty();
    form.remove();
    list.appendChild(buildProviderCard(newProvider, list));
    updateProviderCount();
  }
  createBtn.addEventListener("click", doCreate);
}

// ---------------------------------------------------------------------------
// Provider body (expanded card)
// ---------------------------------------------------------------------------

function renderProviderBody(body: HTMLElement, provider: InferenceProvider): void {
  body.innerHTML = "";
  const draft = getProviderDraft(provider);
  const profile = PROVIDER_PROFILES[draft.type] || PROVIDER_PROFILES.generic;

  // Type selector + auth chip
  const typeRow = document.createElement("div");
  typeRow.className = "nemoclaw-inference-flat-row";

  const typeField = document.createElement("label");
  typeField.className = "nemoclaw-policy-field";
  typeField.innerHTML = `<span class="nemoclaw-policy-field__label">Type</span>`;
  const typeSelect = document.createElement("select");
  typeSelect.className = "nemoclaw-policy-select";
  for (const t of PROVIDER_TYPE_OPTIONS) {
    const o = document.createElement("option");
    o.value = t; o.textContent = t;
    if (t === draft.type) o.selected = true;
    typeSelect.appendChild(o);
  }
  typeSelect.addEventListener("change", () => {
    draft.type = typeSelect.value;
    if (!provider._isNew) changeTracker.modified.add(provider.name);
    markDirty();
    renderProviderBody(body, provider);
  });
  typeField.appendChild(typeSelect);
  const authChip = document.createElement("span");
  authChip.className = "nc-auth-chip";
  authChip.textContent = `Auth: ${profile.authStyle}`;
  typeField.appendChild(authChip);
  typeRow.appendChild(typeField);
  body.appendChild(typeRow);

  // Credentials
  const credRow = document.createElement("div");
  credRow.className = "nemoclaw-inference-flat-row";
  if (provider._isNew) {
    credRow.appendChild(buildCredentialInput(provider, profile.credentialKey));
  } else if (provider.credentialKeys.length > 0) {
    const chipRow = document.createElement("div");
    chipRow.className = "nemoclaw-inference-cred-chips";
    for (const key of provider.credentialKeys) {
      const chip = document.createElement("span");
      chip.className = "nemoclaw-inference-cred-chip";
      chip.innerHTML = `<code>${escapeHtml(key)}</code> <span class="nemoclaw-inference-cred-chip__status">configured</span>`;
      chipRow.appendChild(chip);
    }
    credRow.appendChild(chipRow);

    const rotateToggle = document.createElement("button");
    rotateToggle.type = "button";
    rotateToggle.className = "nemoclaw-policy-ep-advanced-toggle";
    rotateToggle.innerHTML = `<span class="nemoclaw-policy-ep-advanced-toggle__chevron">${ICON_CHEVRON_RIGHT}</span> Rotate`;
    let rotateOpen = Object.keys(draft.credentials).length > 0;
    const rotatePanel = document.createElement("div");
    rotatePanel.style.display = rotateOpen ? "" : "none";
    if (rotateOpen) rotateToggle.classList.add("nemoclaw-policy-ep-advanced-toggle--open");
    for (const key of provider.credentialKeys) {
      rotatePanel.appendChild(buildCredentialInput(provider, key));
    }
    rotateToggle.addEventListener("click", () => {
      rotateOpen = !rotateOpen;
      rotatePanel.style.display = rotateOpen ? "" : "none";
      rotateToggle.classList.toggle("nemoclaw-policy-ep-advanced-toggle--open", rotateOpen);
    });
    credRow.appendChild(rotateToggle);
    credRow.appendChild(rotatePanel);
  } else {
    credRow.appendChild(buildCredentialInput(provider, profile.credentialKey));
  }
  body.appendChild(credRow);

  // Config key-value pairs (label "Endpoint" for *_BASE_URL keys)
  const configRow = document.createElement("div");
  configRow.className = "nemoclaw-inference-flat-row";
  const configList = document.createElement("div");
  configList.className = "nemoclaw-inference-config-list";
  const configKeys = new Set([...provider.configKeys, ...Object.keys(draft.config)]);
  if (configKeys.size === 0 && profile.configUrlKey) configKeys.add(profile.configUrlKey);
  for (const key of configKeys) {
    configList.appendChild(buildConfigRow(provider, key, configList));
  }
  configRow.appendChild(configList);
  const addConfigBtn = document.createElement("button");
  addConfigBtn.type = "button";
  addConfigBtn.className = "nemoclaw-policy-add-small-btn";
  addConfigBtn.innerHTML = `${ICON_PLUS} Add Config Entry`;
  addConfigBtn.addEventListener("click", () => {
    configList.appendChild(buildConfigRow(provider, "", configList, true));
    if (!provider._isNew) changeTracker.modified.add(provider.name);
    markDirty();
  });
  configRow.appendChild(addConfigBtn);
  body.appendChild(configRow);
}

// ---------------------------------------------------------------------------
// Credential input
// ---------------------------------------------------------------------------

function buildCredentialInput(provider: InferenceProvider, keyName: string): HTMLElement {
  const draft = getProviderDraft(provider);
  const row = document.createElement("div");
  row.className = "nemoclaw-inference-cred-input-row";
  const label = document.createElement("label");
  label.className = "nemoclaw-policy-field";
  label.innerHTML = `<span class="nemoclaw-policy-field__label">${escapeHtml(keyName)}</span>`;
  const inputWrap = document.createElement("div");
  inputWrap.className = "nemoclaw-key-field__input-row";
  const input = document.createElement("input");
  input.type = "password";
  input.className = "nemoclaw-policy-input";
  input.placeholder = provider._isNew ? "sk-... or nvapi-..." : "Enter new value to rotate";
  input.value = draft.credentials[keyName] || "";
  input.addEventListener("input", () => {
    if (input.value.trim()) { draft.credentials[keyName] = input.value; }
    else { delete draft.credentials[keyName]; }
    if (!provider._isNew) changeTracker.modified.add(provider.name);
    markDirty();
  });
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "nemoclaw-key-field__toggle";
  toggleBtn.innerHTML = ICON_EYE;
  toggleBtn.addEventListener("click", () => {
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    toggleBtn.innerHTML = isHidden ? ICON_EYE_OFF : ICON_EYE;
  });
  inputWrap.appendChild(input);
  inputWrap.appendChild(toggleBtn);
  label.appendChild(inputWrap);
  row.appendChild(label);
  return row;
}

// ---------------------------------------------------------------------------
// Config row
// ---------------------------------------------------------------------------

function buildConfigRow(provider: InferenceProvider, key: string, configList: HTMLElement, isNew = false): HTMLElement {
  const draft = getProviderDraft(provider);
  const row = document.createElement("div");
  row.className = "nemoclaw-inference-config-row";

  const isUrlKey = key.endsWith("_BASE_URL") || key === "BASE_URL";
  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className = "nemoclaw-policy-input nemoclaw-inference-config-row__key";
  keyInput.placeholder = isUrlKey ? "Endpoint" : "KEY";
  keyInput.value = key;
  keyInput.readOnly = !isNew && !!key;
  if (keyInput.readOnly) keyInput.classList.add("nemoclaw-inference-config-row__key--readonly");

  const valInput = document.createElement("input");
  valInput.type = "text";
  valInput.className = "nemoclaw-policy-input nemoclaw-inference-config-row__value";
  valInput.placeholder = isUrlKey ? "https://api.example.com/v1" : "value";
  valInput.value = draft.config[key] || "";

  const update = () => {
    const k = keyInput.value.trim();
    if (k && valInput.value) {
      if (k !== key && key) delete draft.config[key];
      draft.config[k] = valInput.value;
    }
    if (!provider._isNew) changeTracker.modified.add(provider.name);
    markDirty();
  };
  keyInput.addEventListener("input", update);
  valInput.addEventListener("input", update);

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "nemoclaw-policy-icon-btn nemoclaw-policy-icon-btn--danger";
  delBtn.title = "Remove config entry";
  delBtn.innerHTML = ICON_TRASH;
  delBtn.addEventListener("click", () => {
    const k = keyInput.value.trim() || key;
    if (k) delete draft.config[k];
    if (!provider._isNew) changeTracker.modified.add(provider.name);
    markDirty();
    row.remove();
  });

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(delBtn);
  return row;
}

// ---------------------------------------------------------------------------
// Save bar
// ---------------------------------------------------------------------------

function buildSaveBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "nemoclaw-policy-savebar nemoclaw-policy-savebar--hidden";
  const info = document.createElement("div");
  info.className = "nemoclaw-policy-savebar__info";
  info.innerHTML = `<div>
    <span class="nemoclaw-policy-savebar__summary">Unsaved changes</span>
  </div>`;
  const actions = document.createElement("div");
  actions.className = "nemoclaw-policy-savebar__actions";
  const feedback = document.createElement("div");
  feedback.className = "nemoclaw-policy-savebar__feedback";
  feedback.setAttribute("role", "status");

  const discardBtn = document.createElement("button");
  discardBtn.type = "button";
  discardBtn.className = "nemoclaw-policy-discard-btn";
  discardBtn.textContent = "Discard";
  discardBtn.addEventListener("click", () => handleDiscard(bar, discardBtn));
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "nemoclaw-policy-save-btn";
  saveBtn.textContent = "Save & Apply";
  saveBtn.addEventListener("click", () => handleSave(saveBtn, feedback, bar));

  actions.appendChild(feedback);
  actions.appendChild(discardBtn);
  actions.appendChild(saveBtn);
  bar.appendChild(info);
  bar.appendChild(actions);
  return bar;
}

function handleDiscard(bar: HTMLElement, discardBtn: HTMLButtonElement): void {
  if (discardBtn.dataset.confirming === "true") return;
  discardBtn.dataset.confirming = "true";
  const origText = discardBtn.textContent;
  discardBtn.textContent = "Discard all changes?";
  discardBtn.classList.add("nemoclaw-policy-discard-btn--confirming");
  const timer = setTimeout(() => {
    discardBtn.textContent = origText;
    discardBtn.classList.remove("nemoclaw-policy-discard-btn--confirming");
    delete discardBtn.dataset.confirming;
  }, 3000);
  discardBtn.addEventListener("click", function onConfirm() {
    discardBtn.removeEventListener("click", onConfirm);
    clearTimeout(timer);
    delete discardBtn.dataset.confirming;
    if (!pageContainer) return;
    bar.classList.remove("nemoclaw-policy-savebar--visible");
    bar.classList.add("nemoclaw-policy-savebar--hidden");
    loadAndRender(pageContainer);
  }, { once: true });
}

async function handleSave(btn: HTMLButtonElement, feedback: HTMLElement, bar: HTMLElement): Promise<void> {
  btn.disabled = true;
  feedback.className = "nemoclaw-policy-savebar__feedback nemoclaw-policy-savebar__feedback--saving";
  feedback.innerHTML = `<span class="nemoclaw-policy-savebar__spinner">${ICON_LOADER}</span> Applying\u2026`;

  const errors: string[] = [];
  try {
    // Step 1: Delete removed providers
    if (deletedProviders.length > 0) {
      for (const name of deletedProviders) {
        try { await apiDeleteProvider(name); }
        catch (err) { errors.push(`Delete ${name}: ${err}`); }
      }
    }

    // Step 2: Create new providers
    const newProviders = providers.filter((p) => p._isNew && changeTracker.added.has(p.name));
    if (newProviders.length > 0) {
      for (const provider of newProviders) {
        const draft = provider._draft;
        if (!draft) continue;
        try {
          await apiCreateProvider({ name: provider.name, type: draft.type, credentials: draft.credentials, config: draft.config });
        } catch (err) {
          const msg = String(err);
          if (msg.includes("AlreadyExists") || msg.includes("already exists")) {
            try {
              await apiUpdateProvider(provider.name, { type: draft.type, credentials: draft.credentials, config: draft.config });
            } catch (updateErr) { errors.push(`Update ${provider.name}: ${updateErr}`); }
          } else {
            errors.push(`Create ${provider.name}: ${err}`);
          }
        }
      }
    }

    // Step 3: Update modified providers
    const modifiedProviders = providers.filter((p) => !p._isNew && changeTracker.modified.has(p.name));
    if (modifiedProviders.length > 0) {
      for (const provider of modifiedProviders) {
        const draft = provider._draft;
        if (!draft) continue;
        try {
          await apiUpdateProvider(provider.name, { type: draft.type, credentials: draft.credentials, config: draft.config });
        } catch (err) { errors.push(`Update ${provider.name}: ${err}`); }
      }
    }

    // Step 4: Activate route
    if (pendingActivation && errors.length === 0) {
      try {
        await apiSetClusterInference(pendingActivation.providerName, pendingActivation.modelId);
      } catch (err) { errors.push(`Activate ${pendingActivation.providerName}: ${err}`); }
    }

    if (errors.length > 0) {
      feedback.className = "nemoclaw-policy-savebar__feedback nemoclaw-policy-savebar__feedback--error";
      feedback.innerHTML = `${ICON_CLOSE} ${escapeHtml(errors.join("; "))}`;
    } else {
      feedback.className = "nemoclaw-policy-savebar__feedback nemoclaw-policy-savebar__feedback--success";
      feedback.innerHTML = `${ICON_CHECK} Route configured &mdash; propagating to sandbox&hellip;`;
      changeTracker.modified.clear();
      changeTracker.added.clear();
      changeTracker.deleted.clear();
      deletedProviders = [];

      const savedModelId = pendingActivation?.modelId || activeRoute?.modelId || "";
      pendingActivation = null;
      refreshModelSelector().then(() => {
        if (savedModelId) setActiveModelFromExternal(savedModelId);
      }).catch(() => {});

      setTimeout(() => {
        feedback.className = "nemoclaw-policy-savebar__feedback";
        feedback.textContent = "";
        bar.classList.remove("nemoclaw-policy-savebar--visible");
        bar.classList.add("nemoclaw-policy-savebar--hidden");
        if (pageContainer) loadAndRender(pageContainer);
      }, 3000);
    }
  } catch (err) {
    feedback.className = "nemoclaw-policy-savebar__feedback nemoclaw-policy-savebar__feedback--error";
    feedback.innerHTML = `${ICON_CLOSE} ${escapeHtml(String(err))}`;
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Change tracking helpers
// ---------------------------------------------------------------------------

function markDirty(): void {
  if (saveBarEl) {
    saveBarEl.classList.remove("nemoclaw-policy-savebar--hidden");
    saveBarEl.classList.add("nemoclaw-policy-savebar--visible");
    updateSaveBarSummary();
  }
}

function updateSaveBarSummary(): void {
  if (!saveBarEl) return;
  const summaryEl = saveBarEl.querySelector<HTMLElement>(".nemoclaw-policy-savebar__summary");
  if (!summaryEl) return;
  const parts: string[] = [];
  if (changeTracker.modified.size > 0) parts.push(`${changeTracker.modified.size} modified`);
  if (changeTracker.added.size > 0) parts.push(`${changeTracker.added.size} added`);
  if (changeTracker.deleted.size > 0) parts.push(`${changeTracker.deleted.size} deleted`);
  if (pendingActivation) {
    const curated = getCuratedByModelId(pendingActivation.modelId);
    const label = curated ? curated.name : pendingActivation.modelId;
    parts.push(`switch to ${label}`);
  }
  summaryEl.textContent = parts.length > 0 ? `Unsaved: ${parts.join(", ")}` : "Unsaved changes";
}

function updateProviderCount(): void {
  const countEl = document.querySelector<HTMLElement>(".nemoclaw-inference-provider-count");
  if (countEl) countEl.textContent = String(providers.length);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
