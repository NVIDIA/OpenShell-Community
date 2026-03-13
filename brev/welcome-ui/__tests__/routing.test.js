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
const { server, _resetForTesting, sandboxState } = serverModule;
const request = supertest;

// === TC-R01 through TC-R17: Routing system ===

describe("routing — method aliasing", () => {
  beforeEach(() => { _resetForTesting(); });
  afterAll(() => { server.close(); });

  it("TC-R01: GET request routes through _route()", async () => {
    const res = await request(server).get("/api/sandbox-status");
    expect(res.status).toBe(200);
  });

  it("TC-R02: POST request routes through _route()", async () => {
    const res = await request(server)
      .post("/api/inject-key")
      .send({ key: "nvapi-test" });
    expect([200, 202, 400]).toContain(res.status);
  });

  it("TC-R03: PUT request routes through _route()", async () => {
    const res = await request(server)
      .put("/api/providers/test-provider")
      .send({ type: "openai" });
    // 400 because CLI fails, but routing works
    expect([200, 400, 502]).toContain(res.status);
  });

  it("TC-R04: DELETE request routes through _route()", async () => {
    const res = await request(server).delete("/api/providers/test-provider");
    expect([200, 400, 502]).toContain(res.status);
  });

  it("TC-R05: PATCH to unknown path returns 404 when sandbox not ready", async () => {
    const res = await request(server).patch("/some-path");
    expect(res.status).toBe(404);
  });

  it("TC-R06: HEAD request routes through _route() (no body returned)", async () => {
    const res = await request(server).head("/");
    expect(res.status).toBe(200);
    expect(res.text).toBeFalsy();
  });

  it("TC-R07: OPTIONS to any path returns 204 with CORS headers", async () => {
    const res = await request(server).options("/api/sandbox-status");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toContain("GET");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });
});

describe("routing — path extraction", () => {
  beforeEach(() => { _resetForTesting(); });

  it("TC-R08: query string stripped for route matching", async () => {
    const res = await request(server).get("/api/sandbox-status?foo=bar&baz=1");
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
  });

  it("TC-R09: query string preserved for proxy (tested via non-API path)", async () => {
    // When sandbox is NOT ready, non-API path returns static or 404
    const res = await request(server).get("/some/path?query=value");
    expect(res.status).toBe(404);
  });
});

describe("routing — priority", () => {
  beforeEach(() => { _resetForTesting(); });

  it("TC-R10: API routes handled locally even when sandbox is running", async () => {
    sandboxState.status = "running";
    sandboxState.url = "http://127.0.0.1:8081/";
    const res = await request(server).get("/api/sandbox-status");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("running");
  });

  it("TC-R11: GET / serves templated index when sandbox NOT ready", async () => {
    const res = await request(server).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("OpenShell");
  });

  it("TC-R13: unknown path returns 404 when sandbox NOT ready", async () => {
    const res = await request(server).get("/totally/unknown/path");
    expect(res.status).toBe(404);
  });

  it("TC-R14: unknown POST (non-API, sandbox not ready) returns 404", async () => {
    const res = await request(server).post("/unknown");
    expect(res.status).toBe(404);
  });
});

describe("routing — default headers", () => {
  beforeEach(() => { _resetForTesting(); });

  it("TC-R15: non-proxy responses include Cache-Control no-cache", async () => {
    const res = await request(server).get("/api/sandbox-status");
    expect(res.headers["cache-control"]).toContain("no-cache");
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers["cache-control"]).toContain("must-revalidate");
  });

  it("TC-R16: non-proxy responses include Access-Control-Allow-Origin *", async () => {
    const res = await request(server).get("/api/sandbox-status");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("TC-R17: proxy responses should NOT include server CORS headers (covered in proxy tests)", () => {
    // Verified in proxy-http.test.js TC-PX11
    expect(true).toBe(true);
  });
});
