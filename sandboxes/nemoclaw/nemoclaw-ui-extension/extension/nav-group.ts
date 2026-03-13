/**
 * NeMoClaw DevX — Sidebar Nav Group
 *
 * Collapsible "NeMoClaw" nav group with Policy, Inference Routes, and
 * API Keys pages. Renders page overlays on top of <main.content>.
 */

import { ICON_SHIELD, ICON_ROUTE, ICON_KEY } from "./icons.ts";
import { renderApiKeysPage, areAllKeysConfigured, updateStatusDots } from "./api-keys-page.ts";
import { renderPolicyPage } from "./policy-page.ts";
import { renderInferencePage } from "./inference-page.ts";

// ---------------------------------------------------------------------------
// Page definitions
// ---------------------------------------------------------------------------

interface NemoClawPage {
  id: string;
  label: string;
  icon: string;
  title: string;
  subtitle: string;
  emptyMessage: string;
  customRender?: (container: HTMLElement) => void;
  showStatusDot?: boolean;
}

const NEMOCLAW_PAGES: NemoClawPage[] = [
  {
    id: "nemoclaw-policy",
    label: "Sandbox Policy",
    icon: ICON_SHIELD,
    title: "Sandbox Policy",
    subtitle: "View and manage sandbox security guardrails",
    emptyMessage: "",
    customRender: renderPolicyPage,
  },
  {
    id: "nemoclaw-inference-routes",
    label: "Inference Routes",
    icon: ICON_ROUTE,
    title: "Inference Routes",
    subtitle: "Configure model routing and endpoint mappings",
    emptyMessage: "",
    customRender: renderInferencePage,
  },
  {
    id: "nemoclaw-api-keys",
    label: "API Keys",
    icon: ICON_KEY,
    title: "API Keys",
    subtitle: "Configure your NVIDIA API keys for model endpoints",
    emptyMessage: "",
    customRender: renderApiKeysPage,
    showStatusDot: true,
  },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let navGroupEl: HTMLElement | null = null;
let activeNemoPage: string | null = null;
let pageOverlayEl: HTMLElement | null = null;
let navGroupCollapsed = false;

// ---------------------------------------------------------------------------
// Nav group injection
// ---------------------------------------------------------------------------

function buildNavGroup(): HTMLElement {
  const group = document.createElement("div");
  group.className = "nav-group nemoclaw-nav-group";
  group.dataset.nemoclawNav = "true";

  const label = document.createElement("button");
  label.className = "nav-label";
  label.setAttribute("aria-expanded", "true");
  label.innerHTML = `<span class="nav-label__text">NeMoClaw</span><span class="nav-label__chevron">−</span>`;
  label.addEventListener("click", () => {
    navGroupCollapsed = !navGroupCollapsed;
    applyNavGroupCollapsed(group);
  });

  const items = document.createElement("div");
  items.className = "nav-group__items";

  for (const page of NEMOCLAW_PAGES) {
    const item = document.createElement("a");
    item.href = "#";
    item.className = "nav-item";
    item.dataset.nemoclawPage = page.id;

    let dotHtml = "";
    if (page.showStatusDot) {
      const ok = areAllKeysConfigured();
      const dotClass = ok ? "nemoclaw-nav-dot--ok" : "nemoclaw-nav-dot--missing";
      dotHtml = `<span class="nemoclaw-nav-dot ${dotClass}"></span>`;
    }

    item.innerHTML =
      `<span class="nav-item__icon" aria-hidden="true">${page.icon}</span>` +
      `<span class="nav-item__text">${page.label}</span>` +
      dotHtml;

    item.addEventListener("click", (e) => {
      e.preventDefault();
      activateNemoPage(page.id);
    });
    items.appendChild(item);
  }

  group.appendChild(label);
  group.appendChild(items);
  return group;
}

function applyNavGroupCollapsed(group: HTMLElement) {
  const chevron = group.querySelector(".nav-label__chevron");
  const label = group.querySelector(".nav-label");
  if (navGroupCollapsed && !activeNemoPage) {
    group.classList.add("nav-group--collapsed");
    if (chevron) chevron.textContent = "+";
    label?.setAttribute("aria-expanded", "false");
  } else {
    group.classList.remove("nav-group--collapsed");
    if (chevron) chevron.textContent = "−";
    label?.setAttribute("aria-expanded", "true");
  }
}

export function injectNavGroup(): boolean {
  if (navGroupEl && document.contains(navGroupEl)) return true;

  const nav = document.querySelector("aside.nav");
  if (!nav) return false;

  const allGroups = nav.querySelectorAll(":scope > .nav-group");
  const group = buildNavGroup();

  if (allGroups.length >= 1) {
    allGroups[0].after(group);
  } else {
    nav.prepend(group);
  }

  navGroupEl = group;
  return true;
}

// ---------------------------------------------------------------------------
// Page activation / deactivation (exported so index.ts can call it)
// ---------------------------------------------------------------------------

export function activateNemoPage(pageId: string) {
  activeNemoPage = pageId;
  clearAllActiveNavItems();

  document.querySelectorAll<HTMLElement>("[data-nemoclaw-page]").forEach((el) => {
    el.classList.toggle("active", el.dataset.nemoclawPage === pageId);
  });

  if (navGroupEl) applyNavGroupCollapsed(navGroupEl);
  showPageOverlay(pageId);
}

function deactivateNemoPages() {
  activeNemoPage = null;
  document.querySelectorAll<HTMLElement>("[data-nemoclaw-page]").forEach((el) => {
    el.classList.remove("active");
  });
  hidePageOverlay();
}

function clearAllActiveNavItems() {
  document.querySelectorAll<HTMLElement>("aside.nav .nav-item.active").forEach((el) => {
    if (!el.dataset.nemoclawPage) {
      el.classList.remove("active");
    }
  });
}

// ---------------------------------------------------------------------------
// Page overlay (renders on top of .content)
// ---------------------------------------------------------------------------

function showPageOverlay(pageId: string) {
  const page = NEMOCLAW_PAGES.find((p) => p.id === pageId);
  if (!page) return;

  const content = document.querySelector("main.content");
  if (!content) return;

  hidePageOverlay();

  const overlay = document.createElement("div");
  overlay.className = "nemoclaw-page-overlay";
  overlay.dataset.nemoclawOverlay = "true";

  if (page.customRender) {
    page.customRender(overlay);
  } else {
    overlay.innerHTML = `
      <section class="content-header">
        <div>
          <div class="page-title">${page.title}</div>
          <div class="page-sub">${page.subtitle}</div>
        </div>
      </section>
      <div class="nemoclaw-empty-state">
        <div class="nemoclaw-empty-state__icon">${page.icon}</div>
        <div class="nemoclaw-empty-state__title">${page.label}</div>
        <p class="nemoclaw-empty-state__message">${page.emptyMessage}</p>
      </div>`;
  }

  content.appendChild(overlay);
  pageOverlayEl = overlay;
}

function hidePageOverlay() {
  if (pageOverlayEl) {
    pageOverlayEl.remove();
    pageOverlayEl = null;
  }
}

// ---------------------------------------------------------------------------
// Intercept OpenClaw's own nav clicks to deactivate NeMoClaw pages
// ---------------------------------------------------------------------------

export function watchOpenClawNavClicks() {
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target as HTMLElement;
      const navItem = target.closest<HTMLElement>("aside.nav .nav-item");
      if (!navItem) return;
      if (navItem.dataset.nemoclawPage) return;
      if (activeNemoPage) {
        deactivateNemoPages();
      }
    },
    true,
  );
}
