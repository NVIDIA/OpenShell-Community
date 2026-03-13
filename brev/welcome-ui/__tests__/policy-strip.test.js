// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import setupModule from './setup.js';
const { FIXTURES } = setupModule;
import serverModule from '../server.js';
const { stripPolicyFields } = serverModule;

// === TC-PS01 through TC-PS08: Policy field stripping ===

describe("stripPolicyFields", () => {
  it("TC-PS01: strips inference top-level key", () => {
    const result = stripPolicyFields(FIXTURES.validPolicyYaml);
    expect(result).not.toMatch(/^inference:/m);
    expect(result).not.toContain("model: gpt-4");
  });

  it("TC-PS02: strips process key when specified as extra field", () => {
    const result = stripPolicyFields(FIXTURES.validPolicyYaml, ["process"]);
    expect(result).not.toMatch(/^process:/m);
    expect(result).not.toContain("run_as_user");
  });

  it("TC-PS03: preserves all other top-level keys", () => {
    const result = stripPolicyFields(FIXTURES.validPolicyYaml, ["process"]);
    expect(result).toContain("version:");
    expect(result).toContain("filesystem_policy:");
    expect(result).toContain("network_policies:");
  });

  it("TC-PS04: handles nested YAML under stripped keys (entire subtree removed)", () => {
    const yaml = [
      "version: 1",
      "inference:",
      "  model: gpt-4",
      "  nested:",
      "    deep: value",
      "other: kept",
    ].join("\n");
    const result = stripPolicyFields(yaml);
    expect(result).not.toContain("model:");
    expect(result).not.toContain("deep:");
    expect(result).toContain("other:");
  });

  it("TC-PS05: empty YAML input returns minimal output", () => {
    const result = stripPolicyFields("");
    expect(typeof result).toBe("string");
  });

  it("TC-PS06: YAML with only stripped fields returns minimal output", () => {
    const yaml = "inference:\n  model: gpt-4\n";
    const result = stripPolicyFields(yaml);
    expect(result).not.toContain("inference:");
    expect(result).not.toContain("model:");
  });

  it("TC-PS07: output is readable YAML format", () => {
    const result = stripPolicyFields(FIXTURES.validPolicyYaml, ["process"]);
    // Should not use inline flow style
    expect(result).not.toContain("{");
    expect(result).toContain("version:");
  });

  it("TC-PS08: strips correctly with indented sub-keys", () => {
    const yaml = [
      "version: 1",
      "process:",
      "  run_as_user: sandbox",
      "  run_as_group: sandbox",
      "filesystem_policy:",
      "  include_workdir: true",
    ].join("\n");
    const result = stripPolicyFields(yaml, ["process"]);
    expect(result).not.toContain("process:");
    expect(result).not.toContain("run_as_user");
    expect(result).toContain("filesystem_policy:");
    expect(result).toContain("include_workdir");
  });
});
