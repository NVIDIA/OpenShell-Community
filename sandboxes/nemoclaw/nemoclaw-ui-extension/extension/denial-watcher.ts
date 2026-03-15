/**
 * NeMoClaw DevX — Sandbox Denial Watcher
 *
 * Polls the policy-proxy for sandbox network denial events and injects
 * a single chat-style card above the compose area. The card lists blocked
 * connections (newest nearest to input), with compact rows and one CTA to
 * Sandbox Policy. A scrollable list keeps many denials visible without
 * flooding the chat.
 */

import { ICON_SHIELD, ICON_CLOSE } from "./icons.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DenialEvent {
  ts: number;
  host: string;
  port: number;
  binary: string;
  reason: string;
}

interface DenialsResponse {
  denials: DenialEvent[];
  latest_ts: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 3_000;

let lastTs = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let seenKeys = new Set<string>();
let activeDenials: DenialEvent[] = [];
let container: HTMLElement | null = null;
let running = false;

function denialKey(d: DenialEvent): string {
  return `${d.host}:${d.port}:${d.binary}`;
}

function binaryBasename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchDenials(sinceMs: number): Promise<DenialsResponse> {
  const res = await fetch(`/api/sandbox-denials?since=${sinceMs}`);
  if (!res.ok) return { denials: [], latest_ts: sinceMs };
  return res.json();
}

// ---------------------------------------------------------------------------
// Single card with compact rows (above compose)
// ---------------------------------------------------------------------------

function findChatCompose(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".chat-compose");
}

function getOrCreateContainer(): HTMLElement | null {
  const chatCompose = findChatCompose();
  if (!chatCompose?.parentElement) return null;

  if (container?.parentElement) return container;

  container = document.createElement("div");
  container.className = "nemoclaw-sandbox-denials";
  container.setAttribute("role", "status");
  chatCompose.parentElement.insertBefore(container, chatCompose);
  return container;
}

/** Order by ts ascending so newest is last (nearest to input). */
function sortedDenials(): DenialEvent[] {
  return [...activeDenials].sort((a, b) => a.ts - b.ts);
}

function createRow(denial: DenialEvent): HTMLElement {
  const bin = binaryBasename(denial.binary);
  const portSuffix = denial.port === 443 || denial.port === 80 ? "" : `:${denial.port}`;
  const row = document.createElement("div");
  row.className = "nemoclaw-sandbox-denial-row";
  row.setAttribute("data-denial-key", denialKey(denial));
  row.innerHTML = `
    <span class="nemoclaw-sandbox-denial-row__text">Request blocked: <code>${escapeHtml(bin)}</code> → <code>${escapeHtml(denial.host)}${escapeHtml(portSuffix)}</code></span>
    <button type="button" class="nemoclaw-sandbox-denial-row__dismiss" title="Dismiss">${ICON_CLOSE}</button>`;
  const dismissBtn = row.querySelector<HTMLButtonElement>(".nemoclaw-sandbox-denial-row__dismiss");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dismissRow(row);
    });
  }
  return row;
}

function dismissRow(row: HTMLElement): void {
  const key = row.getAttribute("data-denial-key");
  if (key) {
    seenKeys.delete(key);
    activeDenials = activeDenials.filter((d) => denialKey(d) !== key);
  }
  renderDenialMessages();
}

function renderDenialMessages(): void {
  const parent = getOrCreateContainer();
  if (!parent) return;

  if (activeDenials.length === 0) {
    if (container?.parentElement) {
      container.remove();
      container = null;
    }
    return;
  }

  const n = activeDenials.length;
  const label = n === 1 ? "1 blocked request" : `${n} blocked requests`;

  parent.innerHTML = "";
  parent.className = "nemoclaw-sandbox-denials";

  const card = document.createElement("div");
  card.className = "nemoclaw-sandbox-denial-card";
  card.innerHTML = `
    <div class="nemoclaw-sandbox-denial-card__header">
      <span class="nemoclaw-sandbox-denial-card__icon">${ICON_SHIELD}</span>
      <span class="nemoclaw-sandbox-denial-card__label">OpenShell Sandbox — ${escapeHtml(label)}</span>
    </div>
    <div class="nemoclaw-sandbox-denials__list" role="list">
    </div>
    <div class="nemoclaw-sandbox-denial-card__cta">
      Add allow rules in <a href="#" data-nemoclaw-goto="nemoclaw-policy">Sandbox Policy</a> to continue.
    </div>`;

  const list = card.querySelector<HTMLElement>(".nemoclaw-sandbox-denials__list")!;
  const ordered = sortedDenials();
  for (const denial of ordered) {
    list.appendChild(createRow(denial));
  }

  parent.appendChild(card);
}

function injectDenialAsMessage(denial: DenialEvent): void {
  const key = denialKey(denial);
  if (seenKeys.has(key)) return;
  seenKeys.add(key);
  activeDenials.push(denial);
  renderDenialMessages();
}

/**
 * Clear denial UI and state.
 * @param keepSeenKeys - If true, do not clear seenKeys so the same denials
 * won't be re-shown on next poll (use when policy was just saved/approved).
 */
function clearAllDenialMessages(keepSeenKeys = false): void {
  if (!keepSeenKeys) seenKeys.clear();
  activeDenials = [];
  if (container?.parentElement) {
    container.remove();
    container = null;
  }
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

async function poll(): Promise<void> {
  try {
    const data = await fetchDenials(lastTs);
    if (data.latest_ts > lastTs) lastTs = data.latest_ts;

    for (const denial of data.denials) {
      injectDenialAsMessage(denial);
    }
  } catch {
    // Non-fatal — will retry on next poll
  }

  if (running) {
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// Policy-saved event handler
// ---------------------------------------------------------------------------

function onPolicySaved(): void {
  clearAllDenialMessages(true);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startDenialWatcher(): void {
  if (running) return;
  running = true;

  lastTs = Date.now() - 60_000;

  document.addEventListener("nemoclaw:policy-saved", onPolicySaved);

  poll();
}

export function stopDenialWatcher(): void {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  document.removeEventListener("nemoclaw:policy-saved", onPolicySaved);
  clearAllDenialMessages();
}
