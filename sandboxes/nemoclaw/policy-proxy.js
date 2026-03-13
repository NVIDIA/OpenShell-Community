#!/usr/bin/env node

// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// policy-proxy.js — Lightweight reverse proxy that sits in front of the
// OpenClaw gateway.  Intercepts /api/policy requests to read/write the
// sandbox policy YAML file and push updates to the NemoClaw gateway via
// gRPC so changes take effect on the running sandbox.  Everything else
// (including WebSocket upgrades) is transparently forwarded to the
// upstream OpenClaw gateway.

const http = require("http");
const fs = require("fs");
const os = require("os");
const net = require("net");

const POLICY_PATH = process.env.POLICY_PATH || "/etc/openshell/policy.yaml";
const UPSTREAM_PORT = parseInt(process.env.UPSTREAM_PORT || "18788", 10);
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || "18789", 10);
const UPSTREAM_HOST = "127.0.0.1";

const PROTO_DIR = "/usr/local/lib/nemoclaw-proto";

// Well-known paths for TLS credentials (volume-mounted by the NemoClaw
// platform).  When the proxy runs inside an SSH session the env vars are
// cleared, but the files on disk remain accessible.
const TLS_WELL_KNOWN = {
  ca:   "/etc/openshell-tls/client/ca.crt",
  cert: "/etc/openshell-tls/client/tls.crt",
  key:  "/etc/openshell-tls/client/tls.key",
};

const WELL_KNOWN_ENDPOINT = "https://navigator.navigator.svc.cluster.local:8080";

// Resolved at init time.
let gatewayEndpoint = "";
let sandboxName = "";

// ---------------------------------------------------------------------------
// Discovery helpers
// ---------------------------------------------------------------------------

function discoverFromSupervisor() {
  try {
    const raw = fs.readFileSync("/proc/1/cmdline");
    const args = raw.toString("utf8").split("\0").filter(Boolean);
    const result = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--navigator-endpoint" && i + 1 < args.length) {
        result.endpoint = args[i + 1];
      } else if (args[i] === "--sandbox-id" && i + 1 < args.length) {
        result.sandboxId = args[i + 1];
      } else if (args[i] === "--sandbox" && i + 1 < args.length) {
        result.sandbox = args[i + 1];
      }
    }
    return result;
  } catch (e) {
    return {};
  }
}

function resolveTlsPaths() {
  const ca   = process.env.NEMOCLAW_TLS_CA   || (fileExists(TLS_WELL_KNOWN.ca)   ? TLS_WELL_KNOWN.ca   : "");
  const cert = process.env.NEMOCLAW_TLS_CERT || (fileExists(TLS_WELL_KNOWN.cert) ? TLS_WELL_KNOWN.cert : "");
  const key  = process.env.NEMOCLAW_TLS_KEY  || (fileExists(TLS_WELL_KNOWN.key)  ? TLS_WELL_KNOWN.key  : "");
  return { ca, cert, key };
}

function fileExists(p) {
  try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// gRPC client (lazy-initialized)
// ---------------------------------------------------------------------------

let grpcClient = null;
let grpcEnabled = false;
let grpcPermanentlyDisabled = false;

function initGrpcClient() {
  // 1. Resolve gateway endpoint.
  gatewayEndpoint = process.env.NEMOCLAW_ENDPOINT || "";

  // 2. Resolve sandbox name.  NEMOCLAW_SANDBOX is overridden to "1" by
  //    the supervisor for all child processes, so prefer NEMOCLAW_SANDBOX_ID.
  sandboxName = process.env.NEMOCLAW_SANDBOX_ID || "";

  // 3. Cmdline fallback (useful when env vars were passed as CLI args).
  if (!gatewayEndpoint || !sandboxName) {
    const discovered = discoverFromSupervisor();
    if (!gatewayEndpoint && discovered.endpoint) {
      gatewayEndpoint = discovered.endpoint;
      console.log(`[policy-proxy] Discovered endpoint from supervisor cmdline: ${gatewayEndpoint}`);
    }
    if (!sandboxName) {
      sandboxName = discovered.sandboxId || discovered.sandbox || "";
    }
  }

  // 4. Well-known fallbacks for SSH sessions where env_clear() stripped
  //    the container env vars.
  if (!gatewayEndpoint && fileExists(TLS_WELL_KNOWN.ca)) {
    gatewayEndpoint = WELL_KNOWN_ENDPOINT;
    console.log(`[policy-proxy] Using well-known gateway endpoint: ${gatewayEndpoint}`);
  }
  if (!sandboxName) {
    sandboxName = os.hostname() || "";
    if (sandboxName) {
      console.log(`[policy-proxy] Using hostname as sandbox name: ${sandboxName}`);
    }
  }

  if (!gatewayEndpoint || !sandboxName) {
    console.log(
      `[policy-proxy] Gateway sync disabled — endpoint=${gatewayEndpoint || "(unset)"}, ` +
      `sandbox=${sandboxName || "(unset)"}.`
    );
    return;
  }

  let grpc, protoLoader;
  try {
    grpc = require("@grpc/grpc-js");
    protoLoader = require("@grpc/proto-loader");
  } catch (e) {
    console.error("[policy-proxy] gRPC packages not available; gateway sync disabled:", e.message);
    return;
  }

  let packageDef;
  try {
    packageDef = protoLoader.loadSync("navigator.proto", {
      keepCase: true,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR],
    });
  } catch (e) {
    console.error("[policy-proxy] Failed to load proto definitions:", e.message);
    return;
  }

  const proto = grpc.loadPackageDefinition(packageDef);

  // Build channel credentials: mTLS when certs exist, TLS-only with CA
  // when only the CA is available, insecure as last resort.
  const tls = resolveTlsPaths();
  let creds;
  try {
    if (tls.ca && tls.cert && tls.key) {
      const rootCerts  = fs.readFileSync(tls.ca);
      const privateKey = fs.readFileSync(tls.key);
      const certChain  = fs.readFileSync(tls.cert);
      creds = grpc.credentials.createSsl(rootCerts, privateKey, certChain);
    } else if (tls.ca) {
      const rootCerts = fs.readFileSync(tls.ca);
      creds = grpc.credentials.createSsl(rootCerts);
    } else {
      creds = grpc.credentials.createInsecure();
    }
  } catch (e) {
    console.error("[policy-proxy] Failed to load TLS credentials:", e.message);
    creds = grpc.credentials.createInsecure();
  }

  // Strip scheme prefix — grpc-js expects "host:port".
  const target = gatewayEndpoint.replace(/^https?:\/\//, "");

  grpcClient = new proto.navigator.v1.Navigator(target, creds);
  grpcEnabled = true;
  console.log(`[policy-proxy] gRPC client initialized → ${target} (sandbox: ${sandboxName})`);

  // Proactive connectivity probe: try to establish a connection within 3s.
  // If the network enforcement proxy blocks us, fail fast here instead of
  // making every Save wait for a 5s RPC timeout.
  const probeDeadline = new Date(Date.now() + 3000);
  grpcClient.waitForReady(probeDeadline, (err) => {
    if (err) {
      console.warn(`[policy-proxy] gRPC connectivity probe failed — disabling gateway sync: ${err.message}`);
      grpcEnabled = false;
      grpcPermanentlyDisabled = true;
    } else {
      console.log("[policy-proxy] gRPC connectivity probe succeeded.");
    }
  });
}

// ---------------------------------------------------------------------------
// YAML → proto conversion
// ---------------------------------------------------------------------------

function yamlToProto(parsed) {
  const fp = parsed.filesystem_policy;
  return {
    version: parsed.version || 1,
    filesystem: fp ? {
      include_workdir: !!fp.include_workdir,
      read_only: fp.read_only || [],
      read_write: fp.read_write || [],
    } : undefined,
    landlock: parsed.landlock ? {
      compatibility: parsed.landlock.compatibility || "",
    } : undefined,
    process: parsed.process ? {
      run_as_user: parsed.process.run_as_user || "",
      run_as_group: parsed.process.run_as_group || "",
    } : undefined,
    network_policies: convertNetworkPolicies(parsed.network_policies || {}),
  };
}

function convertNetworkPolicies(policies) {
  const result = {};
  for (const [key, rule] of Object.entries(policies)) {
    result[key] = {
      name: rule.name || key,
      endpoints: (rule.endpoints || []).map(convertEndpoint),
      binaries: (rule.binaries || []).map((b) => ({ path: b.path || "" })),
    };
  }
  return result;
}

function convertEndpoint(ep) {
  return {
    host: ep.host || "",
    port: ep.port || 0,
    protocol: ep.protocol || "",
    tls: ep.tls || "",
    enforcement: ep.enforcement || "",
    access: ep.access || "",
    rules: (ep.rules || []).map((r) => ({
      allow: {
        method: (r.allow && r.allow.method) || "",
        path: (r.allow && r.allow.path) || "",
        command: (r.allow && r.allow.command) || "",
      },
    })),
    allowed_ips: ep.allowed_ips || [],
  };
}

// ---------------------------------------------------------------------------
// Push policy to gateway via gRPC
// ---------------------------------------------------------------------------

function pushPolicyToGateway(yamlBody) {
  return new Promise((resolve) => {
    if (!grpcEnabled || !grpcClient || grpcPermanentlyDisabled) {
      resolve({ applied: false, reason: "network_enforcement" });
      return;
    }

    let yaml;
    try {
      yaml = require("js-yaml");
    } catch (e) {
      resolve({ applied: false, reason: "js-yaml not available: " + e.message });
      return;
    }

    let parsed;
    try {
      parsed = yaml.load(yamlBody);
    } catch (e) {
      resolve({ applied: false, reason: "YAML parse error: " + e.message });
      return;
    }

    let policyProto;
    try {
      policyProto = yamlToProto(parsed);
    } catch (e) {
      resolve({ applied: false, reason: "proto conversion error: " + e.message });
      return;
    }

    const request = {
      name: sandboxName,
      policy: policyProto,
    };

    const deadline = new Date(Date.now() + 5000);
    grpcClient.UpdateSandboxPolicy(request, { deadline }, (err, response) => {
      if (err) {
        console.error("[policy-proxy] gRPC UpdateSandboxPolicy failed:", err.message);
        grpcEnabled = false;
        grpcPermanentlyDisabled = true;
        console.warn("[policy-proxy] Circuit-breaker tripped — disabling gateway sync for future requests.");
        resolve({ applied: false, reason: "network_enforcement" });
        return;
      }
      console.log(
        `[policy-proxy] Policy pushed to gateway: version=${response.version}, hash=${response.policy_hash}`
      );
      resolve({
        applied: true,
        version: response.version,
        policy_hash: response.policy_hash,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// HTTP proxy helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// /api/policy handlers
// ---------------------------------------------------------------------------

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
  const t0 = Date.now();
  console.log(`[policy-proxy] ── POST /api/policy received`);
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    console.log(`[policy-proxy]    body: ${body.length} bytes`);

    if (!body.trim()) {
      console.log(`[policy-proxy]    REJECTED: empty body`);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "empty body" }));
      return;
    }

    if (!body.includes("version:")) {
      console.log(`[policy-proxy]    REJECTED: missing version field`);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid policy: missing version field" }));
      return;
    }

    console.log(`[policy-proxy]    step 1/3: writing to disk → ${POLICY_PATH}`);
    const tmp = os.tmpdir() + "/policy.yaml.tmp." + process.pid;
    fs.writeFile(tmp, body, "utf8", (writeErr) => {
      if (writeErr) {
        console.error(`[policy-proxy]    step 1/3: FAILED — ${writeErr.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "write failed: " + writeErr.message }));
        return;
      }
      fs.rename(tmp, POLICY_PATH, (renameErr) => {
        if (renameErr) {
          fs.writeFile(POLICY_PATH, body, "utf8", (fallbackErr) => {
            fs.unlink(tmp, () => {});
            if (fallbackErr) {
              console.error(`[policy-proxy]    step 1/3: FAILED (fallback) — ${fallbackErr.message}`);
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "write failed: " + fallbackErr.message }));
              return;
            }
            console.log(`[policy-proxy]    step 1/3: saved to disk (fallback write) [${Date.now() - t0}ms]`);
            syncAndRespond(body, res, t0);
          });
          return;
        }
        console.log(`[policy-proxy]    step 1/3: saved to disk (atomic rename) [${Date.now() - t0}ms]`);
        syncAndRespond(body, res, t0);
      });
    });
  });
}

function syncAndRespond(yamlBody, res, t0) {
  console.log(`[policy-proxy]    step 2/3: attempting gRPC gateway sync (enabled=${grpcEnabled}, disabled=${grpcPermanentlyDisabled})`);
  pushPolicyToGateway(yamlBody).then((result) => {
    const payload = { ok: true, ...result };
    console.log(`[policy-proxy]    step 3/3: responding — applied=${result.applied}, reason=${result.reason || "n/a"} [${Date.now() - t0}ms total]`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.url === "/api/policy") {
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

// Initialize gRPC client before starting the HTTP server.
initGrpcClient();

server.listen(LISTEN_PORT, "127.0.0.1", () => {
  console.log(`[policy-proxy] Listening on 127.0.0.1:${LISTEN_PORT}, upstream 127.0.0.1:${UPSTREAM_PORT}`);
});
