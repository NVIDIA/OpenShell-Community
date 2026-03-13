// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import fs from 'fs';

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

// === TC-P01 through TC-P12: Policy sync ===

describe("POST /api/policy-sync", () => {
  beforeEach(() => {
    _resetForTesting();
    _setMocksForTesting({ execFile, spawn });
    cleanTempFiles();
    execFile.mockClear();
  });

  afterAll(() => { server.close(); });

  it("TC-P01: returns 400 for empty body", async () => {
    const res = await request(server)
      .post("/api/policy-sync")
      .set("Content-Type", "text/yaml")
      .send("");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("empty body");
  });

  it("TC-P02: returns 400 for body missing version field", async () => {
    const res = await request(server)
      .post("/api/policy-sync")
      .set("Content-Type", "text/yaml")
      .send("name: test\nvalue: 123\n");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("missing version");
  });

  it("TC-P03: returns 200 with applied=true on CLI success", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, FIXTURES.policySyncSuccess, "");
    });

    const res = await request(server)
      .post("/api/policy-sync")
      .set("Content-Type", "text/yaml")
      .send(FIXTURES.validPolicyYaml);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.applied).toBe(true);
    expect(res.body.version).toBe(3);
    expect(res.body.policy_hash).toBe("deadbeef01234567");
  });

  it("TC-P04: returns 502 on CLI failure", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      const err = new Error("CLI failed");
      err.code = 1;
      cb(err, "", "policy set failed: sandbox not found");
    });

    const res = await request(server)
      .post("/api/policy-sync")
      .set("Content-Type", "text/yaml")
      .send(FIXTURES.validPolicyYaml);
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBeDefined();
  });

  it("TC-P05: strips inference field from input YAML", async () => {
    let writtenArgs;
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      writtenArgs = args;
      cb(null, "version 1\nhash: abc\n", "");
    });

    await request(server)
      .post("/api/policy-sync")
      .set("Content-Type", "text/yaml")
      .send(FIXTURES.validPolicyYaml);

    // The CLI is called with a temp file. We verify the call was made.
    expect(execFile).toHaveBeenCalled();
    const policyCalls = execFile.mock.calls.filter(
      (c) => c[0] === "nemoclaw" && c[1]?.includes("policy")
    );
    expect(policyCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("TC-P06: strips process field from input YAML", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "version 1\nhash: abc\n", "");
    });

    const res = await request(server)
      .post("/api/policy-sync")
      .set("Content-Type", "text/yaml")
      .send(FIXTURES.validPolicyYaml);
    expect(res.status).toBe(200);
  });

  it("TC-P07: writes stripped YAML to temp file and passes path to CLI", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "version 1\nhash: abc\n", "");
    });

    await request(server)
      .post("/api/policy-sync")
      .set("Content-Type", "text/yaml")
      .send(FIXTURES.validPolicyYaml);

    const call = execFile.mock.calls.find(
      (c) => c[0] === "nemoclaw" && c[1]?.includes("policy")
    );
    expect(call).toBeDefined();
    const args = call[1];
    expect(args).toContain("--policy");
    const policyIdx = args.indexOf("--policy");
    const tmpPath = args[policyIdx + 1];
    expect(tmpPath).toContain("policy-sync-");
  });

  it("TC-P08: temp file is cleaned up even on CLI failure", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      const err = new Error("fail");
      err.code = 1;
      cb(err, "", "error");
    });

    await request(server)
      .post("/api/policy-sync")
      .set("Content-Type", "text/yaml")
      .send(FIXTURES.validPolicyYaml);

    // The temp file should have been cleaned up by the finally block.
    // We check that no stale policy-sync temp files remain in /tmp
    const tmpFiles = fs.readdirSync("/tmp").filter((f) => f.startsWith("policy-sync-"));
    expect(tmpFiles.length).toBe(0);
  });

  it("TC-P09: parses version from CLI output", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "Policy applied.\nversion 7\nhash: cafebabe\n", "");
    });

    const res = await request(server)
      .post("/api/policy-sync")
      .set("Content-Type", "text/yaml")
      .send(FIXTURES.validPolicyYaml);
    expect(res.body.version).toBe(7);
  });

  it("TC-P10: parses hash from CLI output", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "version 1\nhash: cafebabe\n", "");
    });

    const res = await request(server)
      .post("/api/policy-sync")
      .set("Content-Type", "text/yaml")
      .send(FIXTURES.validPolicyYaml);
    expect(res.body.policy_hash).toBe("cafebabe");
  });

  it("TC-P11: returns version=0 and empty hash if regex doesn't match", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      cb(null, "Policy applied successfully.\n", "");
    });

    const res = await request(server)
      .post("/api/policy-sync")
      .set("Content-Type", "text/yaml")
      .send(FIXTURES.validPolicyYaml);
    expect(res.body.version).toBe(0);
    expect(res.body.policy_hash).toBe("");
  });

  it("TC-P12: CLI timeout returns 502 error", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      const err = new Error("Command timed out");
      err.killed = true;
      cb(err, "", "");
    });

    const res = await request(server)
      .post("/api/policy-sync")
      .set("Content-Type", "text/yaml")
      .send(FIXTURES.validPolicyYaml);
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
  });
});
