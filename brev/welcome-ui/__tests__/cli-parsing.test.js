// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import setupModule from './setup.js';
const { FIXTURES } = setupModule;
import serverModule from '../server.js';
const { stripAnsi, parseProviderDetail, parseClusterInference } = serverModule;

// === TC-CL01 through TC-CL12: CLI output parsing ===

describe("stripAnsi", () => {
  it("TC-CL01: strips green color code", () => {
    expect(stripAnsi("\x1b[32mhello\x1b[0m")).toBe("hello");
  });

  it("TC-CL02: strips reset code", () => {
    expect(stripAnsi("text\x1b[0m more")).toBe("text more");
  });

  it("TC-CL03: strips bold red code", () => {
    expect(stripAnsi("\x1b[1;31merror\x1b[0m")).toBe("error");
  });

  it("TC-CL04: passes through text without ANSI codes unchanged", () => {
    const plain = "No colors here at all.";
    expect(stripAnsi(plain)).toBe(plain);
  });
});

describe("parseProviderDetail", () => {
  it("TC-CL05: parses complete provider output", () => {
    const result = parseProviderDetail(FIXTURES.providerGetOutput);
    expect(result).toEqual({
      id: "abc-123",
      name: "nvidia-inference",
      type: "openai",
      credentialKeys: ["OPENAI_API_KEY"],
      configKeys: ["OPENAI_BASE_URL"],
    });
  });

  it("TC-CL06: <none> for credential keys maps to empty array", () => {
    const result = parseProviderDetail(FIXTURES.providerGetNone);
    expect(result.credentialKeys).toEqual([]);
  });

  it("TC-CL07: comma-separated config keys parsed into array", () => {
    const output = [
      "Name: multi",
      "Type: custom",
      "Config keys: KEY1, KEY2, KEY3",
    ].join("\n");
    const result = parseProviderDetail(output);
    expect(result.configKeys).toEqual(["KEY1", "KEY2", "KEY3"]);
  });

  it("TC-CL08: output missing Name line returns null", () => {
    const output = "Id: abc\nType: openai\n";
    expect(parseProviderDetail(output)).toBeNull();
  });

  it("TC-CL09: ANSI codes in output are stripped before parsing", () => {
    const result = parseProviderDetail(FIXTURES.providerGetAnsi);
    expect(result).not.toBeNull();
    expect(result.name).toBe("nvidia-inference");
    expect(result.type).toBe("openai");
  });
});

describe("parseClusterInference", () => {
  it("TC-CL10: parses Provider, Model, Version lines", () => {
    const result = parseClusterInference(FIXTURES.clusterInferenceOutput);
    expect(result).toEqual({
      providerName: "nvidia-inference",
      modelId: "meta/llama-3.1-70b-instruct",
      version: 2,
    });
  });

  it("TC-CL11: non-integer version defaults to 0", () => {
    const output = "Provider: test\nModel: m\nVersion: abc\n";
    const result = parseClusterInference(output);
    expect(result.version).toBe(0);
  });

  it("TC-CL12: missing Provider line returns null", () => {
    const output = "Model: m\nVersion: 1\n";
    expect(parseClusterInference(output)).toBeNull();
  });
});
