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
const { server, _resetForTesting, _setMocksForTesting } = serverModule;
import setupModule from './setup.js';
const { cleanTempFiles, FIXTURES } = setupModule;
const request = supertest;

// === TC-CI01 through TC-CI10: Cluster inference ===

describe("GET /api/cluster-inference", () => {
  beforeEach(() => {
    _resetForTesting();
    _setMocksForTesting({ execFile, spawn });
    cleanTempFiles();
    execFile.mockClear();
  });

  afterAll(() => { server.close(); });

  it("TC-CI01: returns parsed providerName, modelId, version on success", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, FIXTURES.clusterInferenceOutput, "");
    });

    const res = await request(server).get("/api/cluster-inference");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.providerName).toBe("nvidia-inference");
    expect(res.body.modelId).toBe("meta/llama-3.1-70b-instruct");
    expect(res.body.version).toBe(2);
  });

  it("TC-CI02: returns nulls when 'not configured' in stderr", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      const err = new Error("fail");
      err.code = 1;
      cb(err, "", "cluster inference not configured");
    });

    const res = await request(server).get("/api/cluster-inference");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.providerName).toBeNull();
    expect(res.body.modelId).toBe("");
    expect(res.body.version).toBe(0);
  });

  it("TC-CI03: returns nulls when 'not found' in stderr", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      const err = new Error("fail");
      err.code = 1;
      cb(err, "", "inference config not found");
    });

    const res = await request(server).get("/api/cluster-inference");
    expect(res.status).toBe(200);
    expect(res.body.providerName).toBeNull();
  });

  it("TC-CI04: returns 400 on other CLI errors", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      const err = new Error("fail");
      err.code = 1;
      cb(err, "", "unexpected error occurred");
    });

    const res = await request(server).get("/api/cluster-inference");
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("TC-CI05: ANSI codes in output are stripped before parsing", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, FIXTURES.clusterInferenceAnsi, "");
    });

    const res = await request(server).get("/api/cluster-inference");
    expect(res.status).toBe(200);
    expect(res.body.providerName).toBe("nvidia-inference");
    expect(res.body.modelId).toBe("meta/llama-3.1-70b-instruct");
  });
});

describe("POST /api/cluster-inference", () => {
  beforeEach(() => {
    _resetForTesting();
    _setMocksForTesting({ execFile, spawn });
    cleanTempFiles();
    execFile.mockClear();
  });

  it("TC-CI06: returns 200 with parsed output on success", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "Provider: my-prov\nModel: llama\nVersion: 1\n", "");
    });

    const res = await request(server)
      .post("/api/cluster-inference")
      .send({ providerName: "my-prov", modelId: "llama" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("TC-CI07: returns 400 when providerName missing", async () => {
    const res = await request(server)
      .post("/api/cluster-inference")
      .send({ modelId: "llama" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("providerName");
  });

  it("TC-CI08: returns 400 when modelId missing", async () => {
    const res = await request(server)
      .post("/api/cluster-inference")
      .send({ providerName: "prov" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("modelId");
  });

  it("TC-CI09: returns 400 on CLI failure", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      const err = new Error("fail");
      err.code = 1;
      cb(err, "", "set failed");
    });

    const res = await request(server)
      .post("/api/cluster-inference")
      .send({ providerName: "p", modelId: "m" });
    expect(res.status).toBe(400);
  });

  it("TC-CI10: calls nemoclaw cluster inference set with --provider and --model", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "", "");
    });

    await request(server)
      .post("/api/cluster-inference")
      .send({ providerName: "test-prov", modelId: "test-model" });

    const setCall = execFile.mock.calls.find(
      (c) => c[0] === "nemoclaw" && c[1]?.includes("inference") && c[1]?.includes("set")
    );
    expect(setCall).toBeDefined();
    const args = setCall[1];
    expect(args).toContain("--provider");
    expect(args).toContain("test-prov");
    expect(args).toContain("--model");
    expect(args).toContain("test-model");
  });
});
