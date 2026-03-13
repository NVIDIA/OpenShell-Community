/**
 * NeMoClaw DevX — API Keys Settings Page
 *
 * Full-page overlay for entering and persisting NVIDIA API keys.
 * Keys are stored in localStorage and resolved at call time by
 * model-registry.ts getter functions.
 */

import { ICON_KEY, ICON_EYE, ICON_EYE_OFF, ICON_CHECK, ICON_LOADER, ICON_CLOSE } from "./icons.ts";
import {
  getInferenceApiKey,
  getIntegrateApiKey,
  setInferenceApiKey,
  setIntegrateApiKey,
  isKeyConfigured,
} from "./model-registry.ts";

// ---------------------------------------------------------------------------
// Key field definitions
// ---------------------------------------------------------------------------

interface KeyFieldDef {
  id: string;
  label: string;
  description: string;
  placeholder: string;
  serverCredentialKey: string;
  get: () => string;
  set: (v: string) => void;
}

const KEY_FIELDS: KeyFieldDef[] = [
  {
    id: "inference",
    label: "Inference API Key",
    description: "For inference-api.nvidia.com — powers NVIDIA Claude Opus 4.6",
    placeholder: "nvapi-...",
    serverCredentialKey: "OPENAI_API_KEY",
    get: getInferenceApiKey,
    set: setInferenceApiKey,
  },
  {
    id: "integrate",
    label: "Integrate API Key",
    description: "For integrate.api.nvidia.com — powers Kimi K2.5, Nemotron Ultra, DeepSeek V3.2",
    placeholder: "nvapi-...",
    serverCredentialKey: "NVIDIA_API_KEY",
    get: getIntegrateApiKey,
    set: setIntegrateApiKey,
  },
];

// ---------------------------------------------------------------------------
// Sync localStorage keys to server-side provider credentials
// ---------------------------------------------------------------------------

interface ProviderSummary {
  name: string;
  type: string;
  credentialKeys: string[];
}

/**
 * Push localStorage API keys to every server-side provider whose credential
 * key matches.  This bridges the gap between the browser-only API Keys tab
 * and the NemoClaw proxy which reads credentials from the server-side store.
 */
export async function syncKeysToProviders(): Promise<void> {
  const res = await fetch("/api/providers");
  if (!res.ok) throw new Error(`Failed to fetch providers: ${res.status}`);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || "Failed to fetch providers");

  const providers: ProviderSummary[] = body.providers || [];
  const errors: string[] = [];

  for (const provider of providers) {
    for (const field of KEY_FIELDS) {
      const key = field.get();
      if (!isKeyConfigured(key)) continue;
      if (!provider.credentialKeys?.includes(field.serverCredentialKey)) continue;

      try {
        const updateRes = await fetch(`/api/providers/${encodeURIComponent(provider.name)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: provider.type,
            credentials: { [field.serverCredentialKey]: key },
            config: {},
          }),
        });
        const updateBody = await updateRes.json();
        if (!updateBody.ok) {
          errors.push(`${provider.name}: ${updateBody.error || "update failed"}`);
        }
      } catch (err) {
        errors.push(`${provider.name}: ${err}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

// ---------------------------------------------------------------------------
// Render the API Keys page into a container element
// ---------------------------------------------------------------------------

export function renderApiKeysPage(container: HTMLElement): void {
  container.innerHTML = `
    <section class="content-header">
      <div>
        <div class="page-title">API Keys</div>
        <div class="page-sub">Configure your NVIDIA API keys for model endpoints</div>
      </div>
    </section>
    <div class="nemoclaw-key-page"></div>`;

  const page = container.querySelector<HTMLElement>(".nemoclaw-key-page")!;

  const intro = document.createElement("div");
  intro.className = "nemoclaw-key-intro";
  intro.innerHTML = `
    <div class="nemoclaw-key-intro__icon">${ICON_KEY}</div>
    <p class="nemoclaw-key-intro__text">
      Enter your NVIDIA API keys to enable model switching and DGX deployment.
      Keys are stored locally in your browser and never sent to third parties.
    </p>
    <a class="nemoclaw-key-intro__link" href="https://build.nvidia.com/settings/api-keys" target="_blank" rel="noopener noreferrer">
      Get your keys at build.nvidia.com &rarr;
    </a>`;
  page.appendChild(intro);

  const form = document.createElement("div");
  form.className = "nemoclaw-key-form";

  for (const field of KEY_FIELDS) {
    form.appendChild(buildKeyField(field));
  }

  const actions = document.createElement("div");
  actions.className = "nemoclaw-key-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "nemoclaw-key-save";
  saveBtn.textContent = "Save Keys";

  const feedback = document.createElement("div");
  feedback.className = "nemoclaw-key-feedback";
  feedback.setAttribute("role", "status");

  actions.appendChild(saveBtn);
  actions.appendChild(feedback);
  form.appendChild(actions);
  page.appendChild(form);

  saveBtn.addEventListener("click", async () => {
    for (const field of KEY_FIELDS) {
      const input = form.querySelector<HTMLInputElement>(`[data-key-id="${field.id}"]`);
      if (input) field.set(input.value.trim());
    }

    updateStatusDots();

    feedback.className = "nemoclaw-key-feedback nemoclaw-key-feedback--saving";
    feedback.innerHTML = `${ICON_LOADER}<span>Syncing keys to providers\u2026</span>`;
    saveBtn.disabled = true;

    try {
      await syncKeysToProviders();
      feedback.className = "nemoclaw-key-feedback nemoclaw-key-feedback--success";
      feedback.innerHTML = `${ICON_CHECK}<span>Keys saved &amp; synced to providers</span>`;
    } catch (err) {
      console.warn("[NeMoClaw] Provider key sync failed:", err);
      feedback.className = "nemoclaw-key-feedback nemoclaw-key-feedback--error";
      feedback.innerHTML = `${ICON_CLOSE}<span>Keys saved locally but sync failed</span>`;
    } finally {
      saveBtn.disabled = false;
      setTimeout(() => {
        feedback.className = "nemoclaw-key-feedback";
        feedback.textContent = "";
      }, 4000);
    }
  });
}

// ---------------------------------------------------------------------------
// Build a single key input field
// ---------------------------------------------------------------------------

function buildKeyField(def: KeyFieldDef): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "nemoclaw-key-field";

  const currentValue = def.get();
  const displayValue = isKeyConfigured(currentValue) ? currentValue : "";

  const statusClass = isKeyConfigured(currentValue)
    ? "nemoclaw-key-dot--ok"
    : "nemoclaw-key-dot--missing";

  wrapper.innerHTML = `
    <div class="nemoclaw-key-field__header">
      <label class="nemoclaw-key-field__label" for="nemoclaw-key-${def.id}">
        ${def.label}
        <span class="nemoclaw-key-dot ${statusClass}"></span>
      </label>
    </div>
    <p class="nemoclaw-key-field__desc">${def.description}</p>
    <div class="nemoclaw-key-field__input-row">
      <input
        id="nemoclaw-key-${def.id}"
        data-key-id="${def.id}"
        type="password"
        class="nemoclaw-key-field__input"
        placeholder="${def.placeholder}"
        value="${escapeAttr(displayValue)}"
        autocomplete="off"
        spellcheck="false"
      />
      <button type="button" class="nemoclaw-key-field__toggle" aria-label="Toggle visibility">
        ${ICON_EYE}
      </button>
    </div>`;

  const input = wrapper.querySelector<HTMLInputElement>("input")!;
  const toggle = wrapper.querySelector<HTMLButtonElement>(".nemoclaw-key-field__toggle")!;
  let visible = false;

  toggle.addEventListener("click", () => {
    visible = !visible;
    input.type = visible ? "text" : "password";
    toggle.innerHTML = visible ? ICON_EYE_OFF : ICON_EYE;
  });

  return wrapper;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Status dots — update all nav-item dots to reflect current key state
// ---------------------------------------------------------------------------

export function areAllKeysConfigured(): boolean {
  return KEY_FIELDS.every((f) => isKeyConfigured(f.get()));
}

export function updateStatusDots(): void {
  const dot = document.querySelector<HTMLElement>('[data-nemoclaw-page="nemoclaw-api-keys"] .nemoclaw-nav-dot');
  if (!dot) return;
  const ok = areAllKeysConfigured();
  dot.classList.toggle("nemoclaw-nav-dot--ok", ok);
  dot.classList.toggle("nemoclaw-nav-dot--missing", !ok);
}
