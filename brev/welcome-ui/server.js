#!/usr/bin/env node

// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// OpenShell Welcome UI — HTTP server with sandbox lifecycle APIs.
// Node.js port of server.py with added SSE log streaming.

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
let _execFile = require("child_process").execFile;
let _spawn = require("child_process").spawn;
const crypto = require("crypto");
const net = require("net");
const os = require("os");
const { URL } = require("url");
const { EventEmitter } = require("events");

let yaml;
try {
  yaml = require("js-yaml");
} catch {
  yaml = null;
}

// ── Configuration ──────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "8081", 10);
const ROOT = __dirname;
const REPO_ROOT = process.env.REPO_ROOT || path.join(ROOT, "..", "..");
const CLI_BIN = process.env.CLI_BIN || "openshell";
const SANDBOX_DIR = path.join(REPO_ROOT, "sandboxes", "nemoclaw");
const SANDBOX_NAME = process.env.SANDBOX_NAME || "nemoclaw";
const SANDBOX_START_CMD = process.env.SANDBOX_START_CMD || "nemoclaw-start";
const SANDBOX_BASE_IMAGE =
  process.env.SANDBOX_BASE_IMAGE ||
  "ghcr.io/nvidia/openshell-community/sandboxes/openclaw:latest";
const POLICY_FILE = path.join(SANDBOX_DIR, "policy.yaml");

const LOG_FILE = "/tmp/nemoclaw-sandbox-create.log";
const PROVIDER_CONFIG_CACHE = "/tmp/nemoclaw-provider-config-cache.json";
let _brevEnvId = process.env.BREV_ENV_ID || "";
let detectedBrevId = "";

const SANDBOX_PORT = 18789;

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

const OTHER_AGENTS_YAML = path.join(ROOT, "other-agents.yaml");

const COPY_BTN_SVG =
  '<svg viewBox="0 0 24 24">' +
  '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
  "</svg>";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

// ── Utility helpers ────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function stripAnsi(text) {
  return text.replace(ANSI_RE, "");
}

function log(prefix, msg) {
  const ts = new Date().toTimeString().slice(0, 8);
  process.stderr.write(`[${prefix} ${ts}] ${msg}\n`);
}

function logWelcome(msg) {
  process.stderr.write(`[welcome-ui] ${msg}\n`);
}

/**
 * Promise wrapper around child_process.execFile with timeout.
 * Returns { code, stdout, stderr }.
 */
function execCmd(args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const [cmd, ...rest] = args;
    _execFile(
      cmd,
      rest,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        let code = 0;
        if (err) {
          // err.code is a numeric exit code for process exits,
          // but a string error code (e.g. 'ENOENT') for spawn failures.
          code =
            typeof err.code === "number"
              ? err.code
              : err.killed
                ? -1
                : 1;
        }
        resolve({ code, stdout: stdout || "", stderr: stderr || "" });
      }
    );
  });
}

function cliArgs(...args) {
  return [CLI_BIN, ...args];
}

async function execFirstSuccess(commands, timeoutMs = 30000) {
  let lastResult = null;
  for (const args of commands) {
    const result = await execCmd(args, timeoutMs);
    if (result.code === 0) {
      return { ...result, args };
    }
    lastResult = { ...result, args };
  }
  return lastResult || { code: 1, stdout: "", stderr: "no command executed", args: [] };
}

function portOpen(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const cleanup = () => {
      sock.removeAllListeners();
      sock.destroy();
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => {
      cleanup();
      resolve(true);
    });
    sock.once("error", () => {
      cleanup();
      resolve(false);
    });
    sock.once("timeout", () => {
      cleanup();
      resolve(false);
    });
    sock.connect(port, host);
  });
}

async function getHostname() {
  try {
    const { code, stdout } = await execCmd(["hostname", "-f"], 5000);
    const h = stdout.trim();
    if (code === 0 && h) return h;
  } catch {
    // ignore
  }
  return os.hostname();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function readJsonBody(req) {
  return readBody(req).then((raw) => {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });
}

// ── Config cache ───────────────────────────────────────────────────────────

function readConfigCache() {
  try {
    return JSON.parse(fs.readFileSync(PROVIDER_CONFIG_CACHE, "utf-8"));
  } catch {
    return {};
  }
}

function writeConfigCache(cache) {
  try {
    fs.writeFileSync(PROVIDER_CONFIG_CACHE, JSON.stringify(cache));
  } catch {
    // ignore OSError
  }
}

function cacheProviderConfig(name, config) {
  const cache = readConfigCache();
  cache[name] = config;
  writeConfigCache(cache);
}

function removeCachedProvider(name) {
  const cache = readConfigCache();
  delete cache[name];
  writeConfigCache(cache);
}

function bootstrapConfigCache() {
  if (fs.existsSync(PROVIDER_CONFIG_CACHE)) return;
  writeConfigCache({
    "nvidia-inference": {
      OPENAI_BASE_URL: "https://inference-api.nvidia.com/v1",
    },
  });
  logWelcome("Bootstrapped provider config cache");
}

// ── State machines ─────────────────────────────────────────────────────────

const sandboxState = {
  status: "idle", // idle | creating | running | error
  pid: null,
  url: null,
  error: null,
};

const injectKeyState = {
  status: "idle", // idle | injecting | done | error
  error: null,
  keyHash: null,
};

// ── Brev ID detection & URL building ───────────────────────────────────────

function extractBrevId(host) {
  const m = (host || "").match(/^(\d+)-(.+?)\.brevlab\.com/);
  return m ? m[2] : "";
}

function maybeDetectBrevId(host) {
  if (!detectedBrevId) {
    const id = extractBrevId(host);
    if (id) detectedBrevId = id;
  }
}

function buildOpenclawUrl(token) {
  const brevId = _brevEnvId || detectedBrevId;
  let url;
  if (brevId) {
    url = `https://80810-${brevId}.brevlab.com/`;
  } else {
    url = `http://127.0.0.1:${PORT}/`;
  }
  if (token) url += `?token=${token}`;
  return url;
}

// ── Gateway readiness ──────────────────────────────────────────────────────

function gatewayLogReady() {
  try {
    const content = fs.readFileSync(LOG_FILE, "utf-8");
    return content.includes("OpenClaw gateway starting in background");
  } catch {
    return false;
  }
}

function readOpenclawToken() {
  try {
    const content = fs.readFileSync(LOG_FILE, "utf-8");
    const m = content.match(/token=([A-Za-z0-9_\-]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function sandboxReady() {
  if (sandboxState.status === "running") return true;
  if (
    sandboxState.status === "idle" ||
    sandboxState.status === "creating"
  ) {
    if (gatewayLogReady() && (await portOpen("127.0.0.1", SANDBOX_PORT))) {
      const token = readOpenclawToken();
      const url = buildOpenclawUrl(token);
      sandboxState.status = "running";
      sandboxState.url = url;
      return true;
    }
  }
  return false;
}

// ── SSE log streaming infrastructure ───────────────────────────────────────

const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(100);

// ── YAML template rendering ────────────────────────────────────────────────

function renderOtherAgentsModal() {
  if (!fs.existsSync(OTHER_AGENTS_YAML)) return null;
  if (!yaml) {
    logWelcome("js-yaml not installed; other-agents.yaml ignored");
    return null;
  }
  let data;
  try {
    data = yaml.load(fs.readFileSync(OTHER_AGENTS_YAML, "utf-8"));
  } catch (e) {
    logWelcome(`Failed to parse other-agents.yaml: ${e}`);
    return null;
  }

  const title = data.title || "Bring Your Own Agent";
  const intro = (data.intro || "").trim();
  const steps = data.steps || [];

  const bodyParts = [];
  if (intro) {
    bodyParts.push(
      `        <p class="modal__text">\n          ${intro}\n        </p>`
    );
  }

  steps.forEach((step, idx) => {
    const i = idx + 1;
    const stepTitle = step.title || "";
    const commands = step.commands || [];
    const copyable = !!step.copyable;
    const blockId = step.block_id || "";
    const copyBtnId = step.copy_button_id || "";
    const description = (step.description || "").trim();

    bodyParts.push("");
    bodyParts.push('        <div class="instructions-section">');
    bodyParts.push(
      `          <h4 class="instructions-section__title">${i}. ${stepTitle}</h4>`
    );

    const groups = [];
    for (const entry of commands) {
      const lines = [];
      if (typeof entry === "string") {
        lines.push(`<span class="cmd">${escapeHtml(entry)}</span>`);
      } else if (typeof entry === "object" && entry !== null) {
        const comment = entry.comment || "";
        const cmd = entry.cmd || "";
        const cmdId = entry.id || "";
        const idAttr = cmdId ? ` id="${cmdId}"` : "";
        if (comment) {
          lines.push(
            `<span class="comment"># ${escapeHtml(comment)}</span>`
          );
        }
        lines.push(`<span class="cmd"${idAttr}>${escapeHtml(cmd)}</span>`);
      }
      groups.push(lines.join("\n"));
    }

    const cmdHtml = groups.join("\n\n");

    let copyHtml = "";
    if (copyable) {
      if (copyBtnId) {
        copyHtml =
          `<button class="copy-btn" id="${copyBtnId}" ` +
          `aria-label="Copy">${COPY_BTN_SVG}</button>`;
      } else if (commands.length === 1) {
        const raw =
          typeof commands[0] === "string"
            ? commands[0]
            : (commands[0].cmd || "");
        copyHtml =
          `<button class="copy-btn" ` +
          `data-copy="${escapeHtml(raw)}" ` +
          `aria-label="Copy">${COPY_BTN_SVG}</button>`;
      } else {
        copyHtml =
          `<button class="copy-btn" ` +
          `aria-label="Copy">${COPY_BTN_SVG}</button>`;
      }
    }

    const blockIdAttr = blockId ? ` id="${blockId}"` : "";
    bodyParts.push(
      `          <div class="code-block"${blockIdAttr}>${cmdHtml}${copyHtml}</div>`
    );

    if (description) {
      bodyParts.push(
        `          <p class="modal__text" style="margin-top:10px">\n            ${description}\n          </p>`
      );
    }

    bodyParts.push("        </div>");
  });

  const bodyHtml = bodyParts.join("\n");

  return (
    `<div class="overlay" id="overlay-instructions" hidden>\n` +
    `    <div class="modal modal--wide">\n` +
    `      <div class="modal__header">\n` +
    `        <h3 class="modal__title">${title}</h3>\n` +
    `        <button class="modal__close" id="close-instructions">\n` +
    `          <svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>\n` +
    `        </button>\n` +
    `      </div>\n` +
    `      <div class="modal__body">\n` +
    `${bodyHtml}\n` +
    `      </div>\n` +
    `    </div>\n` +
    `  </div>`
  );
}

let renderedIndex = null;

function getRenderedIndex() {
  if (renderedIndex !== null) return renderedIndex;

  let template = fs.readFileSync(path.join(ROOT, "index.html"), "utf-8");
  const modalHtml = renderOtherAgentsModal();

  if (modalHtml) {
    template = template.replace("{{OTHER_AGENTS_MODAL}}", modalHtml);
    logWelcome("Rendered other-agents.yaml into index.html");
  } else {
    template = template.replace(
      "{{OTHER_AGENTS_MODAL}}",
      "<!-- other-agents.yaml not available -->"
    );
    logWelcome("WARNING: could not render other-agents.yaml");
  }

  renderedIndex = template;
  return renderedIndex;
}

// ── Policy management ──────────────────────────────────────────────────────

function stripPolicyFields(yamlText, extraFields = []) {
  const remove = new Set(["inference", ...extraFields]);

  if (yaml) {
    try {
      const doc = yaml.load(yamlText);
      if (doc && typeof doc === "object" && !Array.isArray(doc)) {
        for (const key of remove) delete doc[key];
        return yaml.dump(doc, { flowLevel: -1, sortKeys: false });
      }
    } catch {
      // fall through to line-based stripping
    }
  }

  // Line-based fallback (matches Python regex-based approach)
  const lines = yamlText.split(/\n/);
  const out = [];
  let skip = false;
  for (const line of lines) {
    const rawLine = line + "\n";
    let matched = false;
    for (const k of remove) {
      if (new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`).test(line)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      skip = true;
      continue;
    }
    if (skip && (line.startsWith(" ") || line.startsWith("\t") || line.trim() === "")) {
      continue;
    }
    skip = false;
    out.push(rawLine);
  }
  return out.join("");
}

async function generateGatewayPolicy() {
  if (!fs.existsSync(POLICY_FILE)) {
    logWelcome(`Policy file not found: ${POLICY_FILE}`);
    return null;
  }
  try {
    const raw = fs.readFileSync(POLICY_FILE, "utf-8");
    const stripped = stripPolicyFields(raw, ["process"]);
    const tmpPath = path.join(
      os.tmpdir(),
      `sandbox-policy-${process.pid}-${Date.now()}.yaml`
    );
    fs.writeFileSync(tmpPath, stripped);
    logWelcome(`Generated gateway policy from ${POLICY_FILE} → ${tmpPath}`);
    return tmpPath;
  } catch (e) {
    logWelcome(`Failed to generate gateway policy: ${e}`);
    return null;
  }
}

async function syncPolicyToGateway(yamlText, sandboxName = SANDBOX_NAME) {
  log("policy-sync", `step 2/4: stripping inference+process fields (${yamlText.length} bytes in)`);
  const stripped = stripPolicyFields(yamlText, ["process"]);
  log("policy-sync", `         stripped to ${stripped.length} bytes`);

  const tmpPath = path.join(
    os.tmpdir(),
    `policy-sync-${process.pid}-${Date.now()}.yaml`
  );
  try {
    fs.writeFileSync(tmpPath, stripped);
    const args = cliArgs("policy", "set", sandboxName, "--policy", tmpPath);
    log("policy-sync", `step 3/4: running ${args.join(" ")}`);

    const t0 = Date.now();
    const result = await execCmd(args, 30000);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    log("policy-sync", `         CLI exited ${result.code} in ${elapsed}s`);
    if (result.stdout.trim()) log("policy-sync", `         stdout: ${result.stdout.trim()}`);
    if (result.stderr.trim()) log("policy-sync", `         stderr: ${result.stderr.trim()}`);

    if (result.code !== 0) {
      const errMsg = (result.stderr || result.stdout || "unknown error").trim();
      log("policy-sync", `step 4/4: FAILED — ${errMsg}`);
      return { ok: false, error: errMsg };
    }

    const output = result.stdout + result.stderr;
    const verMatch = output.match(/version\s+(\d+)/);
    const hashMatch = output.match(/hash:\s*([a-f0-9]+)/);
    const version = verMatch ? parseInt(verMatch[1], 10) : 0;
    const policyHash = hashMatch ? hashMatch[1] : "";
    log("policy-sync", `step 4/4: SUCCESS — version=${version} hash=${policyHash}`);
    return { ok: true, applied: true, version, policy_hash: policyHash };
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  }
}

// ── Sandbox lifecycle ──────────────────────────────────────────────────────

async function cleanupExistingSandbox() {
  try {
    await execCmd(cliArgs("sandbox", "delete", SANDBOX_NAME), 30000);
  } catch {
    // ignore
  }
}

async function ensureSandboxBaseImage() {
  logWelcome(`Pre-pulling sandbox base image: ${SANDBOX_BASE_IMAGE}`);
  const result = await execCmd(["docker", "pull", SANDBOX_BASE_IMAGE], 300000);
  if (result.code !== 0) {
    const errMsg = (result.stderr || result.stdout || "docker pull failed").trim();
    logWelcome(`Base image pull failed: ${errMsg}`);
    return { ok: false, error: errMsg };
  }
  logWelcome(`Base image available locally: ${SANDBOX_BASE_IMAGE}`);
  return { ok: true };
}

function runSandboxCreate() {
  sandboxState.status = "creating";
  sandboxState.error = null;
  sandboxState.url = null;

  (async () => {
    try {
      await cleanupExistingSandbox();

      const baseImage = await ensureSandboxBaseImage();
      if (!baseImage.ok) {
        sandboxState.status = "error";
        sandboxState.error =
          `Sandbox base image pull failed. ${baseImage.error}`;
        return;
      }

      const chatUiUrl = buildOpenclawUrl(null);
      const policyPath = await generateGatewayPolicy();

      const cmd = [
        CLI_BIN, "sandbox", "create",
        "--name", SANDBOX_NAME,
        "--from", SANDBOX_DIR,
        "--forward", "18789",
      ];
      if (policyPath) cmd.push("--policy", policyPath);
      cmd.push(
        "--",
        "env",
        `CHAT_UI_URL=${chatUiUrl}`,
        SANDBOX_START_CMD
      );

      const cmdDisplay = cmd.slice(0, 8).join(" ") + " -- ...";
      logWelcome(`Running: ${cmdDisplay}`);

      const logFd = fs.openSync(LOG_FILE, "w");
      const proc = _spawn(cmd[0], cmd.slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
        env: process.env,
      });

      sandboxState.pid = proc.pid;

      // Merge stderr into stdout stream handling
      const handleData = (chunk) => {
        const text = chunk.toString("utf-8");
        try {
          fs.writeSync(logFd, text);
        } catch {
          // ignore
        }
        process.stderr.write(`[sandbox] ${text}`);
        logEmitter.emit("data", text);
      };

      proc.stdout.on("data", handleData);
      proc.stderr.on("data", handleData);

      proc.on("close", async (code) => {
        try {
          fs.closeSync(logFd);
        } catch {
          // ignore
        }

        if (policyPath) {
          try {
            fs.unlinkSync(policyPath);
          } catch {
            // ignore
          }
        }

        if (code !== 0) {
          let errMsg = `Process exited with code ${code}`;
          try {
            const logContent = fs.readFileSync(LOG_FILE, "utf-8");
            errMsg = logContent.slice(-2000);
          } catch {
            // ignore
          }
          sandboxState.status = "error";
          sandboxState.error = errMsg;
          return;
        }

        // Poll for readiness with 120s deadline
        const deadline = Date.now() + 120000;
        while (Date.now() < deadline) {
          if (
            gatewayLogReady() &&
            (await portOpen("127.0.0.1", 18789))
          ) {
            let token = readOpenclawToken();
            if (token === null) {
              for (let i = 0; i < 5; i++) {
                await sleep(1000);
                token = readOpenclawToken();
                if (token !== null) break;
              }
            }
            const url = buildOpenclawUrl(token);
            sandboxState.status = "running";
            sandboxState.url = url;
            return;
          }
          await sleep(3000);
        }

        sandboxState.status = "error";
        sandboxState.error =
          "Timed out waiting for OpenClaw gateway on port 18789";
      });

      proc.on("error", (err) => {
        try {
          fs.closeSync(logFd);
        } catch {
          // ignore
        }
        sandboxState.status = "error";
        sandboxState.error = err.message;
      });

      // Unref so the spawned process doesn't prevent Node from exiting
      // if the server is shut down (mirroring daemon=True in Python).
      proc.unref();
    } catch (e) {
      sandboxState.status = "error";
      sandboxState.error = e.message;
    }
  })();
}

// ── Key injection ──────────────────────────────────────────────────────────

function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function runInjectKey(key, keyHash) {
  log("inject-key", `step 1/3: received key (hash=${keyHash.slice(0, 12)}…)`);

  const args = [
    ...cliArgs("provider", "update", "nvidia-inference"),
    "--credential", `OPENAI_API_KEY=${key}`,
    "--config", "OPENAI_BASE_URL=https://inference-api.nvidia.com/v1",
  ];
  log("inject-key", `step 2/3: running ${CLI_BIN} provider update nvidia-inference …`);

  const t0 = Date.now();
  execCmd(args, 120000)
    .then((result) => {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      log("inject-key", `         CLI exited ${result.code} in ${elapsed}s`);
      if (result.stdout.trim()) log("inject-key", `         stdout: ${result.stdout.trim()}`);
      if (result.stderr.trim()) log("inject-key", `         stderr: ${result.stderr.trim()}`);

      if (result.code !== 0) {
        const err = (result.stderr || result.stdout || "unknown error").trim();
        log("inject-key", `step 3/3: FAILED — ${err}`);
        injectKeyState.status = "error";
        injectKeyState.error = err;
        return;
      }

      log("inject-key", "step 3/3: SUCCESS — provider nvidia-inference updated");
      cacheProviderConfig("nvidia-inference", {
        OPENAI_BASE_URL: "https://inference-api.nvidia.com/v1",
      });
      injectKeyState.status = "done";
      injectKeyState.error = null;
      injectKeyState.keyHash = keyHash;
    })
    .catch((e) => {
      log("inject-key", `step 3/3: EXCEPTION — ${e}`);
      injectKeyState.status = "error";
      injectKeyState.error = String(e);
    });
}

// ── Provider CRUD ──────────────────────────────────────────────────────────

function parseProviderDetail(stdout) {
  const info = {};
  for (const line of stdout.split("\n")) {
    const stripped = stripAnsi(line).trim();
    if (stripped.startsWith("Id:")) {
      info.id = stripped.split(":").slice(1).join(":").trim();
    } else if (stripped.startsWith("Name:")) {
      info.name = stripped.split(":").slice(1).join(":").trim();
    } else if (stripped.startsWith("Type:")) {
      info.type = stripped.split(":").slice(1).join(":").trim();
    } else if (stripped.startsWith("Credential keys:")) {
      const raw = stripped.split(":").slice(1).join(":").trim();
      info.credentialKeys =
        raw && raw !== "<none>"
          ? raw.split(",").map((k) => k.trim()).filter(Boolean)
          : [];
    } else if (stripped.startsWith("Config keys:")) {
      const raw = stripped.split(":").slice(1).join(":").trim();
      info.configKeys =
        raw && raw !== "<none>"
          ? raw.split(",").map((k) => k.trim()).filter(Boolean)
          : [];
    }
  }
  return info.name ? info : null;
}

async function handleProvidersList(req, res) {
  let names;
  try {
    const result = await execCmd(
      cliArgs("provider", "list", "--names"),
      30000
    );
    if (result.code !== 0) {
      return jsonResponse(res, 502, {
        ok: false,
        error: (result.stderr || result.stdout || "provider list failed").trim(),
      });
    }
    names = result.stdout.trim().split("\n").map((n) => n.trim()).filter(Boolean);
  } catch (e) {
    return jsonResponse(res, 502, { ok: false, error: String(e) });
  }

  const providers = [];
  const configCache = readConfigCache();
  for (const name of names) {
    try {
      const detail = await execCmd(
        cliArgs("provider", "get", name),
        30000
      );
      if (detail.code === 0) {
        const parsed = parseProviderDetail(detail.stdout);
        if (parsed) {
          const cached = configCache[name];
          if (cached) parsed.configValues = cached;
          providers.push(parsed);
        }
      }
    } catch {
      // skip
    }
  }
  return jsonResponse(res, 200, { ok: true, providers });
}

async function handleProviderCreate(req, res) {
  const data = await readJsonBody(req);
  if (!data) {
    return jsonResponse(res, 400, {
      ok: false,
      error: "invalid or empty JSON body",
    });
  }

  const name = (data.name || "").trim();
  const ptype = (data.type || "").trim();
  if (!name || !ptype) {
    return jsonResponse(res, 400, {
      ok: false,
      error: "name and type are required",
    });
  }

  const cmd = [...cliArgs("provider", "create"), "--name", name, "--type", ptype];
  const creds = data.credentials || {};
  const configs = data.config || {};
  if (Object.keys(creds).length === 0) {
    cmd.push("--credential", "PLACEHOLDER=unused");
  }
  for (const [k, v] of Object.entries(creds)) {
    cmd.push("--credential", `${k}=${v}`);
  }
  for (const [k, v] of Object.entries(configs)) {
    cmd.push("--config", `${k}=${v}`);
  }

  try {
    const result = await execCmd(cmd, 30000);
    if (result.code !== 0) {
      const err = (result.stderr || result.stdout || "create failed").trim();
      return jsonResponse(res, 400, { ok: false, error: err });
    }
    if (Object.keys(configs).length > 0) cacheProviderConfig(name, configs);
    return jsonResponse(res, 200, { ok: true });
  } catch (e) {
    return jsonResponse(res, 502, { ok: false, error: String(e) });
  }
}

async function handleProviderUpdate(req, res, name) {
  const data = await readJsonBody(req);
  if (!data) {
    return jsonResponse(res, 400, {
      ok: false,
      error: "invalid or empty JSON body",
    });
  }

  const ptype = (data.type || "").trim();
  const cmd = [...cliArgs("provider", "update"), name];
  for (const [k, v] of Object.entries(data.credentials || {})) {
    cmd.push("--credential", `${k}=${v}`);
  }
  const configs = data.config || {};
  for (const [k, v] of Object.entries(configs)) {
    cmd.push("--config", `${k}=${v}`);
  }

  try {
    const result = await execCmd(cmd, 30000);
    if (result.code === 0) {
      if (Object.keys(configs).length > 0) cacheProviderConfig(name, configs);
      return jsonResponse(res, 200, { ok: true });
    }

    if (!ptype) {
      const err = (result.stderr || result.stdout || "update failed").trim();
      return jsonResponse(res, 400, { ok: false, error: err });
    }

    await execCmd(cliArgs("provider", "delete", name), 30000);
    const createCmd = [...cliArgs("provider", "create"), "--name", name, "--type", ptype];
    for (const [k, v] of Object.entries(data.credentials || {})) {
      createCmd.push("--credential", `${k}=${v}`);
    }
    for (const [k, v] of Object.entries(configs)) {
      createCmd.push("--config", `${k}=${v}`);
    }
    const recreated = await execCmd(createCmd, 30000);
    if (recreated.code !== 0) {
      const err = (recreated.stderr || recreated.stdout || "update failed").trim();
      return jsonResponse(res, 400, { ok: false, error: err });
    }
    if (Object.keys(configs).length > 0) cacheProviderConfig(name, configs);
    return jsonResponse(res, 200, { ok: true });
  } catch (e) {
    return jsonResponse(res, 502, { ok: false, error: String(e) });
  }
}

async function handleProviderDelete(req, res, name) {
  try {
    const result = await execCmd(cliArgs("provider", "delete", name), 30000);
    if (result.code !== 0) {
      const err = (result.stderr || result.stdout || "delete failed").trim();
      return jsonResponse(res, 400, { ok: false, error: err });
    }
    removeCachedProvider(name);
    return jsonResponse(res, 200, { ok: true });
  } catch (e) {
    return jsonResponse(res, 502, { ok: false, error: String(e) });
  }
}

// ── Cluster inference ──────────────────────────────────────────────────────

function parseClusterInference(stdout) {
  const fields = {};
  for (const line of stdout.split("\n")) {
    const stripped = stripAnsi(line).trim();
    for (const key of ["Provider:", "Model:", "Version:"]) {
      if (stripped.startsWith(key)) {
        fields[key.replace(":", "")] = stripped.slice(key.length).trim();
      }
    }
  }
  if (!("Provider" in fields)) return null;
  let version = 0;
  try {
    version = parseInt(fields.Version || "0", 10);
    if (isNaN(version)) version = 0;
  } catch {
    // ignore
  }
  return {
    providerName: fields.Provider,
    modelId: fields.Model || "",
    version,
  };
}

async function handleClusterInferenceGet(req, res) {
  try {
    const result = await execFirstSuccess(
      [
        cliArgs("inference", "get"),
        cliArgs("cluster", "inference", "get"),
      ],
      30000
    );
    if (result.code !== 0) {
      const stderr = (result.stderr || "").trim();
      if (
        stderr.toLowerCase().includes("not configured") ||
        stderr.toLowerCase().includes("not found")
      ) {
        return jsonResponse(res, 200, {
          ok: true,
          providerName: null,
          modelId: "",
          version: 0,
        });
      }
      const err = stderr || (result.stdout || "get failed").trim();
      return jsonResponse(res, 400, { ok: false, error: err });
    }
    const parsed = parseClusterInference(result.stdout);
    if (!parsed) {
      return jsonResponse(res, 200, {
        ok: true,
        providerName: null,
        modelId: "",
        version: 0,
      });
    }
    return jsonResponse(res, 200, { ok: true, ...parsed });
  } catch (e) {
    return jsonResponse(res, 502, { ok: false, error: String(e) });
  }
}

async function handleClusterInferenceSet(req, res) {
  const body = await readJsonBody(req);
  if (body === null) {
    return jsonResponse(res, 400, { ok: false, error: "invalid JSON body" });
  }
  const providerName = (body.providerName || "").trim();
  const modelId = (body.modelId || "").trim();
  if (!providerName) {
    return jsonResponse(res, 400, {
      ok: false,
      error: "providerName is required",
    });
  }
  if (!modelId) {
    return jsonResponse(res, 400, {
      ok: false,
      error: "modelId is required",
    });
  }
  try {
    const result = await execFirstSuccess(
      [
        cliArgs("inference", "set", "--provider", providerName, "--model", modelId),
        cliArgs("cluster", "inference", "set", "--provider", providerName, "--model", modelId),
      ],
      30000
    );
    if (result.code !== 0) {
      const err = (result.stderr || result.stdout || "set failed").trim();
      return jsonResponse(res, 400, { ok: false, error: err });
    }
    const parsed = parseClusterInference(result.stdout);
    const resp = { ok: true };
    if (parsed) Object.assign(resp, parsed);
    return jsonResponse(res, 200, resp);
  } catch (e) {
    return jsonResponse(res, 502, { ok: false, error: String(e) });
  }
}

// ── Reverse proxy (HTTP) ───────────────────────────────────────────────────

function proxyToSandbox(clientReq, clientRes) {
  const headers = {};
  for (const [key, val] of Object.entries(clientReq.headers)) {
    if (key.toLowerCase() === "host") continue;
    headers[key] = val;
  }
  headers["host"] = `127.0.0.1:${SANDBOX_PORT}`;

  const opts = {
    hostname: "127.0.0.1",
    port: SANDBOX_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers,
    timeout: 120000,
  };

  const upstream = http.request(opts, (upstreamRes) => {
    // Filter hop-by-hop + content-length (we'll set our own)
    const outHeaders = {};
    for (const [key, val] of Object.entries(upstreamRes.headers)) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      if (key.toLowerCase() === "content-length") continue;
      outHeaders[key] = val;
    }

    // Buffer the full response to get accurate Content-Length
    // (mirrors the Python behavior)
    const chunks = [];
    upstreamRes.on("data", (c) => chunks.push(c));
    upstreamRes.on("end", () => {
      const body = Buffer.concat(chunks);
      outHeaders["content-length"] = String(body.length);
      clientRes.writeHead(upstreamRes.statusCode, outHeaders);
      clientRes.end(body);
    });
  });

  upstream.on("error", (err) => {
    logWelcome(`proxy error: ${err.message}`);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "Content-Type": "text/plain" });
    }
    clientRes.end("Sandbox unavailable");
  });

  upstream.on("timeout", () => {
    upstream.destroy(new Error("upstream timeout"));
  });

  clientReq.pipe(upstream);
}

// ── Reverse proxy (WebSocket) ──────────────────────────────────────────────

function proxyWebSocket(req, clientSocket, head) {
  const upstream = net.createConnection(
    { host: "127.0.0.1", port: SANDBOX_PORT },
    () => {
      // Reconstruct the HTTP upgrade request
      let reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      let headers = "";
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const key = req.rawHeaders[i];
        const val = req.rawHeaders[i + 1];
        if (key.toLowerCase() === "host") {
          headers += `Host: 127.0.0.1:${SANDBOX_PORT}\r\n`;
        } else {
          headers += `${key}: ${val}\r\n`;
        }
      }
      upstream.write(reqLine + headers + "\r\n");
      if (head && head.length) upstream.write(head);

      // Bidirectional pipe
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    }
  );

  upstream.on("error", (err) => {
    logWelcome(`websocket upstream error: ${err.message}`);
    clientSocket.destroy();
  });

  clientSocket.on("error", (err) => {
    logWelcome(`websocket client error: ${err.message}`);
    upstream.destroy();
  });
}

// ── API endpoint handlers ──────────────────────────────────────────────────

async function handleSandboxStatus(req, res) {
  // Side-effect: may transition sandbox state
  const state = { ...sandboxState };
  if (
    (state.status === "creating" || state.status === "idle") &&
    gatewayLogReady() &&
    (await portOpen("127.0.0.1", SANDBOX_PORT))
  ) {
    const token = readOpenclawToken();
    const url = buildOpenclawUrl(token);
    sandboxState.status = "running";
    sandboxState.url = url;
    state.status = "running";
    state.url = url;
  }

  const keyInjected = injectKeyState.status === "done";
  const keyInjectError = injectKeyState.error || null;

  return jsonResponse(res, 200, {
    status: state.status,
    url: state.url || null,
    error: state.error || null,
    key_injected: keyInjected,
    key_inject_error: keyInjectError,
  });
}

async function handleInstallOpenclaw(req, res) {
  if (sandboxState.status === "creating") {
    return jsonResponse(res, 409, {
      ok: false,
      error: "Sandbox is already being created",
    });
  }
  if (sandboxState.status === "running") {
    return jsonResponse(res, 409, {
      ok: false,
      error: "Sandbox is already running",
    });
  }

  maybeDetectBrevId(req.headers.host || "");
  runSandboxCreate();
  return jsonResponse(res, 200, { ok: true });
}

async function handlePolicySync(req, res) {
  const origin = req.headers.origin || "unknown";
  log("policy-sync", `── POST /api/policy-sync received (origin=${origin})`);
  log("policy-sync", "step 1/4: reading request body");

  const body = await readBody(req);
  if (!body) {
    log("policy-sync", "         REJECTED: empty body");
    return jsonResponse(res, 400, { ok: false, error: "empty body" });
  }
  log("policy-sync", `         received ${body.length} bytes`);

  if (!body.includes("version:")) {
    log("policy-sync", "         REJECTED: missing version field");
    return jsonResponse(res, 400, {
      ok: false,
      error: "invalid policy: missing version field",
    });
  }

  const result = await syncPolicyToGateway(body);
  const status = result.ok ? 200 : 502;
  log("policy-sync", `── responding ${status}: ${JSON.stringify(result)}`);
  return jsonResponse(res, status, result);
}

async function handleInjectKey(req, res) {
  const body = await readBody(req);
  if (!body) {
    return jsonResponse(res, 400, { ok: false, error: "empty body" });
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return jsonResponse(res, 400, { ok: false, error: "invalid JSON" });
  }

  const key = (data.key || "").trim();
  if (!key) {
    return jsonResponse(res, 400, { ok: false, error: "missing key" });
  }

  const keyH = hashKey(key);

  if (injectKeyState.status === "done" && injectKeyState.keyHash === keyH) {
    return jsonResponse(res, 200, { ok: true, already: true });
  }
  if (injectKeyState.status === "injecting" && injectKeyState.keyHash === keyH) {
    return jsonResponse(res, 202, { ok: true, started: true });
  }

  injectKeyState.status = "injecting";
  injectKeyState.error = null;
  injectKeyState.keyHash = keyH;

  runInjectKey(key, keyH);
  return jsonResponse(res, 202, { ok: true, started: true });
}

async function handleConnectionDetails(req, res) {
  const hostname = await getHostname();
  const brevId = _brevEnvId || detectedBrevId;
  const gatewayUrl = brevId
    ? `https://8080-${brevId}.brevlab.com`
    : `http://${hostname}:8080`;

  return jsonResponse(res, 200, {
    hostname,
    gatewayUrl,
    gatewayPort: 8080,
    instructions: {
      install:
        "curl -fsSL https://github.com/NVIDIA/OpenShell/releases/download/devel/install.sh | sh",
      connect: `openshell gateway add ${gatewayUrl}`,
      createSandbox: "openshell sandbox create -- claude",
      tui: "openshell term",
    },
  });
}

// ── SSE log streaming ──────────────────────────────────────────────────────

function handleSandboxLogs(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Send any existing log content
  try {
    const existing = fs.readFileSync(LOG_FILE, "utf-8");
    if (existing) {
      for (const line of existing.split("\n")) {
        res.write(`data: ${line}\n\n`);
      }
    }
  } catch {
    // no log file yet
  }

  // Stream new lines as they arrive from the subprocess
  const onData = (text) => {
    for (const line of text.split("\n")) {
      if (line) res.write(`data: ${line}\n\n`);
    }
  };

  logEmitter.on("data", onData);

  // Watch the log file for changes from other sources
  let watcher = null;
  let lastSize = 0;
  try {
    lastSize = fs.statSync(LOG_FILE).size;
  } catch {
    // file may not exist yet
  }

  const watchIfExists = () => {
    if (watcher) return;
    try {
      if (!fs.existsSync(LOG_FILE)) return;
      watcher = fs.watch(LOG_FILE, () => {
        try {
          const stat = fs.statSync(LOG_FILE);
          if (stat.size > lastSize) {
            const fd = fs.openSync(LOG_FILE, "r");
            const buf = Buffer.alloc(stat.size - lastSize);
            fs.readSync(fd, buf, 0, buf.length, lastSize);
            fs.closeSync(fd);
            lastSize = stat.size;
            const text = buf.toString("utf-8");
            for (const line of text.split("\n")) {
              if (line) res.write(`data: ${line}\n\n`);
            }
          }
        } catch {
          // ignore read errors
        }
      });
    } catch {
      // ignore watch errors
    }
  };

  watchIfExists();
  const watchPoll = setInterval(watchIfExists, 2000);

  req.on("close", () => {
    logEmitter.removeListener("data", onData);
    clearInterval(watchPoll);
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  });
}

// ── Response helpers ───────────────────────────────────────────────────────

function setDefaultHeaders(res) {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function jsonResponse(res, status, body) {
  const raw = JSON.stringify(body);
  setDefaultHeaders(res);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

function serveTemplatedIndex(req, res) {
  const content = Buffer.from(getRenderedIndex(), "utf-8");
  setDefaultHeaders(res);
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": content.length,
  });
  if (req.method !== "HEAD") {
    res.end(content);
  } else {
    res.end();
  }
}

function serveStaticFile(req, res, pathname) {
  // Security: reject path traversal
  if (pathname.includes("..")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const filePath = path.join(ROOT, pathname);
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      setDefaultHeaders(res);
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        setDefaultHeaders(res);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
        return;
      }
      setDefaultHeaders(res);
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": data.length,
      });
      if (req.method !== "HEAD") {
        res.end(data);
      } else {
        res.end();
      }
    });
  });
}

// ── Master routing ─────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  maybeDetectBrevId(req.headers.host || "");

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // OPTIONS → CORS preflight
  if (method === "OPTIONS") {
    setDefaultHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // API routes (always handled locally, even when sandbox is ready)
  if (pathname === "/api/sandbox-status" && method === "GET") {
    return handleSandboxStatus(req, res);
  }
  if (pathname === "/api/connection-details" && method === "GET") {
    return handleConnectionDetails(req, res);
  }
  if (pathname === "/api/install-openclaw" && method === "POST") {
    return handleInstallOpenclaw(req, res);
  }
  if (pathname === "/api/policy-sync" && method === "POST") {
    return handlePolicySync(req, res);
  }
  if (pathname === "/api/inject-key" && method === "POST") {
    return handleInjectKey(req, res);
  }
  if (pathname === "/api/providers" && method === "GET") {
    return handleProvidersList(req, res);
  }
  if (pathname === "/api/providers" && method === "POST") {
    return handleProviderCreate(req, res);
  }
  if (/^\/api\/providers\/[\w-]+$/.test(pathname) && method === "PUT") {
    const name = pathname.split("/").pop();
    return handleProviderUpdate(req, res, name);
  }
  if (/^\/api\/providers\/[\w-]+$/.test(pathname) && method === "DELETE") {
    const name = pathname.split("/").pop();
    return handleProviderDelete(req, res, name);
  }
  if (pathname === "/api/cluster-inference" && method === "GET") {
    return handleClusterInferenceGet(req, res);
  }
  if (pathname === "/api/cluster-inference" && method === "POST") {
    return handleClusterInferenceSet(req, res);
  }
  if (pathname === "/api/sandbox-logs" && method === "GET") {
    return handleSandboxLogs(req, res);
  }

  // If sandbox is ready, proxy everything else to the sandbox
  if (await sandboxReady()) {
    return proxyToSandbox(req, res);
  }

  // Welcome UI mode: serve static files
  if (method === "GET" || method === "HEAD") {
    if (pathname === "" || pathname === "/" || pathname === "/index.html") {
      return serveTemplatedIndex(req, res);
    }
    return serveStaticFile(req, res, pathname);
  }

  // Fallback
  setDefaultHeaders(res);
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
}

// ── Server setup ───────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    logWelcome(`Unhandled error: ${err.stack || err}`);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
    }
    res.end("Internal Server Error");
  });
});

// WebSocket upgrade handler — checked BEFORE route matching (mirrors Python)
server.on("upgrade", async (req, socket, head) => {
  maybeDetectBrevId(req.headers.host || "");

  if (await sandboxReady()) {
    proxyWebSocket(req, socket, head);
  } else {
    socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  }
});

function _resetForTesting() {
  sandboxState.status = "idle";
  sandboxState.pid = null;
  sandboxState.url = null;
  sandboxState.error = null;
  injectKeyState.status = "idle";
  injectKeyState.error = null;
  injectKeyState.keyHash = null;
  detectedBrevId = "";
  _brevEnvId = "";
  renderedIndex = null;
}

function _setMocksForTesting(mocks) {
  if (mocks.execFile) _execFile = mocks.execFile;
  if (mocks.spawn) _spawn = mocks.spawn;
  if ("brevEnvId" in mocks) _brevEnvId = mocks.brevEnvId;
}

if (require.main === module) {
  bootstrapConfigCache();
  server.listen(PORT, "", () => {
    console.log(`OpenShell Welcome UI -> http://localhost:${PORT}`);
  });
}

module.exports = {
  server,
  sandboxState,
  injectKeyState,
  stripAnsi,
  escapeHtml,
  extractBrevId,
  maybeDetectBrevId,
  buildOpenclawUrl,
  hashKey,
  parseProviderDetail,
  parseClusterInference,
  stripPolicyFields,
  renderOtherAgentsModal,
  getRenderedIndex,
  readConfigCache,
  writeConfigCache,
  cacheProviderConfig,
  removeCachedProvider,
  bootstrapConfigCache,
  gatewayLogReady,
  readOpenclawToken,
  logEmitter,
  SANDBOX_PORT,
  PORT,
  _resetForTesting,
  _setMocksForTesting,
};
