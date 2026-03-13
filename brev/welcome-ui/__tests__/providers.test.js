// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import supertest from 'supertest';

vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    cb(null, '', '');
  }),
  spawn: vi.fn(),
}));

import { execFile, spawn } from 'child_process';
import serverModule from '../server.js';
const {
  server,
  _resetForTesting,
  _setMocksForTesting,
  readConfigCache,
  writeConfigCache,
} = serverModule;
import setupModule from './setup.js';
const { cleanTempFiles, FIXTURES, writeCacheFile, readCacheFile } = setupModule;
const request = supertest;

// === TC-PR01 through TC-PR24: Provider CRUD ===

describe("GET /api/providers", () => {
  beforeEach(() => {
    _resetForTesting();
    _setMocksForTesting({ execFile, spawn });
    cleanTempFiles();
    execFile.mockClear();
  });

  afterAll(() => { server.close(); });

  it("TC-PR01: returns 200 with providers array", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      if (args?.[1] === "list") {
        return cb(null, "nvidia-inference\n", "");
      }
      if (args?.[1] === "get") {
        return cb(null, FIXTURES.providerGetOutput, "");
      }
      cb(null, "", "");
    });

    const res = await request(server).get("/api/providers");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.providers)).toBe(true);
    expect(res.body.providers.length).toBe(1);
    expect(res.body.providers[0].name).toBe("nvidia-inference");
  });

  it("TC-PR02: provider list CLI failure returns 502", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      const err = new Error("fail");
      err.code = 1;
      cb(err, "", "provider list failed");
    });

    const res = await request(server).get("/api/providers");
    expect(res.status).toBe(502);
  });

  it("TC-PR03: each provider fetched via nemoclaw provider get", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      if (args?.[1] === "list") {
        return cb(null, "p1\np2\n", "");
      }
      if (args?.[1] === "get") {
        const name = args[2];
        return cb(null, `Name: ${name}\nType: openai\n`, "");
      }
      cb(null, "", "");
    });

    const res = await request(server).get("/api/providers");
    expect(res.body.providers.length).toBe(2);
    expect(res.body.providers[0].name).toBe("p1");
    expect(res.body.providers[1].name).toBe("p2");
  });

  it("TC-PR04: provider with no config cache has no configValues", async () => {
    cleanTempFiles();
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      if (args?.[1] === "list") return cb(null, "test-prov\n", "");
      if (args?.[1] === "get") return cb(null, "Name: test-prov\nType: custom\n", "");
      cb(null, "", "");
    });

    const res = await request(server).get("/api/providers");
    expect(res.body.providers[0].configValues).toBeUndefined();
  });

  it("TC-PR05: provider with config cache has configValues merged", async () => {
    writeCacheFile({ "test-prov": { URL: "https://example.com" } });
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      if (args?.[1] === "list") return cb(null, "test-prov\n", "");
      if (args?.[1] === "get") return cb(null, "Name: test-prov\nType: custom\n", "");
      cb(null, "", "");
    });

    const res = await request(server).get("/api/providers");
    expect(res.body.providers[0].configValues).toEqual({ URL: "https://example.com" });
  });

  it("TC-PR06: provider whose get fails is silently skipped", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      if (args?.[1] === "list") return cb(null, "good\nbad\n", "");
      if (args?.[1] === "get") {
        if (args[2] === "bad") {
          const err = new Error("fail");
          err.code = 1;
          return cb(err, "", "not found");
        }
        return cb(null, "Name: good\nType: openai\n", "");
      }
      cb(null, "", "");
    });

    const res = await request(server).get("/api/providers");
    expect(res.body.providers.length).toBe(1);
    expect(res.body.providers[0].name).toBe("good");
  });

  it("TC-PR07: <none> for credential/config keys maps to empty array", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      if (args?.[1] === "list") return cb(null, "empty\n", "");
      if (args?.[1] === "get") return cb(null, FIXTURES.providerGetNone, "");
      cb(null, "", "");
    });

    const res = await request(server).get("/api/providers");
    expect(res.body.providers[0].credentialKeys).toEqual([]);
    expect(res.body.providers[0].configKeys).toEqual([]);
  });
});

describe("POST /api/providers", () => {
  beforeEach(() => {
    _resetForTesting();
    _setMocksForTesting({ execFile, spawn });
    cleanTempFiles();
    execFile.mockClear();
  });

  it("TC-PR08: returns 200 {ok:true} on success", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "created", "");
    });

    const res = await request(server)
      .post("/api/providers")
      .send({ name: "my-provider", type: "openai", credentials: { KEY: "val" } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("TC-PR09: returns 400 for empty/invalid JSON body", async () => {
    const res = await request(server)
      .post("/api/providers")
      .set("Content-Type", "application/json")
      .send("");
    expect(res.status).toBe(400);
  });

  it("TC-PR10: returns 400 when name missing", async () => {
    const res = await request(server)
      .post("/api/providers")
      .send({ type: "openai" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("name");
  });

  it("TC-PR11: returns 400 when type missing", async () => {
    const res = await request(server)
      .post("/api/providers")
      .send({ name: "test" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("type");
  });

  it("TC-PR12: no credentials → uses PLACEHOLDER=unused", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "", "");
    });

    await request(server)
      .post("/api/providers")
      .send({ name: "test", type: "openai" });

    const createCall = execFile.mock.calls.find(
      (c) => c[0] === "nemoclaw" && c[1]?.includes("create")
    );
    expect(createCall).toBeDefined();
    const args = createCall[1];
    expect(args).toContain("PLACEHOLDER=unused");
  });

  it("TC-PR13: multiple credentials and configs passed as repeated flags", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "", "");
    });

    await request(server)
      .post("/api/providers")
      .send({
        name: "test",
        type: "openai",
        credentials: { KEY1: "v1", KEY2: "v2" },
        config: { CFG1: "c1", CFG2: "c2" },
      });

    const createCall = execFile.mock.calls.find(
      (c) => c[0] === "nemoclaw" && c[1]?.includes("create")
    );
    const args = createCall[1];
    const credFlags = args.filter((a) => a.startsWith("KEY"));
    const cfgFlags = args.filter((a) => a.startsWith("CFG"));
    expect(credFlags.length).toBe(2);
    expect(cfgFlags.length).toBe(2);
  });

  it("TC-PR14: config values are cached on success", async () => {
    cleanTempFiles();
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "", "");
    });

    await request(server)
      .post("/api/providers")
      .send({ name: "cached-prov", type: "openai", config: { URL: "http://x" } });

    const cache = readCacheFile();
    expect(cache?.["cached-prov"]).toEqual({ URL: "http://x" });
  });

  it("TC-PR15: CLI failure returns 400 with error", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      const err = new Error("fail");
      err.code = 1;
      cb(err, "", "provider already exists");
    });

    const res = await request(server)
      .post("/api/providers")
      .send({ name: "test", type: "openai" });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

describe("PUT /api/providers/{name}", () => {
  beforeEach(() => {
    _resetForTesting();
    _setMocksForTesting({ execFile, spawn });
    cleanTempFiles();
    execFile.mockClear();
  });

  it("TC-PR16: returns 200 {ok:true} on success", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "updated", "");
    });

    const res = await request(server)
      .put("/api/providers/my-provider")
      .send({ type: "openai", credentials: { KEY: "val" } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("TC-PR17: returns 400 for missing type", async () => {
    const res = await request(server)
      .put("/api/providers/my-provider")
      .send({ credentials: { KEY: "val" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("type");
  });

  it("TC-PR18: returns 400 for empty body", async () => {
    const res = await request(server)
      .put("/api/providers/my-provider")
      .set("Content-Type", "application/json")
      .send("");
    expect(res.status).toBe(400);
  });

  it("TC-PR19: config values are cached on success", async () => {
    cleanTempFiles();
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "", "");
    });

    await request(server)
      .put("/api/providers/upd-prov")
      .send({ type: "openai", config: { URL: "http://y" } });

    const cache = readCacheFile();
    expect(cache?.["upd-prov"]).toEqual({ URL: "http://y" });
  });

  it("TC-PR20: CLI failure returns 400", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      const err = new Error("fail");
      err.code = 1;
      cb(err, "", "update failed");
    });

    const res = await request(server)
      .put("/api/providers/test")
      .send({ type: "openai" });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/providers/{name}", () => {
  beforeEach(() => {
    _resetForTesting();
    _setMocksForTesting({ execFile, spawn });
    cleanTempFiles();
    execFile.mockClear();
  });

  it("TC-PR21: returns 200 {ok:true} on success", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "deleted", "");
    });

    const res = await request(server).delete("/api/providers/my-provider");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("TC-PR22: removes provider from config cache", async () => {
    writeCacheFile({ "del-prov": { X: "1" }, keep: { Y: "2" } });
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "", "");
    });

    await request(server).delete("/api/providers/del-prov");
    const cache = readCacheFile();
    expect(cache?.["del-prov"]).toBeUndefined();
    expect(cache?.keep).toEqual({ Y: "2" });
  });

  it("TC-PR23: CLI failure returns 400", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      const err = new Error("fail");
      err.code = 1;
      cb(err, "", "delete failed");
    });

    const res = await request(server).delete("/api/providers/test");
    expect(res.status).toBe(400);
  });
});

describe("provider route matching", () => {
  beforeEach(() => {
    _resetForTesting();
    _setMocksForTesting({ execFile, spawn });
    execFile.mockClear();
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "", "");
    });
  });

  it("TC-PR24: regex accepts alphanumeric, underscores, hyphens", async () => {
    const res = await request(server)
      .put("/api/providers/my-provider_v2")
      .send({ type: "openai" });
    expect([200, 400]).toContain(res.status);
    // The route matched — didn't 404
    expect(res.status).not.toBe(404);
  });
});
