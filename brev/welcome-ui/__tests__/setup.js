// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Shared test utilities, fixtures, and mock helpers for the welcome-ui test suite.

const fs = require("fs");
const path = require("path");
const os = require("os");

const LOG_FILE = "/tmp/nemoclaw-sandbox-create.log";
const CACHE_FILE = "/tmp/nemoclaw-provider-config-cache.json";

function cleanTempFiles() {
  for (const f of [LOG_FILE, CACHE_FILE]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

function writeLogFile(content) {
  fs.writeFileSync(LOG_FILE, content, "utf-8");
}

function writeCacheFile(obj) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(obj), "utf-8");
}

function readCacheFile() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

// CLI output fixtures matching the nemoclaw CLI text format

const FIXTURES = {
  providerListOutput: "nvidia-inference\ncustom-provider\n",

  providerGetOutput: [
    "Id:              abc-123",
    "Name:            nvidia-inference",
    "Type:            openai",
    "Credential keys: OPENAI_API_KEY",
    "Config keys:     OPENAI_BASE_URL",
  ].join("\n"),

  providerGetNone: [
    "Id:              def-456",
    "Name:            empty-provider",
    "Type:            custom",
    "Credential keys: <none>",
    "Config keys:     <none>",
  ].join("\n"),

  providerGetAnsi:
    "\x1b[32mId:\x1b[0m              abc-123\n" +
    "\x1b[32mName:\x1b[0m            nvidia-inference\n" +
    "\x1b[32mType:\x1b[0m            openai\n" +
    "\x1b[32mCredential keys:\x1b[0m OPENAI_API_KEY\n" +
    "\x1b[32mConfig keys:\x1b[0m     OPENAI_BASE_URL\n",

  clusterInferenceOutput: [
    "Provider:  nvidia-inference",
    "Model:     meta/llama-3.1-70b-instruct",
    "Version:   2",
  ].join("\n"),

  clusterInferenceAnsi:
    "\x1b[1;34mProvider:\x1b[0m  nvidia-inference\n" +
    "\x1b[1;34mModel:\x1b[0m     meta/llama-3.1-70b-instruct\n" +
    "\x1b[1;34mVersion:\x1b[0m   2\n",

  policySyncSuccess: "Policy set for sandbox nemoclaw\nversion 3\nhash: deadbeef01234567\n",

  validPolicyYaml: [
    "version: 1",
    "inference:",
    "  model: gpt-4",
    "  provider: openai",
    "process:",
    "  run_as_user: sandbox",
    "  run_as_group: sandbox",
    "filesystem_policy:",
    "  include_workdir: true",
    "  read_only:",
    "    - /usr",
    "network_policies:",
    "  github:",
    "    name: github",
    "    endpoints:",
    "      - { host: github.com, port: 443 }",
  ].join("\n"),

  sampleApiKey: "nvapi-test-key-1234567890",
  sampleApiKey2: "sk-different-key-0987654321",

  gatewayLogWithToken:
    "Starting sandbox...\n" +
    "OpenClaw gateway starting in background.\n" +
    "  UI:    http://127.0.0.1:18789/?token=abc123XYZ\n",

  gatewayLogNoToken:
    "Starting sandbox...\n" +
    "OpenClaw gateway starting in background.\n" +
    "  UI:    http://127.0.0.1:18789/\n",
};

/**
 * Build a mock implementation for child_process.execFile that routes
 * commands to canned responses.
 *
 * @param {Object} routes - Map of "cmd subcommand..." → {stdout, stderr, code}
 * @returns {Function} Mock execFile(cmd, args, opts, cb)
 */
function buildExecFileMock(routes = {}) {
  return (cmd, args, opts, cb) => {
    if (typeof opts === "function") {
      cb = opts;
      opts = {};
    }
    const key = [cmd, ...(args || [])].join(" ");

    for (const [pattern, response] of Object.entries(routes)) {
      if (key.startsWith(pattern) || key === pattern) {
        const { stdout = "", stderr = "", code = 0 } = response;
        if (code !== 0) {
          const err = new Error(`Command failed: ${key}`);
          err.code = code;
          return cb(err, stdout, stderr);
        }
        return cb(null, stdout, stderr);
      }
    }
    cb(null, "", "");
  };
}

module.exports = {
  LOG_FILE,
  CACHE_FILE,
  cleanTempFiles,
  writeLogFile,
  writeCacheFile,
  readCacheFile,
  FIXTURES,
  buildExecFileMock,
};
