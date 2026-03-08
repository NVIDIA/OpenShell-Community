/**
 * NeMoClaw DevX — Policy Page
 *
 * Interactive policy viewer and editor.  Fetches the sandbox policy YAML from
 * the policy-proxy API, renders educational sections for immutable fields and
 * a full CRUD editor for network policies, and saves changes back via POST.
 */

import * as yaml from "js-yaml";
import {
  ICON_LOCK,
  ICON_GLOBE,
  ICON_INFO,
  ICON_PLUS,
  ICON_TRASH,
  ICON_EDIT,
  ICON_CHECK,
  ICON_CHEVRON_RIGHT,
  ICON_CHEVRON_DOWN,
  ICON_LOADER,
  ICON_TERMINAL,
  ICON_CLOSE,
} from "./icons.ts";

// ---------------------------------------------------------------------------
// Types — mirrors the YAML schema
// ---------------------------------------------------------------------------

interface PolicyEndpoint {
  host?: string;
  port: number;
  protocol?: string;
  tls?: string;
  enforcement?: string;
  access?: string;
  rules?: { allow: { method: string; path: string } }[];
  allowed_ips?: string[];
}

interface PolicyBinary {
  path: string;
}

interface NetworkPolicy {
  name: string;
  endpoints: PolicyEndpoint[];
  binaries: PolicyBinary[];
}

interface SandboxPolicy {
  version: number;
  filesystem_policy?: {
    include_workdir?: boolean;
    read_only?: string[];
    read_write?: string[];
  };
  landlock?: { compatibility?: string };
  process?: { run_as_user?: string; run_as_group?: string };
  network_policies?: Record<string, NetworkPolicy>;
  inference?: Record<string, unknown>;
}

interface SelectOption {
  value: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Policy templates
// ---------------------------------------------------------------------------

const POLICY_TEMPLATES: { label: string; key: string; policy: NetworkPolicy }[] = [
  {
    label: "GitHub (git + API)",
    key: "github_custom",
    policy: {
      name: "github_custom",
      endpoints: [
        { host: "github.com", port: 443 },
        { host: "api.github.com", port: 443 },
      ],
      binaries: [{ path: "/usr/bin/git" }, { path: "/usr/bin/gh" }],
    },
  },
  {
    label: "npm Registry",
    key: "npm",
    policy: {
      name: "npm",
      endpoints: [{ host: "registry.npmjs.org", port: 443 }],
      binaries: [{ path: "/usr/bin/npm" }, { path: "/usr/bin/node" }],
    },
  },
  {
    label: "PyPI",
    key: "pypi",
    policy: {
      name: "pypi",
      endpoints: [
        { host: "pypi.org", port: 443 },
        { host: "files.pythonhosted.org", port: 443 },
      ],
      binaries: [{ path: "/usr/bin/pip" }, { path: "/usr/bin/python3" }],
    },
  },
  {
    label: "Docker Hub",
    key: "docker_hub",
    policy: {
      name: "docker_hub",
      endpoints: [
        { host: "registry-1.docker.io", port: 443 },
        { host: "auth.docker.io", port: 443 },
        { host: "production.cloudflare.docker.com", port: 443 },
      ],
      binaries: [{ path: "/usr/bin/docker" }],
    },
  },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentPolicy: SandboxPolicy | null = null;
let rawYaml = "";
let isDirty = false;
const changeTracker = {
  modified: new Set<string>(),
  added: new Set<string>(),
  deleted: new Set<string>(),
};
let pageContainer: HTMLElement | null = null;
let saveBarEl: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchPolicy(): Promise<string> {
  const res = await fetch("/api/policy");
  if (!res.ok) throw new Error(`Failed to load policy: ${res.status}`);
  return res.text();
}

async function savePolicy(yamlText: string): Promise<void> {
  const res = await fetch("/api/policy", {
    method: "POST",
    headers: { "Content-Type": "text/yaml" },
    body: yamlText,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Save failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Render entry point
// ---------------------------------------------------------------------------

export function renderPolicyPage(container: HTMLElement): void {
  container.innerHTML = `
    <section class="content-header">
      <div>
        <div class="page-title">Sandbox Policy</div>
        <div class="page-sub">Security guardrails that control what your sandbox can do</div>
      </div>
    </section>
    <div class="nemoclaw-policy-page">
      <div class="nemoclaw-policy-loading">
        <span class="nemoclaw-policy-loading__spinner">${ICON_LOADER}</span>
        <span>Loading policy&hellip;</span>
      </div>
    </div>`;

  pageContainer = container;
  loadAndRender(container);
}

async function loadAndRender(container: HTMLElement): Promise<void> {
  const page = container.querySelector<HTMLElement>(".nemoclaw-policy-page")!;
  try {
    rawYaml = await fetchPolicy();
    currentPolicy = yaml.load(rawYaml) as SandboxPolicy;
    isDirty = false;
    changeTracker.modified.clear();
    changeTracker.added.clear();
    changeTracker.deleted.clear();
    renderPageContent(page);
  } catch (err) {
    page.innerHTML = `
      <div class="nemoclaw-policy-error">
        <p>Could not load the sandbox policy.</p>
        <p class="nemoclaw-policy-error__detail">${escapeHtml(String(err))}</p>
        <button class="nemoclaw-policy-retry-btn" type="button">Retry</button>
      </div>`;
    page.querySelector(".nemoclaw-policy-retry-btn")?.addEventListener("click", () => {
      page.innerHTML = `
        <div class="nemoclaw-policy-loading">
          <span class="nemoclaw-policy-loading__spinner">${ICON_LOADER}</span>
          <span>Loading policy&hellip;</span>
        </div>`;
      loadAndRender(container);
    });
  }
}

// ---------------------------------------------------------------------------
// Main page layout
// ---------------------------------------------------------------------------

function renderPageContent(page: HTMLElement): void {
  if (!currentPolicy) return;

  page.innerHTML = "";

  page.appendChild(buildStatusBar());

  page.appendChild(buildImmutableDisclosure());

  page.appendChild(buildNetworkPoliciesSection());

  saveBarEl = buildSaveBar();
  page.appendChild(saveBarEl);
}

// ---------------------------------------------------------------------------
// Status bar (replaces intro section)
// ---------------------------------------------------------------------------

function buildStatusBar(): HTMLElement {
  const el = document.createElement("div");
  el.className = "nemoclaw-policy-statusbar";

  const policies = currentPolicy?.network_policies || {};
  const policyCount = Object.keys(policies).length;
  let totalEndpoints = 0;
  let totalBinaries = 0;
  for (const p of Object.values(policies)) {
    totalEndpoints += p.endpoints?.length || 0;
    totalBinaries += p.binaries?.length || 0;
  }

  const stats = document.createElement("div");
  stats.className = "nemoclaw-policy-stats";

  const statData: { value: number; label: string; scrollTo: string }[] = [
    { value: 3, label: "Immutable", scrollTo: "immutable" },
    { value: policyCount, label: "Net Rules", scrollTo: "network" },
    { value: totalEndpoints, label: "Endpoints", scrollTo: "network" },
    { value: totalBinaries, label: "Binaries", scrollTo: "network" },
  ];

  for (const s of statData) {
    const stat = document.createElement("button");
    stat.type = "button";
    stat.className = "nemoclaw-policy-stat";
    stat.innerHTML = `
      <span class="nemoclaw-policy-stat__value">${s.value}</span>
      <span class="nemoclaw-policy-stat__label">${s.label}</span>`;
    stat.addEventListener("click", () => {
      const target = document.querySelector<HTMLElement>(`[data-section="${s.scrollTo}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    stats.appendChild(stat);
  }

  el.appendChild(stats);

  const oneliner = document.createElement("div");
  oneliner.className = "nemoclaw-policy-oneliner";
  oneliner.innerHTML = `
    <span>Policies are kernel-enforced guardrails.</span>
    <span class="nemoclaw-policy-badge nemoclaw-policy-badge--locked">${ICON_LOCK} Immutable at runtime</span>
    <span class="nemoclaw-policy-badge nemoclaw-policy-badge--editable">${ICON_EDIT} Editable while running</span>`;

  el.appendChild(oneliner);
  return el;
}

// ---------------------------------------------------------------------------
// Immutable disclosure (replaces three separate cards)
// ---------------------------------------------------------------------------

function buildImmutableDisclosure(): HTMLElement {
  const section = document.createElement("div");
  section.className = "nemoclaw-policy-disclosure";
  section.dataset.section = "immutable";

  const fs = currentPolicy?.filesystem_policy;
  const ll = currentPolicy?.landlock;
  const proc = currentPolicy?.process;

  const roCount = fs?.read_only?.length || 0;
  const rwCount = fs?.read_write?.length || 0;
  const user = proc?.run_as_user || "not set";
  const compat = ll?.compatibility || "not set";

  const header = document.createElement("button");
  header.type = "button";
  header.className = "nemoclaw-policy-disclosure__header";
  header.innerHTML = `
    <span class="nemoclaw-policy-disclosure__chevron">${ICON_CHEVRON_RIGHT}</span>
    <span class="nemoclaw-policy-disclosure__icon">${ICON_LOCK}</span>
    <span class="nemoclaw-policy-disclosure__title">Immutable Configuration</span>
    <span class="nemoclaw-policy-badge nemoclaw-policy-badge--locked">Set at sandbox creation</span>`;

  const summary = document.createElement("div");
  summary.className = "nemoclaw-policy-disclosure__summary";
  summary.innerHTML = `
    <code>${escapeHtml(user)}</code> user &middot;
    <code>${roCount}</code> read-only paths &middot;
    <code>${rwCount}</code> read-write paths &middot;
    Landlock: <code>${escapeHtml(compat)}</code>`;

  const body = document.createElement("div");
  body.className = "nemoclaw-policy-disclosure__body";
  body.style.display = "none";

  const note = document.createElement("p");
  note.className = "nemoclaw-policy-disclosure__note";
  note.innerHTML = `To modify these, update <code>policy.yaml</code> and recreate the sandbox.`;
  body.appendChild(note);

  const tabs = document.createElement("div");
  tabs.className = "nemoclaw-policy-tabs";
  const tabDefs = [
    { id: "filesystem", label: "Filesystem" },
    { id: "landlock", label: "Landlock" },
    { id: "process", label: "Process Identity" },
  ];
  const panels: Record<string, HTMLElement> = {};

  for (const t of tabDefs) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "nemoclaw-policy-tab" + (t.id === "filesystem" ? " nemoclaw-policy-tab--active" : "");
    tab.textContent = t.label;
    tab.dataset.tab = t.id;
    tab.addEventListener("click", () => {
      tabs.querySelectorAll(".nemoclaw-policy-tab").forEach((el) => el.classList.remove("nemoclaw-policy-tab--active"));
      tab.classList.add("nemoclaw-policy-tab--active");
      for (const [id, panel] of Object.entries(panels)) {
        panel.style.display = id === t.id ? "" : "none";
      }
    });
    tabs.appendChild(tab);
  }
  body.appendChild(tabs);

  const fsPanel = document.createElement("div");
  fsPanel.className = "nemoclaw-policy-tab-panel";
  fsPanel.appendChild(buildFilesystemContent());
  panels["filesystem"] = fsPanel;
  body.appendChild(fsPanel);

  const llPanel = document.createElement("div");
  llPanel.className = "nemoclaw-policy-tab-panel";
  llPanel.style.display = "none";
  llPanel.appendChild(buildLandlockContent());
  panels["landlock"] = llPanel;
  body.appendChild(llPanel);

  const procPanel = document.createElement("div");
  procPanel.className = "nemoclaw-policy-tab-panel";
  procPanel.style.display = "none";
  procPanel.appendChild(buildProcessContent());
  panels["process"] = procPanel;
  body.appendChild(procPanel);

  let expanded = false;
  header.addEventListener("click", () => {
    expanded = !expanded;
    body.style.display = expanded ? "" : "none";
    summary.style.display = expanded ? "none" : "";
    section.classList.toggle("nemoclaw-policy-disclosure--expanded", expanded);
  });

  section.appendChild(header);
  section.appendChild(summary);
  section.appendChild(body);
  return section;
}

function buildFilesystemContent(): HTMLElement {
  const el = document.createElement("div");
  el.className = "nemoclaw-policy-card__content";
  const fs = currentPolicy?.filesystem_policy;
  if (!fs) {
    el.innerHTML = `<span class="nemoclaw-policy-muted">No filesystem policy defined</span>`;
    return el;
  }

  let html = "";
  if (fs.include_workdir !== undefined) {
    html += `<div class="nemoclaw-policy-prop"><span class="nemoclaw-policy-prop__label">Include workdir:</span> <span class="nemoclaw-policy-prop__value">${fs.include_workdir ? "Yes" : "No"}</span></div>`;
  }
  if (fs.read_only?.length) {
    html += `<div class="nemoclaw-policy-prop"><span class="nemoclaw-policy-prop__label">Read-only paths:</span></div>`;
    html += `<div class="nemoclaw-policy-pathlist">${fs.read_only.map((p) => `<code class="nemoclaw-policy-path">${escapeHtml(p)}</code>`).join("")}</div>`;
  }
  if (fs.read_write?.length) {
    html += `<div class="nemoclaw-policy-prop"><span class="nemoclaw-policy-prop__label">Read-write paths:</span></div>`;
    html += `<div class="nemoclaw-policy-pathlist">${fs.read_write.map((p) => `<code class="nemoclaw-policy-path nemoclaw-policy-path--rw">${escapeHtml(p)}</code>`).join("")}</div>`;
  }

  el.innerHTML = html;
  return el;
}

function buildLandlockContent(): HTMLElement {
  const el = document.createElement("div");
  el.className = "nemoclaw-policy-card__content";
  const ll = currentPolicy?.landlock;
  el.innerHTML = `<div class="nemoclaw-policy-prop">
    <span class="nemoclaw-policy-prop__label">Compatibility:</span>
    <span class="nemoclaw-policy-prop__value">${escapeHtml(ll?.compatibility || "not set")}</span>
  </div>`;
  return el;
}

function buildProcessContent(): HTMLElement {
  const el = document.createElement("div");
  el.className = "nemoclaw-policy-card__content";
  const p = currentPolicy?.process;
  el.innerHTML = `
    <div class="nemoclaw-policy-prop">
      <span class="nemoclaw-policy-prop__label">Run as user:</span>
      <span class="nemoclaw-policy-prop__value">${escapeHtml(p?.run_as_user || "not set")}</span>
    </div>
    <div class="nemoclaw-policy-prop">
      <span class="nemoclaw-policy-prop__label">Run as group:</span>
      <span class="nemoclaw-policy-prop__value">${escapeHtml(p?.run_as_group || "not set")}</span>
    </div>`;
  return el;
}

// ---------------------------------------------------------------------------
// Network policies (editable)
// ---------------------------------------------------------------------------

function buildNetworkPoliciesSection(): HTMLElement {
  const section = document.createElement("div");
  section.className = "nemoclaw-policy-section";
  section.dataset.section = "network";

  const policies = currentPolicy?.network_policies || {};
  const policyCount = Object.keys(policies).length;

  const headerRow = document.createElement("div");
  headerRow.className = "nemoclaw-policy-section__header";
  headerRow.innerHTML = `
    <span class="nemoclaw-policy-section__icon">${ICON_GLOBE}</span>
    <h3 class="nemoclaw-policy-section__title">Network Policies</h3>
    <span class="nemoclaw-policy-section__count">${policyCount}</span>
    <span class="nemoclaw-policy-badge nemoclaw-policy-badge--editable">${ICON_EDIT} Editable</span>`;

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "nemoclaw-policy-search";
  searchInput.placeholder = "Filter policies...";
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.toLowerCase().trim();
    section.querySelectorAll<HTMLElement>(".nemoclaw-policy-netcard").forEach((card) => {
      if (!q) {
        card.style.display = "";
        return;
      }
      const key = card.dataset.policyKey || "";
      const policy = currentPolicy?.network_policies?.[key];
      const hosts = (policy?.endpoints || []).map((ep) => ep.host || "").join(" ");
      const bins = (policy?.binaries || []).map((b) => b.path).join(" ");
      const haystack = `${key} ${policy?.name || ""} ${hosts} ${bins}`.toLowerCase();
      card.style.display = haystack.includes(q) ? "" : "none";
    });
  });
  headerRow.appendChild(searchInput);
  section.appendChild(headerRow);

  const desc = document.createElement("p");
  desc.className = "nemoclaw-policy-section__desc";
  desc.innerHTML = `Controls which external hosts your sandbox can connect to. Each rule binds <strong>endpoints</strong> to specific <strong>binaries</strong>.`;
  section.appendChild(desc);

  const list = document.createElement("div");
  list.className = "nemoclaw-policy-netpolicies";

  for (const [key, policy] of Object.entries(policies)) {
    list.appendChild(buildNetworkPolicyCard(key, policy, list));
  }

  section.appendChild(list);

  // Add policy button with template dropdown
  const addWrap = document.createElement("div");
  addWrap.className = "nemoclaw-policy-add-wrap";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "nemoclaw-policy-add-btn";
  addBtn.innerHTML = `${ICON_PLUS} <span>Add Network Policy</span> <span class="nemoclaw-policy-add-btn__chevron">${ICON_CHEVRON_DOWN}</span>`;

  let dropdownOpen = false;
  let dropdownEl: HTMLElement | null = null;

  function closeDropdown() {
    dropdownOpen = false;
    dropdownEl?.remove();
    dropdownEl = null;
  }

  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdownOpen) {
      closeDropdown();
      return;
    }
    dropdownOpen = true;
    dropdownEl = document.createElement("div");
    dropdownEl.className = "nemoclaw-policy-templates";

    for (const tmpl of POLICY_TEMPLATES) {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "nemoclaw-policy-template-option";
      opt.textContent = tmpl.label;
      opt.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeDropdown();
        showInlineNewPolicyForm(list, tmpl);
      });
      dropdownEl.appendChild(opt);
    }

    const customOpt = document.createElement("button");
    customOpt.type = "button";
    customOpt.className = "nemoclaw-policy-template-option nemoclaw-policy-template-option--custom";
    customOpt.textContent = "Custom (blank)";
    customOpt.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeDropdown();
      showInlineNewPolicyForm(list);
    });
    dropdownEl.appendChild(customOpt);

    addWrap.appendChild(dropdownEl);
  });

  document.addEventListener("click", () => { if (dropdownOpen) closeDropdown(); });

  addWrap.appendChild(addBtn);
  section.appendChild(addWrap);

  return section;
}

function buildNetworkPolicyCard(key: string, policy: NetworkPolicy, list: HTMLElement): HTMLElement {
  const card = document.createElement("div");
  card.className = "nemoclaw-policy-netcard";
  card.dataset.policyKey = key;

  const header = document.createElement("div");
  header.className = "nemoclaw-policy-netcard__header";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "nemoclaw-policy-netcard__toggle";
  toggle.innerHTML = `<span class="nemoclaw-policy-netcard__chevron">${ICON_CHEVRON_RIGHT}</span>
    <span class="nemoclaw-policy-netcard__name">${escapeHtml(policy.name || key)}</span>
    <span class="nemoclaw-policy-netcard__summary">${policy.endpoints?.length || 0} endpoint${(policy.endpoints?.length || 0) !== 1 ? "s" : ""}, ${policy.binaries?.length || 0} binar${(policy.binaries?.length || 0) !== 1 ? "ies" : "y"}</span>`;

  const actions = document.createElement("div");
  actions.className = "nemoclaw-policy-netcard__actions";

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "nemoclaw-policy-icon-btn nemoclaw-policy-icon-btn--danger";
  deleteBtn.title = "Delete policy";
  deleteBtn.innerHTML = ICON_TRASH;
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showDeleteConfirmation(actions, deleteBtn, key, card);
  });
  actions.appendChild(deleteBtn);

  header.appendChild(toggle);
  header.appendChild(actions);

  // Host preview chips (visible when collapsed)
  const preview = document.createElement("div");
  preview.className = "nemoclaw-policy-netcard__preview";
  const hosts = (policy.endpoints || []).map((ep) => ep.host).filter(Boolean) as string[];
  const maxChips = 3;
  for (let i = 0; i < Math.min(hosts.length, maxChips); i++) {
    const chip = document.createElement("code");
    chip.className = "nemoclaw-policy-host-chip";
    chip.textContent = hosts[i];
    preview.appendChild(chip);
  }
  if (hosts.length > maxChips) {
    const more = document.createElement("span");
    more.className = "nemoclaw-policy-host-chip nemoclaw-policy-host-chip--more";
    more.textContent = `+${hosts.length - maxChips} more`;
    preview.appendChild(more);
  }

  const body = document.createElement("div");
  body.className = "nemoclaw-policy-netcard__body";
  body.style.display = "none";
  renderNetworkPolicyBody(body, key, policy);

  let expanded = false;
  toggle.addEventListener("click", () => {
    expanded = !expanded;
    body.style.display = expanded ? "" : "none";
    card.classList.toggle("nemoclaw-policy-netcard--expanded", expanded);
  });

  card.appendChild(header);
  card.appendChild(preview);
  card.appendChild(body);
  return card;
}

// ---------------------------------------------------------------------------
// Delete confirmation
// ---------------------------------------------------------------------------

function showDeleteConfirmation(actions: HTMLElement, deleteBtn: HTMLElement, key: string, card: HTMLElement): void {
  deleteBtn.style.display = "none";

  const confirmWrap = document.createElement("div");
  confirmWrap.className = "nemoclaw-policy-confirm-actions";

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "nemoclaw-policy-confirm-btn nemoclaw-policy-confirm-btn--delete";
  confirmBtn.textContent = "Delete";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "nemoclaw-policy-confirm-btn nemoclaw-policy-confirm-btn--cancel";
  cancelBtn.textContent = "Cancel";

  confirmWrap.appendChild(confirmBtn);
  confirmWrap.appendChild(cancelBtn);
  actions.appendChild(confirmWrap);
  card.classList.add("nemoclaw-policy-netcard--confirming");

  const revert = () => {
    confirmWrap.remove();
    deleteBtn.style.display = "";
    card.classList.remove("nemoclaw-policy-netcard--confirming");
  };

  const timeout = setTimeout(revert, 3000);

  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    clearTimeout(timeout);
    revert();
  });

  confirmBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    clearTimeout(timeout);
    if (currentPolicy?.network_policies) {
      delete currentPolicy.network_policies[key];
      markDirty(key, "deleted");
      card.remove();
      updateNetworkCount();
    }
  });
}

// ---------------------------------------------------------------------------
// Inline new-policy form (replaces prompt/alert)
// ---------------------------------------------------------------------------

function showInlineNewPolicyForm(list: HTMLElement, template?: { key: string; label: string; policy: NetworkPolicy }): void {
  const existing = list.querySelector(".nemoclaw-policy-newcard");
  if (existing) existing.remove();

  const form = document.createElement("div");
  form.className = "nemoclaw-policy-newcard";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "nemoclaw-policy-input";
  input.placeholder = "e.g. my_custom_api";
  input.value = template ? template.key : "";

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

  const cancel = () => form.remove();

  cancelBtn.addEventListener("click", cancel);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cancel();
    if (e.key === "Enter") doCreate();
  });

  function doCreate() {
    const raw = input.value.trim();
    if (!raw) {
      error.textContent = "Name is required.";
      return;
    }
    const key = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!currentPolicy) return;
    if (!currentPolicy.network_policies) currentPolicy.network_policies = {};
    if (currentPolicy.network_policies[key]) {
      error.textContent = `A policy named "${key}" already exists.`;
      input.classList.add("nemoclaw-policy-input--error");
      return;
    }

    const newPolicy: NetworkPolicy = template
      ? JSON.parse(JSON.stringify(template.policy))
      : { name: key, endpoints: [{ host: "", port: 443 }], binaries: [{ path: "" }] };
    newPolicy.name = key;

    currentPolicy.network_policies[key] = newPolicy;
    markDirty(key, "added");

    form.remove();

    const card = buildNetworkPolicyCard(key, newPolicy, list);
    card.classList.add("nemoclaw-policy-netcard--expanded");
    const cardBody = card.querySelector<HTMLElement>(".nemoclaw-policy-netcard__body");
    if (cardBody) cardBody.style.display = "";
    const cardPreview = card.querySelector<HTMLElement>(".nemoclaw-policy-netcard__preview");
    if (cardPreview) cardPreview.style.display = "none";
    list.appendChild(card);
    updateNetworkCount();
  }

  createBtn.addEventListener("click", doCreate);
}

// ---------------------------------------------------------------------------
// Network policy body
// ---------------------------------------------------------------------------

function renderNetworkPolicyBody(body: HTMLElement, key: string, policy: NetworkPolicy): void {
  body.innerHTML = "";

  // Endpoints section
  const epSection = document.createElement("div");
  epSection.className = "nemoclaw-policy-subsection";
  epSection.innerHTML = `<div class="nemoclaw-policy-subsection__header">
    <span class="nemoclaw-policy-subsection__title">Endpoints</span>
    <span class="nemoclaw-policy-info-tip" title="Hosts this policy allows connections to">${ICON_INFO}</span>
  </div>`;

  const epList = document.createElement("div");
  epList.className = "nemoclaw-policy-ep-list";

  (policy.endpoints || []).forEach((ep, idx) => {
    epList.appendChild(buildEndpointRow(key, ep, idx));
  });
  epSection.appendChild(epList);

  const addEpBtn = document.createElement("button");
  addEpBtn.type = "button";
  addEpBtn.className = "nemoclaw-policy-add-small-btn";
  addEpBtn.innerHTML = `${ICON_PLUS} Add Endpoint`;
  addEpBtn.addEventListener("click", () => {
    const newEp: PolicyEndpoint = { host: "", port: 443 };
    policy.endpoints = policy.endpoints || [];
    policy.endpoints.push(newEp);
    markDirty(key, "modified");
    epList.appendChild(buildEndpointRow(key, newEp, policy.endpoints.length - 1));
  });
  epSection.appendChild(addEpBtn);
  body.appendChild(epSection);

  // Binaries section
  const binSection = document.createElement("div");
  binSection.className = "nemoclaw-policy-subsection";
  binSection.innerHTML = `<div class="nemoclaw-policy-subsection__header">
    <span class="nemoclaw-policy-subsection__title">Allowed Binaries</span>
    <span class="nemoclaw-policy-info-tip" title="Only these executables can use the endpoints above. Supports glob patterns like /** and *.">${ICON_INFO}</span>
  </div>`;

  const binList = document.createElement("div");
  binList.className = "nemoclaw-policy-bin-list";

  (policy.binaries || []).forEach((bin, idx) => {
    binList.appendChild(buildBinaryRow(key, policy, bin, idx));
  });
  binSection.appendChild(binList);

  const addBinBtn = document.createElement("button");
  addBinBtn.type = "button";
  addBinBtn.className = "nemoclaw-policy-add-small-btn";
  addBinBtn.innerHTML = `${ICON_PLUS} Add Binary`;
  addBinBtn.addEventListener("click", () => {
    const newBin: PolicyBinary = { path: "" };
    policy.binaries = policy.binaries || [];
    policy.binaries.push(newBin);
    markDirty(key, "modified");
    binList.appendChild(buildBinaryRow(key, policy, newBin, policy.binaries.length - 1));
  });
  binSection.appendChild(addBinBtn);
  body.appendChild(binSection);
}

// ---------------------------------------------------------------------------
// Endpoint row
// ---------------------------------------------------------------------------

function buildEndpointRow(policyKey: string, ep: PolicyEndpoint, idx: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "nemoclaw-policy-ep-row";

  const mainLine = document.createElement("div");
  mainLine.className = "nemoclaw-policy-ep-row__main";

  const hostInput = createInput("Host", ep.host || "", (v) => { ep.host = v || undefined; markDirty(policyKey, "modified"); }, "Domain or IP. Supports wildcards like *.example.com");
  hostInput.className += " nemoclaw-policy-input--host";

  const portInput = createInput("Port", String(ep.port || ""), (v) => { ep.port = parseInt(v, 10) || 0; markDirty(policyKey, "modified"); }, "TCP port (e.g. 443 for HTTPS)");
  portInput.className += " nemoclaw-policy-input--port";

  mainLine.appendChild(hostInput);
  mainLine.appendChild(portInput);

  const optsLine = document.createElement("div");
  optsLine.className = "nemoclaw-policy-ep-row__opts";

  const protoSelect = createSelect("Protocol", [
    { value: "", label: "(none)" },
    { value: "rest", label: "REST (L7 inspection)" },
  ], ep.protocol || "", (v) => { ep.protocol = v || undefined; markDirty(policyKey, "modified"); }, "REST enables HTTP method/path inspection");

  const tlsSelect = createSelect("TLS", [
    { value: "", label: "(none)" },
    { value: "terminate", label: "Terminate (inspect)" },
    { value: "passthrough", label: "Passthrough (encrypted)" },
  ], ep.tls || "", (v) => { ep.tls = v || undefined; markDirty(policyKey, "modified"); }, "Terminate: proxy decrypts for inspection. Passthrough: end-to-end encrypted");

  const enfSelect = createSelect("Enforcement", [
    { value: "", label: "(none)" },
    { value: "enforce", label: "Enforce (block)" },
    { value: "audit", label: "Audit (log only)" },
  ], ep.enforcement || "", (v) => { ep.enforcement = v || undefined; markDirty(policyKey, "modified"); }, "Enforce: block violations. Audit: log only");

  const accessSelect = createSelect("Access", [
    { value: "", label: "(none)" },
    { value: "read-only", label: "Read-only" },
    { value: "read-write", label: "Read-write" },
    { value: "full", label: "Full access" },
  ], ep.access || "", (v) => { ep.access = v || undefined; markDirty(policyKey, "modified"); }, "Scope of allowed operations on this endpoint");

  optsLine.appendChild(protoSelect);
  optsLine.appendChild(tlsSelect);
  optsLine.appendChild(enfSelect);
  optsLine.appendChild(accessSelect);

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "nemoclaw-policy-icon-btn nemoclaw-policy-icon-btn--danger nemoclaw-policy-ep-row__del";
  delBtn.title = "Remove endpoint";
  delBtn.innerHTML = ICON_TRASH;
  delBtn.addEventListener("click", () => {
    const policy = currentPolicy?.network_policies?.[policyKey];
    if (policy?.endpoints) {
      policy.endpoints.splice(idx, 1);
      markDirty(policyKey, "modified");
      row.remove();
    }
  });
  mainLine.appendChild(delBtn);

  row.appendChild(mainLine);
  row.appendChild(optsLine);

  // L7 Rules — editable rows
  if (ep.rules?.length || ep.protocol === "rest") {
    row.appendChild(buildL7RulesEditor(policyKey, ep));
  }

  // Allowed IPs — editable rows
  if (ep.allowed_ips?.length) {
    row.appendChild(buildAllowedIpsEditor(policyKey, ep));
  }

  return row;
}

// ---------------------------------------------------------------------------
// L7 Rules editor (replaces YAML preview)
// ---------------------------------------------------------------------------

function buildL7RulesEditor(policyKey: string, ep: PolicyEndpoint): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "nemoclaw-policy-ep-rules";

  const header = document.createElement("div");
  header.className = "nemoclaw-policy-subsection__header";
  header.innerHTML = `
    <span class="nemoclaw-policy-prop__label">L7 Rules (${ep.rules?.length || 0})</span>
    <span class="nemoclaw-policy-info-tip" title="HTTP method + path filters. Applied after TLS termination.">${ICON_INFO}</span>`;
  wrapper.appendChild(header);

  const ruleList = document.createElement("div");
  ruleList.className = "nemoclaw-policy-rule-list";

  (ep.rules || []).forEach((rule, idx) => {
    ruleList.appendChild(buildL7RuleRow(policyKey, ep, rule, idx, ruleList));
  });
  wrapper.appendChild(ruleList);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "nemoclaw-policy-add-small-btn";
  addBtn.innerHTML = `${ICON_PLUS} Add Rule`;
  addBtn.addEventListener("click", () => {
    if (!ep.rules) ep.rules = [];
    const newRule = { allow: { method: "GET", path: "" } };
    ep.rules.push(newRule);
    markDirty(policyKey, "modified");
    ruleList.appendChild(buildL7RuleRow(policyKey, ep, newRule, ep.rules.length - 1, ruleList));
  });
  wrapper.appendChild(addBtn);

  return wrapper;
}

function buildL7RuleRow(policyKey: string, ep: PolicyEndpoint, rule: { allow: { method: string; path: string } }, idx: number, ruleList: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "nemoclaw-policy-rule-row";

  const methodSelect = document.createElement("select");
  methodSelect.className = "nemoclaw-policy-select nemoclaw-policy-rule-method";
  for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "*"]) {
    const o = document.createElement("option");
    o.value = m;
    o.textContent = m;
    if (m === rule.allow.method) o.selected = true;
    methodSelect.appendChild(o);
  }
  methodSelect.addEventListener("change", () => { rule.allow.method = methodSelect.value; markDirty(policyKey, "modified"); });

  const pathInput = document.createElement("input");
  pathInput.type = "text";
  pathInput.className = "nemoclaw-policy-input nemoclaw-policy-rule-path";
  pathInput.placeholder = "/**/path";
  pathInput.value = rule.allow.path;
  pathInput.addEventListener("input", () => { rule.allow.path = pathInput.value; markDirty(policyKey, "modified"); });

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "nemoclaw-policy-icon-btn nemoclaw-policy-icon-btn--danger";
  delBtn.title = "Remove rule";
  delBtn.innerHTML = ICON_TRASH;
  delBtn.addEventListener("click", () => {
    if (ep.rules) {
      ep.rules.splice(idx, 1);
      markDirty(policyKey, "modified");
      row.remove();
    }
  });

  row.appendChild(methodSelect);
  row.appendChild(pathInput);
  row.appendChild(delBtn);
  return row;
}

// ---------------------------------------------------------------------------
// Allowed IPs editor
// ---------------------------------------------------------------------------

function buildAllowedIpsEditor(policyKey: string, ep: PolicyEndpoint): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "nemoclaw-policy-ep-rules";

  const header = document.createElement("div");
  header.className = "nemoclaw-policy-subsection__header";
  header.innerHTML = `
    <span class="nemoclaw-policy-prop__label">Allowed IPs</span>
    <span class="nemoclaw-policy-info-tip" title="Overrides default SSRF protection for private IP ranges">${ICON_INFO}</span>`;
  wrapper.appendChild(header);

  const ipList = document.createElement("div");
  ipList.className = "nemoclaw-policy-bin-list";

  (ep.allowed_ips || []).forEach((ip, idx) => {
    ipList.appendChild(buildIpRow(policyKey, ep, ip, idx));
  });
  wrapper.appendChild(ipList);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "nemoclaw-policy-add-small-btn";
  addBtn.innerHTML = `${ICON_PLUS} Add IP`;
  addBtn.addEventListener("click", () => {
    if (!ep.allowed_ips) ep.allowed_ips = [];
    ep.allowed_ips.push("");
    markDirty(policyKey, "modified");
    ipList.appendChild(buildIpRow(policyKey, ep, "", ep.allowed_ips.length - 1));
  });
  wrapper.appendChild(addBtn);

  return wrapper;
}

function buildIpRow(policyKey: string, ep: PolicyEndpoint, ip: string, idx: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "nemoclaw-policy-ip-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "nemoclaw-policy-input";
  input.placeholder = "10.0.0.0/8";
  input.value = ip;
  input.addEventListener("input", () => {
    if (ep.allowed_ips) {
      ep.allowed_ips[idx] = input.value;
      markDirty(policyKey, "modified");
    }
  });

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "nemoclaw-policy-icon-btn nemoclaw-policy-icon-btn--danger";
  delBtn.title = "Remove IP";
  delBtn.innerHTML = ICON_TRASH;
  delBtn.addEventListener("click", () => {
    if (ep.allowed_ips) {
      ep.allowed_ips.splice(idx, 1);
      markDirty(policyKey, "modified");
      row.remove();
    }
  });

  row.appendChild(input);
  row.appendChild(delBtn);
  return row;
}

// ---------------------------------------------------------------------------
// Binary row
// ---------------------------------------------------------------------------

function buildBinaryRow(policyKey: string, policy: NetworkPolicy, bin: PolicyBinary, idx: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "nemoclaw-policy-bin-row";

  const icon = document.createElement("span");
  icon.className = "nemoclaw-policy-bin-row__icon";
  icon.innerHTML = ICON_TERMINAL;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "nemoclaw-policy-input";
  input.placeholder = "/usr/bin/example";
  input.value = bin.path;
  input.addEventListener("input", () => { bin.path = input.value; markDirty(policyKey, "modified"); });

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "nemoclaw-policy-icon-btn nemoclaw-policy-icon-btn--danger";
  delBtn.title = "Remove binary";
  delBtn.innerHTML = ICON_TRASH;
  delBtn.addEventListener("click", () => {
    policy.binaries.splice(idx, 1);
    markDirty(policyKey, "modified");
    row.remove();
  });

  row.appendChild(icon);
  row.appendChild(input);
  row.appendChild(delBtn);
  return row;
}

// ---------------------------------------------------------------------------
// Save bar (conditional visibility)
// ---------------------------------------------------------------------------

function buildSaveBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "nemoclaw-policy-savebar nemoclaw-policy-savebar--hidden";

  const info = document.createElement("div");
  info.className = "nemoclaw-policy-savebar__info";
  info.innerHTML = `
    <span class="nemoclaw-policy-savebar__info-icon">${ICON_INFO}</span>
    <span class="nemoclaw-policy-savebar__summary">Unsaved changes</span>`;

  const actions = document.createElement("div");
  actions.className = "nemoclaw-policy-savebar__actions";

  const feedback = document.createElement("div");
  feedback.className = "nemoclaw-policy-savebar__feedback";
  feedback.setAttribute("role", "status");

  const discardBtn = document.createElement("button");
  discardBtn.type = "button";
  discardBtn.className = "nemoclaw-policy-discard-btn";
  discardBtn.textContent = "Discard";
  discardBtn.addEventListener("click", () => handleDiscard(bar));

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "nemoclaw-policy-save-btn";
  saveBtn.textContent = "Save Policy";
  saveBtn.addEventListener("click", () => handleSave(saveBtn, feedback, bar));

  actions.appendChild(feedback);
  actions.appendChild(discardBtn);
  actions.appendChild(saveBtn);

  bar.appendChild(info);
  bar.appendChild(actions);
  return bar;
}

function updateSaveBarSummary(): void {
  if (!saveBarEl) return;
  const summaryEl = saveBarEl.querySelector<HTMLElement>(".nemoclaw-policy-savebar__summary");
  if (!summaryEl) return;

  const parts: string[] = [];
  if (changeTracker.modified.size > 0) parts.push(`${changeTracker.modified.size} modified`);
  if (changeTracker.added.size > 0) parts.push(`${changeTracker.added.size} added`);
  if (changeTracker.deleted.size > 0) parts.push(`${changeTracker.deleted.size} deleted`);

  summaryEl.textContent = parts.length > 0 ? `Unsaved: ${parts.join(", ")}` : "Unsaved changes";
}

function handleDiscard(bar: HTMLElement): void {
  if (!pageContainer) return;
  bar.classList.remove("nemoclaw-policy-savebar--visible");
  bar.classList.add("nemoclaw-policy-savebar--hidden");
  loadAndRender(pageContainer);
}

async function handleSave(btn: HTMLButtonElement, feedback: HTMLElement, bar: HTMLElement): Promise<void> {
  if (!currentPolicy) return;

  btn.disabled = true;
  feedback.className = "nemoclaw-policy-savebar__feedback nemoclaw-policy-savebar__feedback--saving";
  feedback.innerHTML = `<span class="nemoclaw-policy-savebar__spinner">${ICON_LOADER}</span> Saving&hellip;`;

  try {
    const yamlText = yaml.dump(currentPolicy, {
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    });

    await savePolicy(yamlText);

    rawYaml = yamlText;
    isDirty = false;
    changeTracker.modified.clear();
    changeTracker.added.clear();
    changeTracker.deleted.clear();

    feedback.className = "nemoclaw-policy-savebar__feedback nemoclaw-policy-savebar__feedback--success";
    feedback.innerHTML = `${ICON_CHECK} Policy saved`;
    setTimeout(() => {
      feedback.className = "nemoclaw-policy-savebar__feedback";
      feedback.textContent = "";
      bar.classList.remove("nemoclaw-policy-savebar--visible");
      bar.classList.add("nemoclaw-policy-savebar--hidden");
    }, 3000);
  } catch (err) {
    feedback.className = "nemoclaw-policy-savebar__feedback nemoclaw-policy-savebar__feedback--error";
    feedback.innerHTML = `${ICON_CLOSE} ${escapeHtml(String(err))}`;
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

function createInput(label: string, value: string, onChange: (v: string) => void, tooltip?: string): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "nemoclaw-policy-field";
  let labelHtml = `<span class="nemoclaw-policy-field__label">${label}`;
  if (tooltip) {
    labelHtml += ` <span class="nemoclaw-policy-info-tip" title="${escapeHtml(tooltip)}">${ICON_INFO}</span>`;
  }
  labelHtml += `</span>`;
  wrapper.innerHTML = labelHtml;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "nemoclaw-policy-input";
  input.value = value;
  input.placeholder = label;
  input.addEventListener("input", () => onChange(input.value));
  wrapper.appendChild(input);
  return wrapper;
}

function createSelect(label: string, options: SelectOption[], value: string, onChange: (v: string) => void, tooltip?: string): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "nemoclaw-policy-field";
  let labelHtml = `<span class="nemoclaw-policy-field__label">${label}`;
  if (tooltip) {
    labelHtml += ` <span class="nemoclaw-policy-info-tip" title="${escapeHtml(tooltip)}">${ICON_INFO}</span>`;
  }
  labelHtml += `</span>`;
  wrapper.innerHTML = labelHtml;
  const select = document.createElement("select");
  select.className = "nemoclaw-policy-select";
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === value) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener("change", () => onChange(select.value));
  wrapper.appendChild(select);
  return wrapper;
}

function markDirty(policyKey?: string, changeType?: "modified" | "added" | "deleted"): void {
  isDirty = true;
  if (policyKey && changeType) {
    if (changeType === "deleted") {
      changeTracker.added.delete(policyKey);
      changeTracker.modified.delete(policyKey);
      changeTracker.deleted.add(policyKey);
    } else if (changeType === "added") {
      changeTracker.added.add(policyKey);
    } else {
      if (!changeTracker.added.has(policyKey)) {
        changeTracker.modified.add(policyKey);
      }
    }
  }
  if (saveBarEl) {
    saveBarEl.classList.remove("nemoclaw-policy-savebar--hidden");
    saveBarEl.classList.add("nemoclaw-policy-savebar--visible");
    updateSaveBarSummary();
  }
}

function updateNetworkCount(): void {
  const countEl = document.querySelector<HTMLElement>(".nemoclaw-policy-section__count");
  if (countEl && currentPolicy?.network_policies) {
    countEl.textContent = String(Object.keys(currentPolicy.network_policies).length);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
