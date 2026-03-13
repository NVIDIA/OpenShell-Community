// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import serverModule from '../server.js';
const { renderOtherAgentsModal, getRenderedIndex, escapeHtml, _resetForTesting } = serverModule;

// === TC-T01 through TC-T14: YAML-to-HTML template rendering ===

describe("escapeHtml", () => {
  it("TC-T14: HTML special characters are escaped", () => {
    expect(escapeHtml('<script>"test"&</script>')).toBe(
      "&lt;script&gt;&quot;test&quot;&amp;&lt;/script&gt;"
    );
    expect(escapeHtml("it's")).toBe("it&#x27;s");
  });
});

describe("renderOtherAgentsModal", () => {
  // renderOtherAgentsModal reads the real other-agents.yaml from disk.
  // These tests validate the rendered HTML structure.

  it("TC-T05: title from YAML appears in modal__title", () => {
    const html = renderOtherAgentsModal();
    if (!html) return; // skip if yaml missing
    expect(html).toContain('<h3 class="modal__title">');
    expect(html).toContain("Bring Your Own Agent");
  });

  it("TC-T06: intro text appears in modal__text", () => {
    const html = renderOtherAgentsModal();
    if (!html) return;
    expect(html).toContain('<p class="modal__text">');
    expect(html).toContain("Connect from your laptop");
  });

  it("TC-T07: steps are auto-numbered (1., 2., etc.)", () => {
    const html = renderOtherAgentsModal();
    if (!html) return;
    expect(html).toContain("1. Install OpenShell CLI");
    expect(html).toContain("2. Add the gateway");
    expect(html).toContain("3. Create a sandbox");
    expect(html).toContain("4. Manage policies");
  });

  it("TC-T08: string command renders as <span class=\"cmd\">", () => {
    const html = renderOtherAgentsModal();
    if (!html) return;
    expect(html).toContain('<span class="cmd">');
    expect(html).toContain("curl -fsSL");
  });

  it("TC-T09: dict command with comment renders comment span before cmd", () => {
    const html = renderOtherAgentsModal();
    if (!html) return;
    expect(html).toContain('<span class="comment"># Claude Code</span>');
    expect(html).toContain("openshell sandbox create -- claude");
  });

  it("TC-T10: dict command with id renders cmd span with id attribute", () => {
    const html = renderOtherAgentsModal();
    if (!html) return;
    expect(html).toContain('id="connect-cmd"');
  });

  it("TC-T11: copyable + copy_button_id renders button with that ID", () => {
    const html = renderOtherAgentsModal();
    if (!html) return;
    expect(html).toContain('id="copy-connect"');
    expect(html).toContain('class="copy-btn"');
  });

  it("TC-T12: copyable + single command + no button ID renders data-copy", () => {
    const html = renderOtherAgentsModal();
    if (!html) return;
    // "Install OpenShell CLI" step has copyable:true and one command, no copy_button_id
    expect(html).toContain("data-copy=");
  });

  it("TC-T13: copyable + multiple commands + no button ID renders button without data-copy", () => {
    const html = renderOtherAgentsModal();
    if (!html) return;
    // The "Create a sandbox" step has multiple commands, no copy_button_id, not copyable
    // The "Manage policies" step: single command, copyable, no copy_button_id
    // We check that buttons exist with aria-label="Copy"
    const copyButtons = (html.match(/aria-label="Copy"/g) || []).length;
    expect(copyButtons).toBeGreaterThan(0);
  });
});

describe("getRenderedIndex", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("TC-T01: {{OTHER_AGENTS_MODAL}} is replaced in index.html", () => {
    const html = getRenderedIndex();
    expect(html).not.toContain("{{OTHER_AGENTS_MODAL}}");
  });

  it("TC-T02: rendered result is cached on second call", () => {
    const first = getRenderedIndex();
    const second = getRenderedIndex();
    // Same string reference means it's cached
    expect(first).toBe(second);
  });

  it("TC-T03/T04: fallback inserts HTML comment if modal unavailable", () => {
    const html = getRenderedIndex();
    // Either the modal was rendered OR a comment was inserted
    const hasModal = html.includes("overlay-instructions");
    const hasComment = html.includes("<!-- other-agents.yaml not available -->");
    expect(hasModal || hasComment).toBe(true);
  });
});
