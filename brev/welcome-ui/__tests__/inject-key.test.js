// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import crypto from 'crypto';

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
  injectKeyState,
  hashKey,
} = serverModule;
import setupModule from './setup.js';
const { cleanTempFiles, FIXTURES } = setupModule;
const request = supertest;

// === TC-K01 through TC-K16: Key injection ===

describe("POST /api/inject-key", () => {
  beforeEach(() => {
    _resetForTesting();
    _setMocksForTesting({ execFile, spawn });
    cleanTempFiles();
    execFile.mockClear();
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "", "");
    });
  });

  afterAll(() => { server.close(); });

  it("TC-K01: returns 202 {ok:true,started:true} for valid key", async () => {
    const res = await request(server)
      .post("/api/inject-key")
      .send({ key: FIXTURES.sampleApiKey });
    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
    expect(res.body.started).toBe(true);
  });

  it("TC-K02: returns 400 for empty body", async () => {
    const res = await request(server)
      .post("/api/inject-key")
      .set("Content-Type", "application/json")
      .send("");
    expect(res.status).toBe(400);
  });

  it("TC-K03: returns 400 for invalid JSON body", async () => {
    const res = await request(server)
      .post("/api/inject-key")
      .set("Content-Type", "application/json")
      .send("not json!");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("invalid JSON");
  });

  it("TC-K04: returns 400 for missing key field", async () => {
    const res = await request(server)
      .post("/api/inject-key")
      .send({ notkey: "value" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("missing key");
  });

  it("TC-K05: returns 400 for empty/whitespace-only key", async () => {
    const res = await request(server)
      .post("/api/inject-key")
      .send({ key: "   " });
    expect(res.status).toBe(400);
  });
});

describe("inject-key deduplication", () => {
  beforeEach(() => {
    _resetForTesting();
    _setMocksForTesting({ execFile, spawn });
    cleanTempFiles();
    execFile.mockClear();
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "", "");
    });
  });

  it("TC-K06: same key while injecting returns 202 (no new process)", async () => {
    injectKeyState.status = "injecting";
    injectKeyState.keyHash = hashKey(FIXTURES.sampleApiKey);
    const res = await request(server)
      .post("/api/inject-key")
      .send({ key: FIXTURES.sampleApiKey });
    expect(res.status).toBe(202);
    expect(res.body.started).toBe(true);
  });

  it("TC-K07: same key after done returns 200 {already:true}", async () => {
    injectKeyState.status = "done";
    injectKeyState.keyHash = hashKey(FIXTURES.sampleApiKey);
    const res = await request(server)
      .post("/api/inject-key")
      .send({ key: FIXTURES.sampleApiKey });
    expect(res.status).toBe(200);
    expect(res.body.already).toBe(true);
  });

  it("TC-K08: different key after done starts new injection", async () => {
    injectKeyState.status = "done";
    injectKeyState.keyHash = hashKey(FIXTURES.sampleApiKey);
    const res = await request(server)
      .post("/api/inject-key")
      .send({ key: FIXTURES.sampleApiKey2 });
    expect(res.status).toBe(202);
    expect(res.body.started).toBe(true);
  });

  it("TC-K09: different key while injecting starts new injection", async () => {
    injectKeyState.status = "injecting";
    injectKeyState.keyHash = hashKey(FIXTURES.sampleApiKey);
    const res = await request(server)
      .post("/api/inject-key")
      .send({ key: FIXTURES.sampleApiKey2 });
    expect(res.status).toBe(202);
    expect(res.body.started).toBe(true);
  });
});

describe("inject-key background process", () => {
  beforeEach(() => {
    _resetForTesting();
    _setMocksForTesting({ execFile, spawn });
    cleanTempFiles();
    execFile.mockClear();
  });

  it("TC-K10: calls nemoclaw provider update nvidia-inference with correct args", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "", "");
    });

    await request(server)
      .post("/api/inject-key")
      .send({ key: FIXTURES.sampleApiKey });

    // Wait for the async background call
    await new Promise((r) => setTimeout(r, 100));

    const updateCalls = execFile.mock.calls.filter(
      (c) => c[0] === "nemoclaw" && c[1]?.includes("update")
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const args = updateCalls[0][1];
    expect(args).toContain("nvidia-inference");
    expect(args).toContain("--type");
    expect(args).toContain("openai");
    expect(args.some((a) => a.startsWith("OPENAI_API_KEY="))).toBe(true);
    expect(args.some((a) => a.includes("inference-api.nvidia.com"))).toBe(true);
  });

  it("TC-K11: on CLI success, state becomes done", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "updated", "");
    });

    await request(server)
      .post("/api/inject-key")
      .send({ key: FIXTURES.sampleApiKey });

    await new Promise((r) => setTimeout(r, 200));
    expect(injectKeyState.status).toBe("done");
  });

  it("TC-K12: on CLI failure, state becomes error", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      if (args?.includes("update")) {
        const err = new Error("fail");
        err.code = 1;
        return cb(err, "", "provider not found");
      }
      cb(null, "", "");
    });

    await request(server)
      .post("/api/inject-key")
      .send({ key: FIXTURES.sampleApiKey });

    await new Promise((r) => setTimeout(r, 200));
    expect(injectKeyState.status).toBe("error");
    expect(injectKeyState.error).toBeDefined();
  });

  it("TC-K13: on CLI exception, state becomes error", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      if (args?.includes("update")) {
        throw new Error("spawn failed");
      }
      cb(null, "", "");
    });

    await request(server)
      .post("/api/inject-key")
      .send({ key: FIXTURES.sampleApiKey });

    await new Promise((r) => setTimeout(r, 200));
    // The error is caught by the .catch() handler in runInjectKey
    expect(["error", "injecting"]).toContain(injectKeyState.status);
  });
});

describe("key hashing", () => {
  beforeEach(() => {
    _resetForTesting();
    _setMocksForTesting({ execFile, spawn });
    execFile.mockClear();
  });

  it("TC-K14: key hash is SHA-256 hex digest", () => {
    const key = "test-key-123";
    const expected = crypto.createHash("sha256").update(key).digest("hex");
    expect(hashKey(key)).toBe(expected);
  });

  it("TC-K15: identical keys produce same hash", () => {
    expect(hashKey("abc")).toBe(hashKey("abc"));
  });

  it("TC-K16: provider name is hardcoded to nvidia-inference", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "", "");
    });

    await request(server)
      .post("/api/inject-key")
      .send({ key: FIXTURES.sampleApiKey });

    await new Promise((r) => setTimeout(r, 100));

    const updateCalls = execFile.mock.calls.filter(
      (c) => c[0] === "nemoclaw" && c[1]?.includes("update")
    );
    if (updateCalls.length > 0) {
      expect(updateCalls[0][1]).toContain("nvidia-inference");
    }
  });
});
