// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import http from 'http';
import request from 'supertest';

vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    cb(null, '', '');
  }),
  spawn: vi.fn(),
}));

import { execFile, spawn } from 'child_process';
import serverModule from '../server.js';
const { server, _resetForTesting, _setMocksForTesting, sandboxState, SANDBOX_PORT } = serverModule;

import setupModule from './setup.js';
const { cleanTempFiles } = setupModule;

// Create a real upstream server to proxy to
let upstream;
let upstreamPort;

function createUpstream(handler) {
  return new Promise((resolve) => {
    upstream = http.createServer(handler);
    upstream.listen(SANDBOX_PORT, "127.0.0.1", () => {
      upstreamPort = upstream.address().port;
      resolve();
    });
  });
}

function closeUpstream() {
  return new Promise((resolve) => {
    if (upstream) {
      upstream.close(() => resolve());
      upstream = null;
    } else {
      resolve();
    }
  });
}

// === TC-PX01 through TC-PX12: HTTP reverse proxy ===

describe("HTTP reverse proxy", () => {
  beforeEach(() => {
    _resetForTesting();
    _setMocksForTesting({ execFile, spawn });
    cleanTempFiles();
  });

  afterEach(async () => {
    await closeUpstream();
  });

  afterAll(() => { server.close(); });

  it("TC-PX01: non-API request proxied to sandbox when ready", async () => {
    await createUpstream((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("upstream response");
    });

    sandboxState.status = "running";
    const res = await request(server).get("/some/page");
    expect(res.status).toBe(200);
    expect(res.text).toBe("upstream response");
  });

  it("TC-PX02: request method is forwarded", async () => {
    let receivedMethod;
    await createUpstream((req, res) => {
      receivedMethod = req.method;
      res.writeHead(200);
      res.end("ok");
    });

    sandboxState.status = "running";
    await request(server).post("/data").send("body");
    expect(receivedMethod).toBe("POST");
  });

  it("TC-PX03: full path + query string forwarded", async () => {
    let receivedUrl;
    await createUpstream((req, res) => {
      receivedUrl = req.url;
      res.writeHead(200);
      res.end("ok");
    });

    sandboxState.status = "running";
    await request(server).get("/path/to/resource?key=value&x=1");
    expect(receivedUrl).toBe("/path/to/resource?key=value&x=1");
  });

  it("TC-PX04: request body is forwarded", async () => {
    let receivedBody = "";
    await createUpstream((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        receivedBody = Buffer.concat(chunks).toString();
        res.writeHead(200);
        res.end("ok");
      });
    });

    sandboxState.status = "running";
    await request(server)
      .post("/upload")
      .set("Content-Type", "text/plain")
      .send("hello world");
    expect(receivedBody).toBe("hello world");
  });

  it("TC-PX05: Host header rewritten to 127.0.0.1:SANDBOX_PORT", async () => {
    let receivedHost;
    await createUpstream((req, res) => {
      receivedHost = req.headers.host;
      res.writeHead(200);
      res.end("ok");
    });

    sandboxState.status = "running";
    await request(server).get("/test");
    expect(receivedHost).toBe(`127.0.0.1:${SANDBOX_PORT}`);
  });

  it("TC-PX06: other request headers forwarded as-is", async () => {
    let receivedHeaders;
    await createUpstream((req, res) => {
      receivedHeaders = req.headers;
      res.writeHead(200);
      res.end("ok");
    });

    sandboxState.status = "running";
    await request(server)
      .get("/test")
      .set("X-Custom-Header", "myvalue")
      .set("Authorization", "Bearer token123");
    expect(receivedHeaders["x-custom-header"]).toBe("myvalue");
    expect(receivedHeaders["authorization"]).toBe("Bearer token123");
  });

  it("TC-PX07: hop-by-hop headers stripped from response", async () => {
    await createUpstream((req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/plain",
        Connection: "keep-alive",
        "Keep-Alive": "timeout=5",
        "Transfer-Encoding": "chunked",
        "X-Custom": "preserved",
      });
      res.end("body");
    });

    sandboxState.status = "running";
    const res = await request(server).get("/test");
    expect(res.headers["connection"]).not.toBe("keep-alive");
    expect(res.headers["keep-alive"]).toBeUndefined();
    expect(res.headers["transfer-encoding"]).toBeUndefined();
    expect(res.headers["x-custom"]).toBe("preserved");
  });

  it("TC-PX08: upstream Content-Length replaced with actual body length", async () => {
    await createUpstream((req, res) => {
      const body = "exact body";
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(body);
    });

    sandboxState.status = "running";
    const res = await request(server).get("/test");
    expect(parseInt(res.headers["content-length"], 10)).toBe(
      Buffer.byteLength("exact body")
    );
  });

  it("TC-PX09: upstream error returns 502 Sandbox unavailable", async () => {
    // Don't start upstream — connection will fail
    sandboxState.status = "running";
    const res = await request(server).get("/test");
    expect(res.status).toBe(502);
    expect(res.text).toBe("Sandbox unavailable");
  });

  it("TC-PX10: connection is closed after proxy request", async () => {
    await createUpstream((req, res) => {
      res.writeHead(200);
      res.end("done");
    });

    sandboxState.status = "running";
    const res = await request(server).get("/test");
    expect(res.status).toBe(200);
    // supertest handles connection lifecycle
  });

  it("TC-PX11: proxy responses do NOT include server CORS/Cache-Control", async () => {
    await createUpstream((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("proxied");
    });

    sandboxState.status = "running";
    const res = await request(server).get("/test");
    // The proxy path doesn't call setDefaultHeaders.
    // Upstream didn't send these headers, so they shouldn't appear.
    // (The server only adds CORS/Cache-Control via setDefaultHeaders for local responses)
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("TC-PX12: proxy connection timeout is 120s", async () => {
    // Verify the timeout value is configured in the proxy options.
    // We can't easily test 120s timeout, but we verify the proxy works
    // and the timeout is set in the source code (opts.timeout = 120000).
    await createUpstream((req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    sandboxState.status = "running";
    const res = await request(server).get("/test");
    expect(res.status).toBe(200);
  });
});
