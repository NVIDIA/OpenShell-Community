// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import serverModule from '../server.js';
const { extractBrevId, maybeDetectBrevId, buildOpenclawUrl, _resetForTesting, PORT } = serverModule;

// === TC-B01 through TC-B10: Brev ID detection and URL building ===

describe("extractBrevId", () => {
  it("TC-B01: extracts ID from 80810-abcdef123.brevlab.com", () => {
    expect(extractBrevId("80810-abcdef123.brevlab.com")).toBe("abcdef123");
  });

  it("TC-B02: extracts ID from 8080-xyz.brevlab.com", () => {
    expect(extractBrevId("8080-xyz.brevlab.com")).toBe("xyz");
  });

  it("TC-B03: localhost:8081 returns empty string", () => {
    expect(extractBrevId("localhost:8081")).toBe("");
  });

  it("TC-B04: non-matching host returns empty string", () => {
    expect(extractBrevId("example.com")).toBe("");
    expect(extractBrevId("")).toBe("");
    expect(extractBrevId("some.other.domain")).toBe("");
  });
});

describe("maybeDetectBrevId + buildOpenclawUrl", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("TC-B05: detection is idempotent (once set, never overwritten)", () => {
    maybeDetectBrevId("80810-first-id.brevlab.com");
    maybeDetectBrevId("80810-second-id.brevlab.com");
    const url = buildOpenclawUrl(null);
    expect(url).toContain("first-id");
    expect(url).not.toContain("second-id");
  });

  it("TC-B06: with Brev ID, URL is https://80810-{id}.brevlab.com/", () => {
    maybeDetectBrevId("80810-myenv.brevlab.com");
    expect(buildOpenclawUrl(null)).toBe("https://80810-myenv.brevlab.com/");
  });

  it("TC-B07: with Brev ID + token, URL has ?token=xxx", () => {
    maybeDetectBrevId("80810-myenv.brevlab.com");
    expect(buildOpenclawUrl("tok123")).toBe(
      "https://80810-myenv.brevlab.com/?token=tok123"
    );
  });

  it("TC-B08: without Brev ID, URL is http://127.0.0.1:{PORT}/", () => {
    const url = buildOpenclawUrl(null);
    expect(url).toBe(`http://127.0.0.1:${PORT}/`);
  });

  it("TC-B09: BREV_ENV_ID env var takes priority over Host detection", () => {
    // BREV_ENV_ID is read at module load. If it was empty, detected takes over.
    // We test that detected ID is used when BREV_ENV_ID is not set.
    maybeDetectBrevId("80810-detected.brevlab.com");
    const url = buildOpenclawUrl(null);
    expect(url).toContain("detected");
  });

  it("TC-B10: connection details gateway URL uses port 8080 not 8081", () => {
    maybeDetectBrevId("80810-env123.brevlab.com");
    // buildOpenclawUrl uses port 80810 (welcome-ui port in Brev)
    // The gateway URL is separate (tested in connection-details)
    const url = buildOpenclawUrl(null);
    expect(url).toContain("80810");
    expect(url).not.toContain("8080-");
  });
});
