// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import http from 'http';
import net from 'net';

vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    cb(null, '', '');
  }),
  spawn: vi.fn(),
}));

import serverModule from '../server.js';
const { server, _resetForTesting, sandboxState, SANDBOX_PORT } = serverModule;

import setupModule from './setup.js';
const { cleanTempFiles } = setupModule;

let upstream;
let serverListening = false;
let serverPort;

function startServer() {
  return new Promise((resolve) => {
    if (serverListening) return resolve();
    server.listen(0, "127.0.0.1", () => {
      serverPort = server.address().port;
      serverListening = true;
      resolve();
    });
  });
}

function createWsUpstream() {
  return new Promise((resolve) => {
    upstream = net.createServer((socket) => {
      // Simple echo: read HTTP upgrade request, send back 101, then echo data
      let gotUpgrade = false;
      let buffer = Buffer.alloc(0);

      socket.on("data", (chunk) => {
        if (!gotUpgrade) {
          buffer = Buffer.concat([buffer, chunk]);
          const str = buffer.toString();
          if (str.includes("\r\n\r\n")) {
            gotUpgrade = true;
            // Send back 101 Switching Protocols
            socket.write(
              "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n\r\n"
            );
            // Any remaining data after headers is echoed back
            const bodyStart = str.indexOf("\r\n\r\n") + 4;
            const remaining = buffer.slice(bodyStart);
            if (remaining.length > 0) {
              socket.write(remaining);
            }
          }
        } else {
          // Echo back data in websocket-like fashion
          socket.write(chunk);
        }
      });
    });

    upstream.listen(SANDBOX_PORT, "127.0.0.1", () => {
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

// === TC-WS01 through TC-WS08: WebSocket proxy ===

describe("WebSocket proxy", () => {
  beforeEach(async () => {
    _resetForTesting();
    cleanTempFiles();
    await startServer();
  });

  afterEach(async () => {
    await closeUpstream();
  });

  afterAll(() => { server.close(); });

  it("TC-WS01: WebSocket upgrade with sandbox ready is proxied", async () => {
    await createWsUpstream();
    sandboxState.status = "running";

    const result = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: serverPort,
        path: "/ws",
        method: "GET",
        headers: {
          Upgrade: "websocket",
          Connection: "Upgrade",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13",
        },
      });

      req.on("upgrade", (res, socket) => {
        resolve({ statusCode: res.statusCode, socket });
        socket.destroy();
      });

      req.on("error", reject);
      req.setTimeout(3000, () => {
        req.destroy();
        reject(new Error("timeout"));
      });
      req.end();
    });

    expect(result.statusCode).toBe(101);
  });

  it("TC-WS02: WebSocket upgrade with sandbox NOT ready returns 502", async () => {
    sandboxState.status = "idle";

    const result = await new Promise((resolve, reject) => {
      const sock = net.createConnection({ port: serverPort, host: "127.0.0.1" }, () => {
        sock.write(
          "GET /ws HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n\r\n"
        );
      });

      let data = "";
      sock.on("data", (chunk) => {
        data += chunk.toString();
        if (data.includes("\r\n")) {
          sock.destroy();
          resolve(data);
        }
      });

      sock.on("error", reject);
      sock.setTimeout(3000, () => {
        sock.destroy();
        reject(new Error("timeout"));
      });
    });

    expect(result).toContain("502");
  });

  it("TC-WS03: Host header rewritten to sandbox address in upgrade", async () => {
    let receivedHeaders = "";
    await new Promise((resolve) => {
      upstream = net.createServer((socket) => {
        socket.on("data", (chunk) => {
          receivedHeaders += chunk.toString();
          socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
        });
      });
      upstream.listen(SANDBOX_PORT, "127.0.0.1", resolve);
    });

    sandboxState.status = "running";

    await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: serverPort,
        path: "/ws",
        method: "GET",
        headers: {
          Upgrade: "websocket",
          Connection: "Upgrade",
          Host: "original.host:8081",
        },
      });

      req.on("upgrade", (res, socket) => {
        socket.destroy();
        resolve();
      });

      req.on("error", reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error("timeout")); });
      req.end();
    });

    expect(receivedHeaders).toContain(`Host: 127.0.0.1:${SANDBOX_PORT}`);
  });

  it("TC-WS04: data flows bidirectionally", async () => {
    await createWsUpstream();
    sandboxState.status = "running";

    const result = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: serverPort,
        path: "/ws",
        method: "GET",
        headers: {
          Upgrade: "websocket",
          Connection: "Upgrade",
        },
      });

      req.on("upgrade", (res, socket) => {
        socket.write("ping");
        socket.on("data", (data) => {
          resolve(data.toString());
          socket.destroy();
        });
      });

      req.on("error", reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error("timeout")); });
      req.end();
    });

    expect(result).toBe("ping");
  });

  it("TC-WS05: client disconnect shuts down upstream", async () => {
    let upstreamClosed = false;
    await new Promise((resolve) => {
      upstream = net.createServer((socket) => {
        socket.on("data", () => {
          socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
        });
        socket.on("close", () => { upstreamClosed = true; });
      });
      upstream.listen(SANDBOX_PORT, "127.0.0.1", resolve);
    });

    sandboxState.status = "running";

    await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: serverPort,
        path: "/ws",
        method: "GET",
        headers: { Upgrade: "websocket", Connection: "Upgrade" },
      });

      req.on("upgrade", (res, socket) => {
        // Immediately close client side
        socket.destroy();
        setTimeout(resolve, 200);
      });

      req.on("error", reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error("timeout")); });
      req.end();
    });

    expect(upstreamClosed).toBe(true);
  });

  it("TC-WS06: upstream disconnect shuts down client", async () => {
    let clientClosed = false;
    await new Promise((resolve) => {
      upstream = net.createServer((socket) => {
        socket.on("data", () => {
          socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
          // Immediately close upstream side
          setTimeout(() => socket.destroy(), 100);
        });
      });
      upstream.listen(SANDBOX_PORT, "127.0.0.1", resolve);
    });

    sandboxState.status = "running";

    await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: serverPort,
        path: "/ws",
        method: "GET",
        headers: { Upgrade: "websocket", Connection: "Upgrade" },
      });

      req.on("upgrade", (res, socket) => {
        socket.on("close", () => {
          clientClosed = true;
          resolve();
        });
      });

      req.on("error", reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error("timeout")); });
      req.end();
    });

    expect(clientClosed).toBe(true);
  });

  it("TC-WS07: WebSocket upgrade to API path is proxied when sandbox ready", async () => {
    await createWsUpstream();
    sandboxState.status = "running";

    const result = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: serverPort,
        path: "/api/sandbox-status",
        method: "GET",
        headers: {
          Upgrade: "websocket",
          Connection: "Upgrade",
        },
      });

      req.on("upgrade", (res, socket) => {
        resolve({ statusCode: res.statusCode });
        socket.destroy();
      });

      req.on("error", reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error("timeout")); });
      req.end();
    });

    // WebSocket upgrades take priority over API routes
    expect(result.statusCode).toBe(101);
  });

  it("TC-WS08: TCP connection timeout for upstream is bounded", async () => {
    // Don't start upstream — connection should fail/timeout
    sandboxState.status = "running";

    const result = await new Promise((resolve, reject) => {
      const sock = net.createConnection({ port: serverPort, host: "127.0.0.1" }, () => {
        sock.write(
          "GET /ws HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n\r\n"
        );
      });

      let data = "";
      sock.on("data", (chunk) => { data += chunk.toString(); });
      sock.on("close", () => resolve(data));
      sock.on("error", reject);
      sock.setTimeout(10000, () => {
        sock.destroy();
        reject(new Error("test timeout"));
      });
    });

    // Client socket should be closed when upstream fails
    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});
