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
  ICON_CHECK,
  ICON_CHEVRON_RIGHT,
  ICON_CHEVRON_DOWN,
  ICON_LOADER,
  ICON_TERMINAL,
  ICON_CLOSE,
  ICON_SHIELD,
  ICON_FOLDER,
  ICON_USER,
  ICON_WARNING,
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

interface SavePolicyResult {
  ok: boolean;
  applied?: boolean;
  version?: number;
  policy_hash?: string;
  reason?: string;
}

async function savePolicy(yamlText: string): Promise<SavePolicyResult> {
  console.log("[policy-save] step 1/2: POST /api/policy →", yamlText.length, "bytes");
  const res = await fetch("/api/policy", {
    method: "POST",
    headers: { "Content-Type": "text/yaml" },
    body: yamlText,
  });
  const body = await res.json().catch(() => ({})) as SavePolicyResult;
  console.log("[policy-save] step 1/2: proxy responded", JSON.stringify(body));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || `Save failed: ${res.status}`);
  }
  return body;
}

async function syncPolicyViaHost(yamlText: string): Promise<SavePolicyResult> {
  console.log("[policy-save] step 2/2: POST /api/policy-sync →", yamlText.length, "bytes");
  const res = await fetch("/api/policy-sync", {
    method: "POST",
    headers: { "Content-Type": "text/yaml" },
    body: yamlText,
  });
  const body = await res.json().catch(() => ({})) as SavePolicyResult;
  console.log("[policy-save] step 2/2: host relay responded", JSON.stringify(body));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || `Host sync failed: ${res.status}`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Render entry point
// ---------------------------------------------------------------------------

export function renderPolicyPage(container: HTMLElement): void {
  container.innerHTML = `
    <section class="content-header">
      <div>
        <div class="page-title">Sandbox Policy</div>
        <div class="page-sub">Controls what code in your sandbox can access</div>
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
    const errStr = String(err);
    const is404 = errStr.includes("404");
    page.innerHTML = `
      <div class="nemoclaw-policy-error">
        <p>${is404 ? "Policy file not found. The sandbox may still be starting." : "Could not load the sandbox policy."}</p>
        <p class="nemoclaw-policy-error__detail">${escapeHtml(errStr)}</p>
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

  page.appendChild(buildTabLayout());

  saveBarEl = buildSaveBar();
  page.appendChild(saveBarEl);
}

// ---------------------------------------------------------------------------
// Tab layout (Editable default, Locked for inspection)
// ---------------------------------------------------------------------------

function buildTabLayout(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "nemoclaw-policy-tabs-wrapper";

  const policies = currentPolicy?.network_policies || {};
  const policyCount = Object.keys(policies).length;

  const tabbar = document.createElement("div");
  tabbar.className = "nemoclaw-policy-tabbar";

  const editableTab = document.createElement("button");
  editableTab.type = "button";
  editableTab.className = "nemoclaw-policy-tabbar__tab nemoclaw-policy-tabbar__tab--active";
  editableTab.innerHTML = `Editable <span class="nemoclaw-policy-tabbar__count">${policyCount}</span>`;

  const lockedTab = document.createElement("button");
  lockedTab.type = "button";
  lockedTab.className = "nemoclaw-policy-tabbar__tab";
  lockedTab.innerHTML = `${ICON_LOCK} Locked`;

  tabbar.appendChild(editableTab);
  tabbar.appendChild(lockedTab);
  wrapper.appendChild(tabbar);

  const editablePanel = document.createElement("div");
  editablePanel.className = "nemoclaw-policy-tab-panel";
  editablePanel.appendChild(buildNetworkPoliciesSection());

  const lockedPanel = document.createElement("div");
  lockedPanel.className = "nemoclaw-policy-tab-panel";
  lockedPanel.style.display = "none";
  lockedPanel.appendChild(buildImmutableGrid());

  wrapper.appendChild(editablePanel);
  wrapper.appendChild(lockedPanel);

  editableTab.addEventListener("click", () => {
    editableTab.classList.add("nemoclaw-policy-tabbar__tab--active");
    lockedTab.classList.remove("nemoclaw-policy-tabbar__tab--active");
    editablePanel.style.display = "";
    lockedPanel.style.display = "none";
  });

  lockedTab.addEventListener("click", () => {
    lockedTab.classList.add("nemoclaw-policy-tabbar__tab--active");
    editableTab.classList.remove("nemoclaw-policy-tabbar__tab--active");
    lockedPanel.style.display = "";
    editablePanel.style.display = "none";
  });

  return wrapper;
}

// ---------------------------------------------------------------------------
// Immutable grid (3 flat read-only cards)
// ---------------------------------------------------------------------------

function buildImmutableGrid(): HTMLElement {
  const section = document.createElement("div");
  section.className = "nemoclaw-policy-immutable-section";
  section.dataset.section = "immutable";

  const intro = document.createElement("p");
  intro.className = "nemoclaw-policy-immutable-intro";
  intro.textContent = "These policies are set when the sandbox is created and cannot be changed at runtime. They define the security boundary that all code inside the sandbox must operate within.";
  section.appendChild(intro);

  const grid = document.createElement("div");
  grid.className = "nemoclaw-policy-immutable-grid";

  grid.appendChild(buildFilesystemCard());
  grid.appendChild(buildProcessCard());
  grid.appendChild(buildKernelCard());

  section.appendChild(grid);

  const footer = document.createElement("p");
  footer.className = "nemoclaw-policy-immutable-footer";
  footer.innerHTML = `To modify these settings, update <code>policy.yaml</code> and recreate the sandbox.`;
  section.appendChild(footer);

  return section;
}

function buildFilesystemCard(): HTMLElement {
  const card = document.createElement("div");
  card.className = "nemoclaw-policy-imm-card";

  const fs = currentPolicy?.filesystem_policy;

  card.innerHTML = `
    <div class="nemoclaw-policy-imm-card__header">
      <span class="nemoclaw-policy-imm-card__icon">${ICON_FOLDER}</span>
      <span class="nemoclaw-policy-imm-card__title">Filesystem Access</span>
      <span class="nemoclaw-policy-imm-card__lock">${ICON_LOCK}</span>
    </div>
    <div class="nemoclaw-policy-imm-card__desc">Paths the sandbox can read or write</div>`;

  const content = document.createElement("div");
  content.className = "nemoclaw-policy-imm-card__content";

  if (!fs) {
    content.innerHTML = `<span class="nemoclaw-policy-muted">No filesystem policy defined</span>`;
  } else {
    let html = "";
    if (fs.read_only?.length) {
      html += `<div class="nemoclaw-policy-prop"><span class="nemoclaw-policy-prop__label">Read-only</span></div>`;
      html += `<div class="nemoclaw-policy-pathlist">${fs.read_only.map((p) => `<code class="nemoclaw-policy-path">${escapeHtml(p)}</code>`).join("")}</div>`;
    }
    if (fs.read_write?.length) {
      html += `<div class="nemoclaw-policy-prop"><span class="nemoclaw-policy-prop__label">Read-write</span></div>`;
      html += `<div class="nemoclaw-policy-pathlist">${fs.read_write.map((p) => `<code class="nemoclaw-policy-path nemoclaw-policy-path--rw">${escapeHtml(p)}</code>`).join("")}</div>`;
    }
    if (fs.include_workdir) {
      html += `<div class="nemoclaw-policy-imm-card__note">Working directory included</div>`;
    }
    content.innerHTML = html;
  }

  card.appendChild(content);
  return card;
}

function buildProcessCard(): HTMLElement {
  const card = document.createElement("div");
  card.className = "nemoclaw-policy-imm-card";

  const p = currentPolicy?.process;
  const user = p?.run_as_user || "not set";
  const group = p?.run_as_group || "not set";

  card.innerHTML = `
    <div class="nemoclaw-policy-imm-card__header">
      <span class="nemoclaw-policy-imm-card__icon">${ICON_USER}</span>
      <span class="nemoclaw-policy-imm-card__title">Process Identity</span>
      <span class="nemoclaw-policy-imm-card__lock">${ICON_LOCK}</span>
    </div>
    <div class="nemoclaw-policy-imm-card__desc">All code runs as this OS user</div>`;

  const content = document.createElement("div");
  content.className = "nemoclaw-policy-imm-card__content";
  content.innerHTML = `
    <div class="nemoclaw-policy-prop">
      <span class="nemoclaw-policy-prop__label">User</span>
      <span class="nemoclaw-policy-prop__value" data-tip="The sandbox user has restricted privileges. It cannot escalate to root.">${escapeHtml(user)}</span>
    </div>
    <div class="nemoclaw-policy-prop">
      <span class="nemoclaw-policy-prop__label">Group</span>
      <span class="nemoclaw-policy-prop__value">${escapeHtml(group)}</span>
    </div>`;

  card.appendChild(content);
  return card;
}

function buildKernelCard(): HTMLElement {
  const card = document.createElement("div");
  card.className = "nemoclaw-policy-imm-card";

  const ll = currentPolicy?.landlock;
  const compat = ll?.compatibility || "not set";

  card.innerHTML = `
    <div class="nemoclaw-policy-imm-card__header">
      <span class="nemoclaw-policy-imm-card__icon">${ICON_SHIELD}</span>
      <span class="nemoclaw-policy-imm-card__title">Kernel Enforcement</span>
      <span class="nemoclaw-policy-imm-card__lock">${ICON_LOCK}</span>
    </div>
    <div class="nemoclaw-policy-imm-card__desc">Linux kernel restricts filesystem and network access</div>`;

  const content = document.createElement("div");
  content.className = "nemoclaw-policy-imm-card__content";
  content.innerHTML = `
    <div class="nemoclaw-policy-prop">
      <span class="nemoclaw-policy-prop__label">Mode</span>
      <span class="nemoclaw-policy-prop__value" data-tip="Falls back gracefully on older kernels. Strictest available enforcement is always used.">${escapeHtml(compat)}</span>
    </div>`;

  card.appendChild(content);
  return card;
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
    <h3 class="nemoclaw-policy-section__title">Allowed Network Policies</h3>
    <span class="nemoclaw-policy-section__count">${policyCount}</span>`;

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
  desc.textContent = "Each rule controls which binaries can reach which hosts. All outbound access is denied by default \u2014 add permissions below to allow specific connections.";
  section.appendChild(desc);

  const list = document.createElement("div");
  list.className = "nemoclaw-policy-netpolicies";

  if (policyCount === 0) {
    list.appendChild(buildNetworkEmptyState());
  } else {
    for (const [key, policy] of Object.entries(policies)) {
      list.appendChild(buildNetworkPolicyCard(key, policy, list));
    }
  }

  section.appendChild(list);

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

    // Blank option at the top
    const blankOpt = document.createElement("button");
    blankOpt.type = "button";
    blankOpt.className = "nemoclaw-policy-template-option nemoclaw-policy-template-option--blank";
    blankOpt.innerHTML = `<span class="nemoclaw-policy-template-option__label">Blank</span>
      <span class="nemoclaw-policy-template-option__meta">Start from scratch</span>`;
    blankOpt.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeDropdown();
      showInlineNewPolicyForm(list);
    });
    dropdownEl.appendChild(blankOpt);

    for (const tmpl of POLICY_TEMPLATES) {
      const hosts = tmpl.policy.endpoints.map((ep) => ep.host).filter(Boolean).slice(0, 2).join(", ");
      const bins = tmpl.policy.binaries.map((b) => b.path.split("/").pop()).join(", ");

      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "nemoclaw-policy-template-option";
      opt.innerHTML = `<span class="nemoclaw-policy-template-option__label">${escapeHtml(tmpl.label)}</span>
        <span class="nemoclaw-policy-template-option__meta">${escapeHtml(hosts)} &mdash; ${escapeHtml(bins)}</span>`;
      opt.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeDropdown();
        showInlineNewPolicyForm(list, tmpl);
      });
      dropdownEl.appendChild(opt);
    }

    addWrap.appendChild(dropdownEl);
  });

  document.addEventListener("click", () => { if (dropdownOpen) closeDropdown(); });

  addWrap.appendChild(addBtn);
  section.appendChild(addWrap);

  return section;
}

// ---------------------------------------------------------------------------
// Network empty state
// ---------------------------------------------------------------------------

function buildNetworkEmptyState(): HTMLElement {
  const el = document.createElement("div");
  el.className = "nemoclaw-policy-net-empty";
  el.innerHTML = `
    <span class="nemoclaw-policy-net-empty__icon">${ICON_GLOBE}</span>
    <span class="nemoclaw-policy-net-empty__title">No network policies</span>
    <span class="nemoclaw-policy-net-empty__desc">Your sandbox cannot make outbound connections.</span>`;
  return el;
}

// ---------------------------------------------------------------------------
// Network policy card
// ---------------------------------------------------------------------------

function hasEnforcement(policy: NetworkPolicy): boolean {
  return (policy.endpoints || []).some((ep) => ep.enforcement === "enforce");
}

function hasAudit(policy: NetworkPolicy): boolean {
  return (policy.endpoints || []).some((ep) => ep.enforcement === "audit");
}

function generatePolicyTooltip(policy: NetworkPolicy): string {
  const bins = (policy.binaries || []).map((b) => b.path.split("/").pop()).filter(Boolean);
  const hosts = (policy.endpoints || []).map((ep) => ep.host).filter(Boolean) as string[];
  if (!bins.length && !hosts.length) return "";

  const binStr = bins.length <= 2 ? bins.join(" and ") : `${bins[0]} and ${bins.length - 1} others`;
  const hostStr = hosts.length <= 2 ? hosts.join(" and ") : `${hosts[0]} and ${hosts.length - 1} other hosts`;

  if (bins.length && hosts.length) return `Allows ${binStr} to reach ${hostStr}`;
  if (hosts.length) return `Allows connections to ${hostStr}`;
  return "";
}

function buildNetworkPolicyCard(key: string, policy: NetworkPolicy, list: HTMLElement): HTMLElement {
  const card = document.createElement("div");
  card.className = "nemoclaw-policy-netcard";
  card.dataset.policyKey = key;

  const header = document.createElement("div");
  header.className = "nemoclaw-policy-netcard__header";

  const enforcing = hasEnforcement(policy);
  const auditing = hasAudit(policy);
  const enfIndicator = enforcing
    ? `<span class="nemoclaw-policy-enf-pill nemoclaw-policy-enf-pill--enforce">L7 Enforced</span>`
    : auditing
      ? `<span class="nemoclaw-policy-enf-pill nemoclaw-policy-enf-pill--audit">L7 Audit</span>`
      : `<span class="nemoclaw-policy-enf-pill nemoclaw-policy-enf-pill--default">L4 Default</span>`;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "nemoclaw-policy-netcard__toggle";
  toggle.innerHTML = `<span class="nemoclaw-policy-netcard__chevron">${ICON_CHEVRON_RIGHT}</span>
    <span class="nemoclaw-policy-netcard__name">${escapeHtml(policy.name || key)}</span>
    ${enfIndicator}
    <span class="nemoclaw-policy-netcard__summary">${policy.endpoints?.length || 0} endpoint${(policy.endpoints?.length || 0) !== 1 ? "s" : ""}, ${policy.binaries?.length || 0} ${(policy.binaries?.length || 0) !== 1 ? "binaries" : "binary"}</span>`;

  const tooltip = generatePolicyTooltip(policy);
  if (tooltip) toggle.title = tooltip;

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

  const timeout = setTimeout(revert, 5000);

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
      if (Object.keys(currentPolicy.network_policies).length === 0) {
        const list = document.querySelector<HTMLElement>(".nemoclaw-policy-netpolicies");
        if (list) list.appendChild(buildNetworkEmptyState());
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Inline new-policy form
// ---------------------------------------------------------------------------

function showInlineNewPolicyForm(list: HTMLElement, template?: { key: string; label: string; policy: NetworkPolicy }): void {
  const existing = list.querySelector(".nemoclaw-policy-newcard");
  if (existing) existing.remove();
  const emptyState = list.querySelector(".nemoclaw-policy-net-empty");
  if (emptyState) emptyState.remove();

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

  const cancel = () => {
    form.remove();
    if (currentPolicy && Object.keys(currentPolicy.network_policies || {}).length === 0) {
      list.appendChild(buildNetworkEmptyState());
    }
  };

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

  const epSection = document.createElement("div");
  epSection.className = "nemoclaw-policy-subsection";
  epSection.innerHTML = `<div class="nemoclaw-policy-subsection__header">
    <span class="nemoclaw-policy-subsection__title">Allowed Endpoints</span>
    <span class="nemoclaw-policy-info-tip" data-tip="Hosts and ports this policy allows outbound connections to.">${ICON_INFO}</span>
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

  const binSection = document.createElement("div");
  binSection.className = "nemoclaw-policy-subsection";
  binSection.innerHTML = `<div class="nemoclaw-policy-subsection__header">
    <span class="nemoclaw-policy-subsection__title">Allowed Binaries</span>
    <span class="nemoclaw-policy-info-tip" data-tip="Executables permitted to use endpoints in this policy. Supports glob patterns like /** for wildcards.">${ICON_INFO}</span>
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
  body.appendChild(epSection);
}

// ---------------------------------------------------------------------------
// Endpoint row (progressive: Host+Port primary, advanced toggle)
// ---------------------------------------------------------------------------

function hasAdvancedFields(ep: PolicyEndpoint): boolean {
  return !!(ep.protocol || ep.tls || ep.enforcement || ep.access);
}

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

  // Advanced options (progressive disclosure)
  const advancedExpanded = hasAdvancedFields(ep);

  const advToggle = document.createElement("button");
  advToggle.type = "button";
  advToggle.className = "nemoclaw-policy-ep-advanced-toggle";
  advToggle.innerHTML = `<span class="nemoclaw-policy-ep-advanced-toggle__chevron">${ICON_CHEVRON_RIGHT}</span> Advanced Settings <span class="nemoclaw-policy-info-tip" data-tip="L7 settings: protocol inspection, TLS handling, enforcement mode, and access scope.">${ICON_INFO}</span>`;
  if (advancedExpanded) advToggle.classList.add("nemoclaw-policy-ep-advanced-toggle--open");

  const optsLine = document.createElement("div");
  optsLine.className = "nemoclaw-policy-ep-row__opts";
  optsLine.style.display = advancedExpanded ? "" : "none";

  const protoSelect = createSelect("Protocol", [
    { value: "", label: "(none)" },
    { value: "rest", label: "REST (HTTP inspection)" },
  ], ep.protocol || "", (v) => {
    ep.protocol = v || undefined;
    markDirty(policyKey, "modified");
    if (v === "rest") {
      let rulesEl = row.querySelector<HTMLElement>(".nemoclaw-policy-ep-rules");
      if (!rulesEl) {
        const sibling = row.querySelector(".nemoclaw-policy-ep-ips") || null;
        const newRulesEl = buildHttpRulesEditor(policyKey, ep);
        if (sibling) row.insertBefore(newRulesEl, sibling);
        else row.appendChild(newRulesEl);
      }
    }
  }, "REST enables HTTP method/path inspection");

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

  advToggle.addEventListener("click", () => {
    const isOpen = optsLine.style.display !== "none";
    optsLine.style.display = isOpen ? "none" : "";
    advToggle.classList.toggle("nemoclaw-policy-ep-advanced-toggle--open", !isOpen);
  });

  row.appendChild(advToggle);
  row.appendChild(optsLine);

  if (ep.rules?.length || ep.protocol === "rest") {
    row.appendChild(buildHttpRulesEditor(policyKey, ep));
  }

  if (ep.allowed_ips?.length) {
    row.appendChild(buildAllowedIpsEditor(policyKey, ep));
  }

  return row;
}

// ---------------------------------------------------------------------------
// HTTP Rules editor (renamed from L7)
// ---------------------------------------------------------------------------

function buildHttpRulesEditor(policyKey: string, ep: PolicyEndpoint): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "nemoclaw-policy-ep-rules";

  const header = document.createElement("div");
  header.className = "nemoclaw-policy-subsection__header";
  header.innerHTML = `
    <span class="nemoclaw-policy-prop__label">HTTP Rules (${ep.rules?.length || 0})</span>
    <span class="nemoclaw-policy-info-tip" data-tip="HTTP method and path filters applied after TLS termination. Only matching requests pass through.">${ICON_INFO}</span>`;
  wrapper.appendChild(header);

  const microLabel = document.createElement("div");
  microLabel.className = "nemoclaw-policy-micro-label";
  microLabel.textContent = "Only matching HTTP requests are allowed";
  wrapper.appendChild(microLabel);

  const ruleList = document.createElement("div");
  ruleList.className = "nemoclaw-policy-rule-list";

  (ep.rules || []).forEach((rule, idx) => {
    ruleList.appendChild(buildHttpRuleRow(policyKey, ep, rule, idx, ruleList));
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
    ruleList.appendChild(buildHttpRuleRow(policyKey, ep, newRule, ep.rules.length - 1, ruleList));
  });
  wrapper.appendChild(addBtn);

  return wrapper;
}

function buildHttpRuleRow(policyKey: string, ep: PolicyEndpoint, rule: { allow: { method: string; path: string } }, idx: number, ruleList: HTMLElement): HTMLElement {
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
  pathInput.placeholder = "/**/info/refs*";
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
  wrapper.className = "nemoclaw-policy-ep-rules nemoclaw-policy-ep-ips";

  const header = document.createElement("div");
  header.className = "nemoclaw-policy-subsection__header";
  header.innerHTML = `
    <span class="nemoclaw-policy-prop__label">Allowed IPs</span>
    <span class="nemoclaw-policy-info-tip" data-tip="CIDR ranges that bypass default private IP (SSRF) protection.">${ICON_INFO}</span>`;
  wrapper.appendChild(header);

  const microLabel = document.createElement("div");
  microLabel.className = "nemoclaw-policy-micro-label";
  microLabel.textContent = "Bypasses private IP protection for these ranges";
  wrapper.appendChild(microLabel);

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

function isValidCidr(s: string): boolean {
  if (!s.trim()) return true;
  const match = s.match(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/);
  return !!match;
}

function buildIpRow(policyKey: string, ep: PolicyEndpoint, ip: string, idx: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "nemoclaw-policy-ip-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "nemoclaw-policy-input";
  input.placeholder = "10.0.0.0/8";
  input.value = ip;

  const errorEl = document.createElement("span");
  errorEl.className = "nemoclaw-policy-ip-error";

  input.addEventListener("input", () => {
    if (ep.allowed_ips) {
      ep.allowed_ips[idx] = input.value;
      markDirty(policyKey, "modified");
    }
    if (input.value.trim() && !isValidCidr(input.value.trim())) {
      errorEl.textContent = "Expected CIDR (e.g. 10.0.0.0/8)";
      input.classList.add("nemoclaw-policy-input--error");
    } else {
      errorEl.textContent = "";
      input.classList.remove("nemoclaw-policy-input--error");
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
  row.appendChild(errorEl);
  return row;
}

// ---------------------------------------------------------------------------
// Binary row (with wildcard warning)
// ---------------------------------------------------------------------------

function isWildcardBinary(path: string): boolean {
  return path === "/**" || path === "/*" || path === "*";
}

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

  const warningChip = document.createElement("span");
  warningChip.className = "nemoclaw-policy-wildcard-chip";
  warningChip.innerHTML = `${ICON_WARNING} All binaries`;
  warningChip.title = "This wildcard allows any binary to use these endpoints";
  warningChip.style.display = isWildcardBinary(bin.path) ? "" : "none";

  input.addEventListener("input", () => {
    bin.path = input.value;
    markDirty(policyKey, "modified");
    warningChip.style.display = isWildcardBinary(input.value) ? "" : "none";
  });

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
  row.appendChild(warningChip);
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
  info.innerHTML = `
    <div>
      <span class="nemoclaw-policy-savebar__summary">Unsaved changes</span>
      <span class="nemoclaw-policy-savebar__consequence">Network policies take effect on new connections.</span>
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

    console.log("[policy-save] ── Save Policy clicked");
    let result = await savePolicy(yamlText);

    rawYaml = yamlText;
    isDirty = false;
    changeTracker.modified.clear();
    changeTracker.added.clear();
    changeTracker.deleted.clear();

    // When the in-sandbox gRPC is blocked by network enforcement, relay
    // through the host-side welcome-ui server which can reach the gateway.
    if (result.applied === false) {
      console.log("[policy-save] proxy gRPC unavailable — falling back to host relay");
      feedback.innerHTML = `<span class="nemoclaw-policy-savebar__spinner">${ICON_LOADER}</span> Applying&hellip;`;
      try {
        const hostResult = await syncPolicyViaHost(yamlText);
        if (hostResult.ok && hostResult.applied) {
          console.log("[policy-save] host relay succeeded — policy applied live");
          result = hostResult;
        } else {
          console.warn("[policy-save] host relay returned applied=false", hostResult);
        }
      } catch (relayErr) {
        console.warn("[policy-save] host relay failed:", relayErr);
      }
    }

    feedback.className = "nemoclaw-policy-savebar__feedback nemoclaw-policy-savebar__feedback--success";
    if (result.applied && result.version) {
      console.log(`[policy-save] ── done: applied v${result.version}`);
      feedback.innerHTML = `${ICON_CHECK} Policy applied (v${result.version}). New connections will use updated rules.`;
    } else if (result.applied === false) {
      console.log("[policy-save] ── done: saved to disk only (live apply failed)");
      feedback.innerHTML = `${ICON_CHECK} Policy saved. To apply live, run: <code>nemoclaw policy set nemoclaw</code>`;
    } else {
      console.log("[policy-save] ── done: saved");
      feedback.innerHTML = `${ICON_CHECK} Saved. New connections will use updated rules.`;
    }
    setTimeout(() => {
      feedback.className = "nemoclaw-policy-savebar__feedback";
      feedback.textContent = "";
      bar.classList.remove("nemoclaw-policy-savebar--visible");
      bar.classList.add("nemoclaw-policy-savebar--hidden");
    }, 5000);
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

function createInput(label: string, value: string, onChange: (v: string) => void, _tooltip?: string): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "nemoclaw-policy-field";
  wrapper.innerHTML = `<span class="nemoclaw-policy-field__label">${label}</span>`;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "nemoclaw-policy-input";
  input.value = value;
  input.placeholder = label;
  input.addEventListener("input", () => onChange(input.value));
  wrapper.appendChild(input);
  return wrapper;
}

function createSelect(label: string, options: SelectOption[], value: string, onChange: (v: string) => void, _tooltip?: string): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "nemoclaw-policy-field";
  wrapper.innerHTML = `<span class="nemoclaw-policy-field__label">${label}</span>`;
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
  const tabCount = document.querySelector<HTMLElement>(".nemoclaw-policy-tabbar__count");
  if (tabCount && currentPolicy?.network_policies) {
    tabCount.textContent = String(Object.keys(currentPolicy.network_policies).length);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
