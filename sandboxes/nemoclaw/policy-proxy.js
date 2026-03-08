#!/usr/bin/env node

// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// policy-proxy.js — Lightweight reverse proxy that sits in front of the
// OpenClaw gateway.  Intercepts /api/policy requests to read/write the
// sandbox policy YAML file; everything else (including WebSocket upgrades)
// is transparently forwarded to the upstream OpenClaw gateway.

const http = require("http");
const fs = require("fs");
const net = require("net");

const POLICY_PATH = process.env.POLICY_PATH || "/etc/navigator/policy.yaml";
const UPSTREAM_PORT = parseInt(process.env.UPSTREAM_PORT || "18788", 10);
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || "18789", 10);
const UPSTREAM_HOST = "127.0.0.1";

function proxyRequest(clientReq, clientRes) {
  const opts = {
    hostname: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: clientReq.headers,
  };

  const upstream = http.request(opts, (upstreamRes) => {
    clientRes.writeHead(upstreamRes.statusCode, upstreamRes.headers);
    upstreamRes.pipe(clientRes, { end: true });
  });

  upstream.on("error", (err) => {
    console.error("[proxy] upstream error:", err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "Content-Type": "application/json" });
    }
    clientRes.end(JSON.stringify({ error: "upstream unavailable" }));
  });

  clientReq.pipe(upstream, { end: true });
}

function handlePolicyGet(req, res) {
  fs.readFile(POLICY_PATH, "utf8", (err, data) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify({ error: err.code === "ENOENT" ? "policy file not found" : err.message }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/yaml; charset=utf-8" });
    res.end(data);
  });
}

function handlePolicyPost(req, res) {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");

    if (!body.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "empty body" }));
      return;
    }

    // Minimal validation: must contain "version:" and "network_policies:"
    if (!body.includes("version:")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid policy: missing version field" }));
      return;
    }

    // Write to a temp file then rename for atomicity
    const tmp = POLICY_PATH + ".tmp." + process.pid;
    fs.writeFile(tmp, body, "utf8", (writeErr) => {
      if (writeErr) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "write failed: " + writeErr.message }));
        return;
      }
      fs.rename(tmp, POLICY_PATH, (renameErr) => {
        if (renameErr) {
          // rename can fail across filesystems; fall back to direct write
          fs.writeFile(POLICY_PATH, body, "utf8", (fallbackErr) => {
            fs.unlink(tmp, () => {});
            if (fallbackErr) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "write failed: " + fallbackErr.message }));
              return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          });
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/policy") {
    // CORS for same-origin should work, but add headers for safety
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
    } else if (req.method === "GET") {
      handlePolicyGet(req, res);
    } else if (req.method === "POST") {
      handlePolicyPost(req, res);
    } else {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "method not allowed" }));
    }
    return;
  }

  proxyRequest(req, res);
});

// WebSocket upgrade — pipe raw TCP to upstream
server.on("upgrade", (req, socket, head) => {
  const upstream = net.createConnection({ host: UPSTREAM_HOST, port: UPSTREAM_PORT }, () => {
    const reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    let headers = "";
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      headers += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    upstream.write(reqLine + headers + "\r\n");
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  upstream.on("error", (err) => {
    console.error("[proxy] websocket upstream error:", err.message);
    socket.destroy();
  });

  socket.on("error", (err) => {
    console.error("[proxy] websocket client error:", err.message);
    upstream.destroy();
  });
});

server.listen(LISTEN_PORT, "127.0.0.1", () => {
  console.log(`[policy-proxy] Listening on 127.0.0.1:${LISTEN_PORT}, upstream 127.0.0.1:${UPSTREAM_PORT}`);
});
