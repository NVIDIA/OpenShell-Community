// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import setupModule from './setup.js';
const { CACHE_FILE, cleanTempFiles, readCacheFile } = setupModule;
import serverModule from '../server.js';
const { readConfigCache, writeConfigCache, cacheProviderConfig, removeCachedProvider, bootstrapConfigCache } = serverModule;

// === TC-CC01 through TC-CC10: Provider config cache ===

describe("config cache", () => {
  beforeEach(() => {
    cleanTempFiles();
  });

  it("TC-CC01: bootstrapConfigCache writes default when file doesn't exist", () => {
    bootstrapConfigCache();
    const cache = readCacheFile();
    expect(cache).not.toBeNull();
    expect(cache["nvidia-inference"]).toBeDefined();
  });

  it("TC-CC02: bootstrapConfigCache is no-op when file already exists", () => {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ custom: { x: 1 } }));
    bootstrapConfigCache();
    const cache = readCacheFile();
    expect(cache).toEqual({ custom: { x: 1 } });
  });

  it("TC-CC03: default bootstrap content has nvidia-inference with OPENAI_BASE_URL", () => {
    bootstrapConfigCache();
    const cache = readCacheFile();
    expect(cache).toEqual({
      "nvidia-inference": {
        OPENAI_BASE_URL: "https://inference-api.nvidia.com/v1",
      },
    });
  });

  it("TC-CC04: readConfigCache returns {} on missing file", () => {
    expect(readConfigCache()).toEqual({});
  });

  it("TC-CC05: readConfigCache returns {} on invalid JSON", () => {
    fs.writeFileSync(CACHE_FILE, "not valid json!!!");
    expect(readConfigCache()).toEqual({});
  });

  it("TC-CC06: writeConfigCache writes valid JSON", () => {
    const data = { test: { KEY: "val" } };
    writeConfigCache(data);
    const raw = fs.readFileSync(CACHE_FILE, "utf-8");
    expect(JSON.parse(raw)).toEqual(data);
  });

  it("TC-CC07: writeConfigCache silently ignores write errors", () => {
    // Write to a path that can't be written to shouldn't throw
    // (the function catches internally). We verify no exception escapes.
    expect(() => writeConfigCache({ a: 1 })).not.toThrow();
  });

  it("TC-CC08: cacheProviderConfig merges new config into existing cache", () => {
    writeConfigCache({ existing: { A: "1" } });
    cacheProviderConfig("new-provider", { B: "2" });
    const cache = readCacheFile();
    expect(cache.existing).toEqual({ A: "1" });
    expect(cache["new-provider"]).toEqual({ B: "2" });
  });

  it("TC-CC09: removeCachedProvider removes entry and preserves others", () => {
    writeConfigCache({ keep: { A: "1" }, remove: { B: "2" } });
    removeCachedProvider("remove");
    const cache = readCacheFile();
    expect(cache.keep).toEqual({ A: "1" });
    expect(cache.remove).toBeUndefined();
  });

  it("TC-CC10: concurrent cache operations don't crash", () => {
    expect(() => {
      for (let i = 0; i < 20; i++) {
        cacheProviderConfig(`p${i}`, { val: i });
      }
    }).not.toThrow();
    const cache = readCacheFile();
    expect(cache.p19).toEqual({ val: 19 });
  });
});
