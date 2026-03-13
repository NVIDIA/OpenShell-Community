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
  maybeDetectBrevId,
} = serverModule;
import setupModule from './setup.js';
const { cleanTempFiles } = setupModule;
const request = supertest;

// === TC-CD01 through TC-CD06: Connection details ===

describe("GET /api/connection-details", () => {
  beforeEach(() => {
    _resetForTesting();
    _setMocksForTesting({ execFile, spawn });
    cleanTempFiles();
    execFile.mockClear();
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      if (cmd === "hostname") {
        return cb(null, "myhost.example.com\n", "");
      }
      cb(null, "", "");
    });
  });

  afterAll(() => { server.close(); });

  it("TC-CD01: returns hostname, gatewayUrl, gatewayPort=8080, and instructions", async () => {
    const res = await request(server).get("/api/connection-details");
    expect(res.status).toBe(200);
    expect(res.body.hostname).toBeDefined();
    expect(res.body.gatewayUrl).toBeDefined();
    expect(res.body.gatewayPort).toBe(8080);
    expect(res.body.instructions).toBeDefined();
    expect(res.body.instructions.install).toContain("curl");
    expect(res.body.instructions.connect).toContain("openshell gateway add");
    expect(res.body.instructions.createSandbox).toContain("openshell sandbox create");
    expect(res.body.instructions.tui).toBe("openshell term");
  });

  it("TC-CD02: with Brev ID, gatewayUrl is https://8080-{id}.brevlab.com", async () => {
    maybeDetectBrevId("8081-testenv.brevlab.com");
    const res = await request(server).get("/api/connection-details");
    expect(res.body.gatewayUrl).toBe("https://8080-testenv.brevlab.com");
  });

  it("TC-CD03: without Brev ID, gatewayUrl is http://{hostname}:8080", async () => {
    const res = await request(server).get("/api/connection-details");
    expect(res.body.gatewayUrl).toMatch(/^http:\/\/.*:8080$/);
  });

  it("TC-CD04: hostname -f success uses its output", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      if (cmd === "hostname") {
        return cb(null, "resolved.host.name\n", "");
      }
      cb(null, "", "");
    });

    const res = await request(server).get("/api/connection-details");
    expect(res.body.hostname).toBe("resolved.host.name");
  });

  it("TC-CD05: hostname -f failure falls back to os.hostname()", async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      if (cmd === "hostname") {
        const err = new Error("fail");
        err.code = 1;
        return cb(err, "", "");
      }
      cb(null, "", "");
    });

    const res = await request(server).get("/api/connection-details");
    expect(res.body.hostname).toBeDefined();
    expect(res.body.hostname.length).toBeGreaterThan(0);
  });

  it("TC-CD06: instructions contain exact CLI strings", async () => {
    const res = await request(server).get("/api/connection-details");
    expect(res.body.instructions.install).toBe(
      "curl -fsSL https://github.com/NVIDIA/OpenShell/releases/download/devel/install.sh | sh"
    );
    expect(res.body.instructions.createSandbox).toBe(
      "openshell sandbox create -- claude"
    );
    expect(res.body.instructions.tui).toBe("openshell term");
  });
});
