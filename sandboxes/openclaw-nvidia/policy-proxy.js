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
const crypto = require("crypto");
const { execFile } = require("child_process");

const POLICY_PATH = process.env.POLICY_PATH || "/etc/openshell/policy.yaml";
const UPSTREAM_PORT = parseInt(process.env.UPSTREAM_PORT || "18788", 10);
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || "18789", 10);
const UPSTREAM_HOST = "127.0.0.1";
const AUTO_PAIR_TIMEOUT_MS = parseInt(process.env.AUTO_PAIR_TIMEOUT_MS || "600000", 10);
const AUTO_PAIR_POLL_MS = parseInt(process.env.AUTO_PAIR_POLL_MS || "500", 10);
const AUTO_PAIR_HEARTBEAT_MS = parseInt(process.env.AUTO_PAIR_HEARTBEAT_MS || "30000", 10);
const AUTO_PAIR_QUIET_POLLS = parseInt(process.env.AUTO_PAIR_QUIET_POLLS || "4", 10);
const AUTO_PAIR_APPROVAL_SETTLE_MS = parseInt(process.env.AUTO_PAIR_APPROVAL_SETTLE_MS || "30000", 10);

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

const pairingBootstrap = {
  status: "idle",
  startedAt: 0,
  updatedAt: Date.now(),
  approvedCount: 0,
  errors: 0,
  attempts: 0,
  quietPolls: 0,
  lastApprovalDeviceId: "",
  lastError: "",
  sawPending: false,
  sawPaired: false,
  sawBrowserPaired: false,
  active: false,
  timer: null,
  heartbeatAt: 0,
  lastApprovalAt: 0,
};

function formatRequestLine(req) {
  const host = req.headers.host || "unknown-host";
  return `${req.method || "GET"} ${req.url || "/"} host=${host}`;
}

function isNoisyProxyPath(method, requestPath) {
  if (!requestPath) return false;
  if (requestPath === "/api/pairing-bootstrap") return true;
  if (requestPath === "/favicon.ico" || requestPath === "/favicon.svg") return true;
  if (requestPath.endsWith(".map")) return true;
  if ((method || "GET") === "GET" && requestPath.startsWith("/assets/")) return true;
  return false;
}

function shouldLogProxyRequest(method, requestPath) {
  return !isNoisyProxyPath(method, requestPath);
}

function shouldLogProxyResponse(method, requestPath, statusCode) {
  if ((statusCode || 0) >= 400) return true;
  return !isNoisyProxyPath(method, requestPath);
}

function updatePairingState(patch) {
  Object.assign(pairingBootstrap, patch, { updatedAt: Date.now() });
}

function pairingSnapshot() {
  return {
    status: pairingBootstrap.status,
    startedAt: pairingBootstrap.startedAt || null,
    updatedAt: pairingBootstrap.updatedAt,
    approvedCount: pairingBootstrap.approvedCount,
    errors: pairingBootstrap.errors,
    attempts: pairingBootstrap.attempts,
    quietPolls: pairingBootstrap.quietPolls,
    lastApprovalDeviceId: pairingBootstrap.lastApprovalDeviceId || "",
    lastError: pairingBootstrap.lastError || "",
    sawPending: pairingBootstrap.sawPending,
    sawPaired: pairingBootstrap.sawPaired,
    sawBrowserPaired: pairingBootstrap.sawBrowserPaired,
    active: pairingBootstrap.active,
    lastApprovalAt: pairingBootstrap.lastApprovalAt || null,
  };
}

function execOpenClaw(args) {
  return new Promise((resolve) => {
    execFile("openclaw", args, { timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout || "",
        stderr: stderr || "",
        error: error ? error.message : "",
      });
    });
  });
}

function parseJsonBody(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeDeviceList(raw) {
  const parsed = parseJsonBody(raw);
  if (!parsed || typeof parsed !== "object") {
    return { pending: [], paired: [] };
  }
  return {
    pending: Array.isArray(parsed.pending) ? parsed.pending : [],
    paired: Array.isArray(parsed.paired) ? parsed.paired : [],
  };
}

function approvalSucceeded(raw) {
  const parsed = parseJsonBody(raw);
  const device = parsed && typeof parsed === "object" ? parsed.device : null;
  if (!device || typeof device !== "object") return false;
  return Boolean(device.approvedAtMs) || (Array.isArray(device.tokens) && device.tokens.length > 0);
}

function approvalDeviceId(raw) {
  const parsed = parseJsonBody(raw);
  const deviceId = parsed && parsed.device && typeof parsed.device.deviceId === "string"
    ? parsed.device.deviceId
    : "";
  return deviceId ? deviceId.slice(0, 12) : "";
}

function approvalRequestId(raw) {
  const parsed = parseJsonBody(raw);
  return parsed && typeof parsed.requestId === "string" ? parsed.requestId.trim() : "";
}

function summarizeDevices(devices) {
  const format = (entries) => {
    if (!Array.isArray(entries) || entries.length === 0) return "-";
    return entries
      .filter((entry) => entry && typeof entry === "object" && entry.deviceId)
      .map((entry) => `${entry.clientId || "unknown"}:${String(entry.deviceId).slice(0, 12)}`)
      .join(", ") || "-";
  };
  return `pending=${devices.pending.length} [${format(devices.pending)}] paired=${devices.paired.length} [${format(devices.paired)}]`;
}

function isBrowserDevice(device) {
  if (!device || typeof device !== "object") return false;
  return device.clientId === "openclaw-control-ui" || device.clientMode === "webchat";
}

function finishPairingBootstrap(status, extra = {}) {
  if (pairingBootstrap.timer) {
    clearTimeout(pairingBootstrap.timer);
  }
  updatePairingState({
    status,
    active: false,
    timer: null,
    ...extra,
  });
  console.log(
    `[auto-pair] watcher exiting status=${status} attempts=${pairingBootstrap.attempts} ` +
    `approved=${pairingBootstrap.approvedCount} errors=${pairingBootstrap.errors} ` +
    `sawPending=${pairingBootstrap.sawPending} sawPaired=${pairingBootstrap.sawPaired}`
  );
}

async function runPairingBootstrapTick() {
  if (!pairingBootstrap.active) return;

  const now = Date.now();
  if (pairingBootstrap.startedAt && now - pairingBootstrap.startedAt >= AUTO_PAIR_TIMEOUT_MS) {
    finishPairingBootstrap("timeout", { lastError: "pairing bootstrap timed out" });
    return;
  }

  updatePairingState({ attempts: pairingBootstrap.attempts + 1 });

  const listResult = await execOpenClaw(["devices", "list", "--json"]);
  const devices = normalizeDeviceList(listResult.stdout);
  const hasPending = devices.pending.length > 0;
  const hasPaired = devices.paired.length > 0;
  const hasBrowserPaired = devices.paired.some(isBrowserDevice);

  if (!listResult.ok && !listResult.stdout.trim()) {
    updatePairingState({
      errors: pairingBootstrap.errors + 1,
      status: "error",
      lastError: listResult.stderr || listResult.error || "device list failed",
    });
  } else {
    updatePairingState({
      status: hasPending ? "pending" : hasBrowserPaired ? "paired" : hasPaired ? "paired-other-device" : "armed",
      sawPending: pairingBootstrap.sawPending || hasPending,
      sawPaired: pairingBootstrap.sawPaired || hasPaired,
      sawBrowserPaired: pairingBootstrap.sawBrowserPaired || hasBrowserPaired,
    });
  }

  let approvalsThisTick = 0;
  let lastApprovedDeviceId = "";
  if (hasPending) {
    updatePairingState({ status: "approving" });

    for (const pending of devices.pending) {
      const requestId = pending && typeof pending.requestId === "string" ? pending.requestId.trim() : "";
      if (!requestId) continue;

      const approveResult = await execOpenClaw(["devices", "approve", requestId, "--json"]);
      if (approvalSucceeded(approveResult.stdout)) {
        approvalsThisTick += 1;
        lastApprovedDeviceId = approvalDeviceId(approveResult.stdout) || lastApprovedDeviceId;
        console.log(
          `[auto-pair] approved request attempts=${pairingBootstrap.attempts} ` +
          `request=${approvalRequestId(approveResult.stdout) || requestId} device=${lastApprovedDeviceId || "unknown"}`
        );
        continue;
      }

      if ((approveResult.stdout || approveResult.stderr).trim()) {
        const noisy = !/no pending|no device|not paired|nothing to approve|unknown requestId/i.test(
          `${approveResult.stdout}\n${approveResult.stderr}`
        );
        if (noisy) {
          updatePairingState({
            errors: pairingBootstrap.errors + 1,
            lastError: approveResult.stderr || approveResult.stdout || approveResult.error || "approve failed",
          });
          console.warn(
            `[auto-pair] approve ${requestId} unexpected output attempts=${pairingBootstrap.attempts} ` +
            `errors=${pairingBootstrap.errors}: ${pairingBootstrap.lastError}`
          );
        }
      }
    }
  }

  if (approvalsThisTick > 0) {
    const nextApprovedCount = pairingBootstrap.approvedCount + approvalsThisTick;
    updatePairingState({
      approvedCount: nextApprovedCount,
      lastApprovalDeviceId: lastApprovedDeviceId || pairingBootstrap.lastApprovalDeviceId,
      lastApprovalAt: Date.now(),
      lastError: "",
      quietPolls: 0,
      status: "approved-pending-settle",
      sawPending: true,
    });
  } else {
    const quietPolls = pairingBootstrap.approvedCount > 0 ? pairingBootstrap.quietPolls + 1 : 0;
    updatePairingState({ quietPolls });

    if (
      pairingBootstrap.approvedCount === 0 &&
      !hasPending &&
      hasBrowserPaired &&
      quietPolls >= AUTO_PAIR_QUIET_POLLS
    ) {
      finishPairingBootstrap("paired", { sawBrowserPaired: true });
      return;
    }

    if (
      pairingBootstrap.approvedCount > 0 &&
      pairingBootstrap.lastApprovalAt > 0 &&
      Date.now() - pairingBootstrap.lastApprovalAt >= AUTO_PAIR_APPROVAL_SETTLE_MS &&
      hasBrowserPaired &&
      quietPolls >= AUTO_PAIR_QUIET_POLLS
    ) {
      finishPairingBootstrap("paired", { sawBrowserPaired: true });
      return;
    }

  }

  if (now - pairingBootstrap.heartbeatAt >= AUTO_PAIR_HEARTBEAT_MS) {
    updatePairingState({ heartbeatAt: now });
    console.log(
      `[auto-pair] heartbeat status=${pairingBootstrap.status} attempts=${pairingBootstrap.attempts} ` +
      `approved=${pairingBootstrap.approvedCount} errors=${pairingBootstrap.errors} ${summarizeDevices(devices)}`
    );
  }

  pairingBootstrap.timer = setTimeout(runPairingBootstrapTick, AUTO_PAIR_POLL_MS);
}

function startPairingBootstrap(reason, force = false) {
  if (pairingBootstrap.active) {
    return pairingSnapshot();
  }
  if (
    !force &&
    pairingBootstrap.status === "paired"
  ) {
    return pairingSnapshot();
  }
  updatePairingState({
    status: "armed",
    startedAt: Date.now(),
    approvedCount: 0,
    errors: 0,
    attempts: 0,
    quietPolls: 0,
    lastApprovalDeviceId: "",
    lastError: "",
    sawPending: false,
    sawPaired: false,
    sawBrowserPaired: false,
    active: true,
    heartbeatAt: 0,
    lastApprovalAt: 0,
  });
  console.log(`[auto-pair] watcher starting reason=${reason} timeout=${AUTO_PAIR_TIMEOUT_MS}ms poll=${AUTO_PAIR_POLL_MS}ms`);
  runPairingBootstrapTick().catch((error) => {
    finishPairingBootstrap("error", { lastError: error.message || String(error) });
  });
  return pairingSnapshot();
}

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

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function hasCriticalNavigatorRule(parsed) {
  const rule = parsed
    && parsed.network_policies
    && parsed.network_policies.allow_navigator_navigator_svc_cluster_local_8080;
  if (!rule || !Array.isArray(rule.endpoints) || !Array.isArray(rule.binaries)) {
    return false;
  }
  const hasEndpoint = rule.endpoints.some(
    (ep) => ep && ep.host === "navigator.navigator.svc.cluster.local" && Number(ep.port) === 8080
  );
  const hasBinary = rule.binaries.some((bin) => bin && bin.path === "/usr/bin/node");
  return hasEndpoint && hasBinary;
}

function policyStatusName(status) {
  switch (status) {
    case 1: return "PENDING";
    case 2: return "LOADED";
    case 3: return "FAILED";
    case 4: return "SUPERSEDED";
    default: return "UNSPECIFIED";
  }
}

function auditStartupPolicyFile() {
  let yaml;
  try {
    yaml = require("js-yaml");
  } catch (e) {
    console.warn(`[policy-proxy] startup audit skipped: js-yaml unavailable (${e.message})`);
    return;
  }

  let raw;
  try {
    raw = fs.readFileSync(POLICY_PATH, "utf8");
  } catch (e) {
    console.error(`[policy-proxy] startup audit failed: could not read ${POLICY_PATH}: ${e.message}`);
    return;
  }

  let parsed;
  try {
    parsed = yaml.load(raw);
  } catch (e) {
    console.error(`[policy-proxy] startup audit failed: YAML parse error in ${POLICY_PATH}: ${e.message}`);
    return;
  }

  const criticalRulePresent = hasCriticalNavigatorRule(parsed);
  console.log(
    `[policy-proxy] startup policy audit path=${POLICY_PATH} ` +
    `sha256=${sha256Hex(raw)} version=${parsed && parsed.version ? parsed.version : 0} ` +
    `critical_rule.allow_navigator_navigator_svc_cluster_local_8080=${criticalRulePresent}`
  );
}

function listSandboxPolicies(request) {
  return new Promise((resolve, reject) => {
    grpcClient.ListSandboxPolicies(request, (err, response) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(response);
    });
  });
}

function getSandboxPolicyStatus(request) {
  return new Promise((resolve, reject) => {
    grpcClient.GetSandboxPolicyStatus(request, (err, response) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(response);
    });
  });
}

async function auditNavigatorPolicyState() {
  if (!grpcEnabled || !grpcClient || grpcPermanentlyDisabled) {
    console.log(
      `[policy-proxy] startup navigator audit skipped: ` +
      `grpcEnabled=${grpcEnabled} grpcClient=${!!grpcClient} disabled=${grpcPermanentlyDisabled}`
    );
    return;
  }

  try {
    const listed = await listSandboxPolicies({ name: sandboxName, limit: 1, offset: 0 });
    const revision = listed && Array.isArray(listed.revisions) ? listed.revisions[0] : null;
    if (!revision) {
      console.log(`[policy-proxy] startup navigator audit: no policy revisions found for sandbox=${sandboxName}`);
      return;
    }

    const statusResp = await getSandboxPolicyStatus({ name: sandboxName, version: revision.version || 0 });
    console.log(
      `[policy-proxy] startup navigator audit sandbox=${sandboxName} ` +
      `latest_version=${revision.version || 0} latest_hash=${revision.policy_hash || ""} ` +
      `latest_status=${policyStatusName(revision.status)} active_version=${statusResp.active_version || 0}`
    );
  } catch (e) {
    console.warn(`[policy-proxy] startup navigator audit failed: ${e.message}`);
  }
}

function scheduleStartupAudit(attempt = 1) {
  const maxAttempts = 5;
  const delayMs = 1500;

  setTimeout(async () => {
    if (grpcEnabled && grpcClient && !grpcPermanentlyDisabled) {
      await auditNavigatorPolicyState();
      return;
    }

    if (attempt >= maxAttempts) {
      console.log(
        `[policy-proxy] startup navigator audit gave up after ${attempt} attempts ` +
        `(grpcEnabled=${grpcEnabled} grpcClient=${!!grpcClient} disabled=${grpcPermanentlyDisabled})`
      );
      return;
    }

    console.log(
      `[policy-proxy] startup navigator audit retry ${attempt}/${maxAttempts} ` +
      `(grpcEnabled=${grpcEnabled} grpcClient=${!!grpcClient} disabled=${grpcPermanentlyDisabled})`
    );
    scheduleStartupAudit(attempt + 1);
  }, delayMs);
}

// ---------------------------------------------------------------------------
// HTTP proxy helpers
// ---------------------------------------------------------------------------

function proxyRequest(clientReq, clientRes) {
  if (shouldLogProxyRequest(clientReq.method, clientReq.url || "/")) {
    console.log(`[policy-proxy] http in  ${formatRequestLine(clientReq)} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
  }
  const opts = {
    hostname: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: clientReq.headers,
  };

  const upstream = http.request(opts, (upstreamRes) => {
    if (shouldLogProxyResponse(clientReq.method, clientReq.url || "/", upstreamRes.statusCode || 0)) {
      console.log(
        `[policy-proxy] http out ${clientReq.method || "GET"} ${clientReq.url || "/"} ` +
        `status=${upstreamRes.statusCode || 0}`
      );
    }
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
  console.log(`[policy-proxy] policy get ${formatRequestLine(req)}`);
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
  console.log(`[policy-proxy] policy post ${formatRequestLine(req)}`);
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

function handlePairingBootstrap(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, pairingSnapshot());
    return;
  }

  if (req.method === "POST") {
    const snapshot = startPairingBootstrap("api", true);
    sendJson(res, 202, snapshot);
    return;
  }

  sendJson(res, 405, { error: "method not allowed" });
}

function shouldArmPairingFromRequest(req) {
  if (!req || !req.url) return false;
  if (req.method && req.method !== "GET") return false;
  if (req.url.startsWith("/api/")) return false;
  if (req.url.startsWith("/assets/")) return false;
  if (req.url === "/favicon.ico") return false;
  return true;
}

function sendJson(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.url === "/api/pairing-bootstrap") {
    handlePairingBootstrap(req, res);
    return;
  }

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

  if (shouldArmPairingFromRequest(req)) {
    startPairingBootstrap(`http:${req.url}`);
  }

  proxyRequest(req, res);
});

// WebSocket upgrade — pipe raw TCP to upstream
server.on("upgrade", (req, socket, head) => {
  startPairingBootstrap(`ws:${req.url || "/"}`);
  if (shouldLogProxyRequest(req.method, req.url || "/")) {
    console.log(`[policy-proxy] ws in    ${formatRequestLine(req)} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
  }
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
auditStartupPolicyFile();

server.listen(LISTEN_PORT, "127.0.0.1", () => {
  console.log(`[policy-proxy] Listening on 127.0.0.1:${LISTEN_PORT}, upstream 127.0.0.1:${UPSTREAM_PORT}`);
  scheduleStartupAudit();
});
