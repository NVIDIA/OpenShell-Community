# OpenShell Welcome UI — `server.py` Complete Architecture Reference

> **Purpose:** This document provides an exhaustive, implementation-level description of `server.py` so that a software engineer can faithfully recreate it in Node.js with log-streaming support. Every endpoint, state machine, threading model, edge case, and dependency is documented.

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Configuration & Environment Variables](#2-configuration--environment-variables)
3. [Server Bootstrap & Lifecycle](#3-server-bootstrap--lifecycle)
4. [Routing System](#4-routing-system)
5. [State Machines](#5-state-machines)
6. [API Endpoints — Complete Reference](#6-api-endpoints--complete-reference)
7. [Reverse Proxy (HTTP + WebSocket)](#7-reverse-proxy-http--websocket)
8. [Template Rendering System (YAML → HTML)](#8-template-rendering-system-yaml--html)
9. [Policy Management Pipeline](#9-policy-management-pipeline)
10. [Provider CRUD System](#10-provider-crud-system)
11. [Cluster Inference Management](#11-cluster-inference-management)
12. [Caching Layer](#12-caching-layer)
13. [Brev Integration & URL Building](#13-brev-integration--url-building)
14. [Threading Model](#14-threading-model)
15. [Frontend Contract (app.js)](#15-frontend-contract-appjs)
16. [External CLI Dependencies](#16-external-cli-dependencies)
17. [File Dependencies & Paths](#17-file-dependencies--paths)
18. [Gotchas, Edge Cases & Migration Warnings](#18-gotchas-edge-cases--migration-warnings)
19. [Node.js Migration Checklist](#19-nodejs-migration-checklist)

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            BROWSER (User)                                       │
│                                                                                 │
│   index.html + app.js + styles.css                                              │
│     │                                                                           │
│     │  fetch() / WebSocket                                                      │
│     ▼                                                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   welcome-ui server.py (port 8081)                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐       │
│   │                                                                     │       │
│   │  ┌──────────┐  ┌──────────────┐  ┌──────────────────────┐         │       │
│   │  │  Static   │  │  API Layer   │  │  Reverse Proxy       │         │       │
│   │  │  Files    │  │              │  │  (HTTP + WebSocket)   │         │       │
│   │  │          │  │  9 endpoints  │  │                      │         │       │
│   │  │ index.html│  │  + CORS      │  │  → localhost:18789   │         │       │
│   │  │ app.js   │  │  + JSON I/O  │  │    (sandbox)         │         │       │
│   │  │ styles.css│  │              │  │                      │         │       │
│   │  └──────────┘  └──────┬───────┘  └──────────┬───────────┘         │       │
│   │                       │                      │                     │       │
│   │                       ▼                      ▼                     │       │
│   │              ┌────────────────┐    ┌──────────────────────┐       │       │
│   │              │ nemoclaw CLI   │    │ sandbox container     │       │       │
│   │              │ (subprocess)   │    │                      │       │       │
│   │              │                │    │ policy-proxy.js:18789│       │       │
│   │              │ • sandbox      │    │   ↓                  │       │       │
│   │              │ • provider     │    │ openclaw gw:18788    │       │       │
│   │              │ • policy       │    │                      │       │       │
│   │              │ • cluster      │    └──────────────────────┘       │       │
│   │              └────────────────┘                                    │       │
│   │                                                                     │       │
│   └─────────────────────────────────────────────────────────────────────┘       │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Dual-Mode Behavior

The server operates in **two distinct modes** depending on sandbox readiness:

```
┌─────────────────────────────────────────────────────────────┐
│                    REQUEST ARRIVES                            │
│                         │                                    │
│                         ▼                                    │
│               Is sandbox ready?                              │
│              (status == "running"                             │
│               OR gateway log sentinel found                  │
│               AND port 18789 is open)                        │
│                    │          │                               │
│                   YES         NO                              │
│                    │          │                               │
│                    ▼          ▼                               │
│          ┌─────────────┐  ┌───────────────────┐             │
│          │ PROXY MODE  │  │ WELCOME UI MODE   │             │
│          │             │  │                   │             │
│          │ Forward ALL │  │ API endpoints     │             │
│          │ requests to │  │ Static files      │             │
│          │ sandbox on  │  │ Templated HTML    │             │
│          │ port 18789  │  │                   │             │
│          │             │  │ (index.html with  │             │
│          │ EXCEPT:     │  │  YAML modal       │             │
│          │ /api/* still│  │  injected)        │             │
│          │ handled     │  │                   │             │
│          │ locally     │  │                   │             │
│          └─────────────┘  └───────────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

**CRITICAL:** API endpoints (`/api/*`) are ALWAYS handled locally, even in proxy mode. The proxy only kicks in for non-API paths when the sandbox is ready. WebSocket upgrades are always proxied when the sandbox is ready.

---

## 2. Configuration & Environment Variables

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8081` | Server listen port |
| `REPO_ROOT` | `../../` (relative to `server.py`) | Repository root for locating sandbox config |
| `BREV_ENV_ID` | `""` | Brev cloud environment ID (set by Brev platform) |

### Derived Paths (Computed at Module Load)

| Constant | Value | Description |
|----------|-------|-------------|
| `ROOT` | `os.path.dirname(os.path.abspath(__file__))` | Directory containing `server.py` |
| `REPO_ROOT` | env or `ROOT/../../` | Repository root |
| `SANDBOX_DIR` | `REPO_ROOT/sandboxes/nemoclaw` | Sandbox image source directory |
| `POLICY_FILE` | `SANDBOX_DIR/policy.yaml` | Source policy for gateway creation |
| `LOG_FILE` | `/tmp/nemoclaw-sandbox-create.log` | Sandbox creation log (written by subprocess) |
| `PROVIDER_CONFIG_CACHE` | `/tmp/nemoclaw-provider-config-cache.json` | Provider config values cache |
| `OTHER_AGENTS_YAML` | `ROOT/other-agents.yaml` | YAML modal definition file |
| `NEMOCLAW_IMAGE` | `ghcr.io/nvidia/openshell-community/sandboxes/nemoclaw:local` | (Currently unused, commented out) |
| `SANDBOX_PORT` | `18789` | Port the sandbox listens on (localhost) |

### Hardcoded Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `_ANSI_RE` | `r"\x1b\[[0-9;]*[a-zA-Z]"` | Regex to strip ANSI escape codes from CLI output |
| `_COPY_BTN_SVG` | SVG markup | Copy button icon injected into YAML-rendered HTML |

---

## 3. Server Bootstrap & Lifecycle

### Startup Sequence

```
main()
  │
  ├── 1. _bootstrap_config_cache()
  │       If /tmp/nemoclaw-provider-config-cache.json does NOT exist:
  │         Write default: {"nvidia-inference": {"OPENAI_BASE_URL": "https://inference-api.nvidia.com/v1"}}
  │       If it already exists: skip (no-op)
  │
  ├── 2. Create ThreadingHTTPServer on ("", PORT)
  │       - Binds to all interfaces (0.0.0.0)
  │       - Uses the Handler class (extends SimpleHTTPRequestHandler)
  │       - ThreadingHTTPServer spawns a new thread per incoming request
  │
  └── 3. server.serve_forever()
          Blocks the main thread, dispatches requests to Handler threads
```

### Handler Initialization

Each request creates a new `Handler` instance:
- `Handler.__init__` calls `SimpleHTTPRequestHandler.__init__` with `directory=ROOT`
- This means static files are served from the same directory as `server.py`
- Instance variable `_proxy_response = False` tracks whether we're in proxy mode (to suppress CORS/cache headers)

---

## 4. Routing System

### Master Router: `_route()`

All HTTP methods (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`) are aliased to `_route()`:

```python
do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = do_HEAD = lambda self: self._route()
def do_OPTIONS(self): return self._route()
```

### Routing Priority (Evaluated Top-to-Bottom)

```
1. Detect Brev ID from Host header (always, every request)

2. WebSocket Upgrade + sandbox ready → _proxy_websocket()

3. OPTIONS → 204 No Content (CORS preflight)

4. GET  /api/sandbox-status      → _handle_sandbox_status()
5. GET  /api/connection-details   → _handle_connection_details()
6. POST /api/install-openclaw     → _handle_install_openclaw()
7. POST /api/policy-sync          → _handle_policy_sync()
8. POST /api/inject-key           → _handle_inject_key()
9. GET  /api/providers            → _handle_providers_list()
10. POST /api/providers            → _handle_provider_create()
11. PUT  /api/providers/{name}     → _handle_provider_update(name)
12. DELETE /api/providers/{name}   → _handle_provider_delete(name)
13. GET  /api/cluster-inference    → _handle_cluster_inference_get()
14. POST /api/cluster-inference    → _handle_cluster_inference_set()

15. If sandbox ready → _proxy_to_sandbox() [ALL non-API requests]

16. GET/HEAD for /, /index.html → _serve_templated_index()
17. GET/HEAD for other paths → SimpleHTTPRequestHandler.do_GET() [static files]

18. Fallback → 404
```

### CRITICAL ROUTING DETAIL

The path is extracted by splitting on `?` — only the path portion is used for routing:
```python
path = self.path.split("?")[0]
```

But the **full** `self.path` (including query string) is forwarded when proxying to the sandbox.

### Provider Route Matching

Provider routes use a regex pattern: `r"^/api/providers/[\w-]+$"`
- Matches alphanumeric characters, underscores, and hyphens
- The provider name is extracted via `path.split("/")[-1]`

### Default Headers (on ALL non-proxy responses)

```
Cache-Control: no-cache, no-store, must-revalidate
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

These are added in `end_headers()` UNLESS `self._proxy_response` is `True`.

---

## 5. State Machines

### 5.1 Sandbox State Machine

```
Global: _sandbox_state (dict, protected by _sandbox_lock)
{
    "status": "idle" | "creating" | "running" | "error",
    "pid":    int | None,      // PID of the nemoclaw sandbox create process
    "url":    str | None,      // OpenClaw URL (set when running)
    "error":  str | None,      // Error message (set when error)
}
```

```
    ┌──────┐    POST /api/install-openclaw
    │ idle │ ──────────────────────────────►┌──────────┐
    └──────┘                                │ creating │
       ▲                                    └────┬─────┘
       │                                         │
       │                              ┌──────────┼──────────┐
       │                              │          │          │
       │                              ▼          │          ▼
       │                       ┌─────────┐       │   ┌─────────┐
       │                       │ running │       │   │  error  │
       │                       └─────────┘       │   └─────────┘
       │                                         │
       │   _sandbox_ready() can also             │
       │   transition idle/creating → running    │
       │   if gateway log ready + port open      │
       └─────────────────────────────────────────┘
              (no automatic recovery from error)
```

**State Transition Rules:**

| From | To | Trigger |
|------|----|---------|
| `idle` | `creating` | `_run_sandbox_create()` starts |
| `creating` | `running` | Gateway log sentinel found + port 18789 open + token extracted |
| `creating` | `error` | Process exits non-zero OR 120s timeout OR exception |
| `idle`/`creating` | `running` | `_sandbox_ready()` detects gateway log + open port (race recovery) |

**IMPORTANT:** There is NO transition from `error` back to `idle`. A retry requires a page reload / re-trigger from the frontend. The `resetInstall()` in the frontend calls `POST /api/install-openclaw` again, but the server state remains in `error` — the install endpoint only checks for `creating` and `running` (returns 409), so an `error` state allows re-triggering.

### 5.2 Key Injection State Machine

```
Global: _inject_key_state (dict, protected by _inject_key_lock)
{
    "status":   "idle" | "injecting" | "done" | "error",
    "error":    str | None,
    "key_hash": str | None,     // SHA-256 hex digest of the injected key
}
```

```
    ┌──────┐     POST /api/inject-key (new key)
    │ idle │ ──────────────────────────────────►┌───────────┐
    └──────┘                                    │ injecting │
                                                └─────┬─────┘
                                                      │
                                           ┌──────────┼──────────┐
                                           │                     │
                                           ▼                     ▼
                                    ┌──────────┐          ┌─────────┐
                                    │   done   │          │  error  │
                                    └──────────┘          └─────────┘
                                         │                     │
                                         │    POST /api/inject-key
                                         │    (different key)
                                         └──────────►┌───────────┐
                                                     │ injecting │
                                                     └───────────┘
```

**Key deduplication:** If the same key (by SHA-256 hash) is submitted:
- While `injecting` → returns `202 {"ok": true, "started": true}` (no new thread)
- While `done` → returns `200 {"ok": true, "already": true}` (no new thread)

---

## 6. API Endpoints — Complete Reference

### 6.1 `GET /api/sandbox-status`

**Purpose:** Poll sandbox readiness and key injection status.

**Side Effects:** May transition sandbox state from `idle`/`creating` to `running` if readiness signals are detected.

**Response (200):**
```json
{
    "status": "idle" | "creating" | "running" | "error",
    "url": "https://80810-xxx.brevlab.com/?token=abc123" | null,
    "error": "error message" | null,
    "key_injected": true | false,
    "key_inject_error": "error message" | null
}
```

**Readiness Check Logic (executed EVERY poll):**
1. Read `_sandbox_state` under lock
2. If status is `creating` or `idle`:
   a. Check if `LOG_FILE` contains sentinel string `"OpenClaw gateway starting in background"`
   b. Check if port 18789 is open via TCP connect (1s timeout)
   c. If BOTH true → read token from log, build URL, transition to `running`
3. Read `_inject_key_state` under lock for `key_injected` and `key_inject_error`

**IMPORTANT:** The sandbox URL is built using `_build_openclaw_url(token)` which points to the welcome-ui server itself (port 8081), NOT directly to port 18789. This is because the welcome-ui reverse-proxies to the sandbox, keeping the browser on a single origin.

---

### 6.2 `POST /api/install-openclaw`

**Purpose:** Trigger sandbox creation in a background thread.

**Request Body:** None required (Content-Type: application/json header sent by frontend but body is empty).

**Guard Conditions:**
- If status is `creating` → `409 {"ok": false, "error": "Sandbox is already being created"}`
- If status is `running` → `409 {"ok": false, "error": "Sandbox is already running"}`
- Status `idle` or `error` → proceeds

**Response (200):**
```json
{"ok": true}
```

**Background Thread (`_run_sandbox_create`):**

```
Step 1: Set state to "creating"
Step 2: _cleanup_existing_sandbox()
          → runs: nemoclaw sandbox delete nemoclaw
          → ignores all errors (best-effort cleanup)
Step 3: Build chat UI URL (no token yet)
Step 4: _generate_gateway_policy()
          → Read POLICY_FILE (sandboxes/nemoclaw/policy.yaml)
          → Strip "inference" and "process" fields from the YAML
          → Write stripped YAML to a tempfile
          → Return tempfile path (or None if source not found)
Step 5: Build and run command:
          nemoclaw sandbox create \
            --name nemoclaw \
            --from nemoclaw \
            --forward 18789 \
            [--policy <temp_policy_path>] \
            -- env CHAT_UI_URL=<url> nemoclaw-start
Step 6: Stream stdout (merged with stderr) to LOG_FILE and to stderr
          → Uses subprocess.Popen with stdout=PIPE, stderr=STDOUT
          → A daemon thread reads lines and writes to both destinations
Step 7: Wait for process to exit
Step 8: If exit code != 0 → status = "error", store last 2000 chars of log
Step 9: If exit code == 0 → poll for readiness (120s deadline):
          Loop every 3s:
            - Check _gateway_log_ready() (sentinel in log file)
            - Check _port_open("127.0.0.1", 18789)
            - If both: extract token from log, build URL, status = "running"
          If deadline expires → status = "error", "Timed out..."
Step 10: Cleanup temp policy file
```

**CRITICAL DETAILS:**
- `start_new_session=True` on the Popen call — the subprocess gets its own process group
- The streamer thread is a daemon thread — won't prevent server shutdown
- Policy file cleanup happens even if the process fails
- Token extraction retries up to 5 times with 1s delays after readiness is detected

---

### 6.3 `POST /api/inject-key`

**Purpose:** Asynchronously update the OpenShell provider credential with an API key.

**Request Body:**
```json
{"key": "nvapi-xxxxx"}
```

**Validation:**
- Empty body → `400 {"ok": false, "error": "empty body"}`
- Invalid JSON → `400 {"ok": false, "error": "invalid JSON"}`
- Missing/empty key → `400 {"ok": false, "error": "missing key"}`

**Deduplication (by SHA-256 hash of the key):**
- Same key already done → `200 {"ok": true, "already": true}`
- Same key currently injecting → `202 {"ok": true, "started": true}`

**Response (202):**
```json
{"ok": true, "started": true}
```

**Background Thread (`_run_inject_key`):**
```
Step 1: Log receipt (hash prefix)
Step 2: Run CLI command:
          nemoclaw provider update nvidia-inference \
            --type openai \
            --credential OPENAI_API_KEY=<key> \
            --config OPENAI_BASE_URL=https://inference-api.nvidia.com/v1
        Timeout: 120s
Step 3: If success:
          - Cache config {"OPENAI_BASE_URL": "https://inference-api.nvidia.com/v1"} under name "nvidia-inference"
          - State → "done"
        If failure:
          - State → "error" with stderr/stdout message
```

---

### 6.4 `POST /api/policy-sync`

**Purpose:** Push a policy YAML to the OpenShell gateway via the host-side CLI.

**Request Body:** Raw YAML text (Content-Type is not checked, but body is read as UTF-8).

**Validation:**
- Empty body (Content-Length: 0) → `400 {"ok": false, "error": "empty body"}`
- Missing `version:` field in body text → `400 {"ok": false, "error": "invalid policy: missing version field"}`

**Processing Pipeline (`_sync_policy_to_gateway`):**
```
Step 1: Read request body
Step 2: Strip "inference" and "process" fields from the YAML
          → Uses _strip_policy_fields(yaml_text, extra_fields=("process",))
          → If PyYAML available: parse → remove keys → dump
          → If PyYAML unavailable: line-by-line regex stripping
Step 3: Write stripped YAML to tempfile
Step 4: Run CLI:
          nemoclaw policy set nemoclaw --policy <tmpfile>
          Timeout: 30s
Step 5: Parse output for version number and policy hash:
          → regex: r"version\s+(\d+)"
          → regex: r"hash:\s*([a-f0-9]+)"
Step 6: Cleanup tempfile (always, even on failure — in finally block)
```

**Response (200 on success, 502 on failure):**
```json
// Success:
{"ok": true, "applied": true, "version": 3, "policy_hash": "abc123def"}

// Failure:
{"ok": false, "error": "CLI error message"}
```

---

### 6.5 `GET /api/connection-details`

**Purpose:** Return hostname and connection instructions for CLI users.

**No request body.**

**Response (200):**
```json
{
    "hostname": "my-host.example.com",
    "gatewayUrl": "https://8080-xxx.brevlab.com",
    "gatewayPort": 8080,
    "instructions": {
        "install": "curl -fsSL https://github.com/NVIDIA/OpenShell/releases/download/devel/install.sh | sh",
        "connect": "openshell gateway add https://8080-xxx.brevlab.com",
        "createSandbox": "openshell sandbox create -- claude",
        "tui": "openshell term"
    }
}
```

**URL Building:**
- If Brev ID available → `https://8080-{brev_id}.brevlab.com`
- Otherwise → `http://{hostname}:8080`

**Hostname Resolution:**
1. Try `hostname -f` (subprocess, 5s timeout)
2. Fallback to `socket.getfqdn()`

---

### 6.6 `GET /api/providers`

**Purpose:** List all configured OpenShell providers with their details.

**Processing:**
```
Step 1: Run: nemoclaw provider list --names
          → Parse output: one provider name per line
Step 2: For each name, run: nemoclaw provider get <name>
          → Parse structured text output (see parsing below)
Step 3: Merge with config cache values
```

**Provider Detail Parsing (`_parse_provider_detail`):**

The CLI outputs text like:
```
Id:              abc-123
Name:            nvidia-inference
Type:            openai
Credential keys: OPENAI_API_KEY
Config keys:     OPENAI_BASE_URL
```

Parsing rules:
- Lines are ANSI-stripped first
- Each line is matched by prefix: `Id:`, `Name:`, `Type:`, `Credential keys:`, `Config keys:`
- `Credential keys` and `Config keys` are comma-separated lists
- Value `<none>` maps to empty array
- If `Name:` is not found in output → parsed result is `None` (provider skipped)

**Config Cache Merge:**
After parsing, if the provider name has an entry in the config cache, a `configValues` key is added to the provider object.

**Response (200):**
```json
{
    "ok": true,
    "providers": [
        {
            "id": "abc-123",
            "name": "nvidia-inference",
            "type": "openai",
            "credentialKeys": ["OPENAI_API_KEY"],
            "configKeys": ["OPENAI_BASE_URL"],
            "configValues": {"OPENAI_BASE_URL": "https://inference-api.nvidia.com/v1"}
        }
    ]
}
```

**Error Response (502):**
```json
{"ok": false, "error": "CLI error message"}
```

---

### 6.7 `POST /api/providers`

**Purpose:** Create a new provider.

**Request Body:**
```json
{
    "name": "my-provider",
    "type": "openai",
    "credentials": {"OPENAI_API_KEY": "sk-xxx"},
    "config": {"OPENAI_BASE_URL": "https://api.openai.com/v1"}
}
```

**Validation:**
- No body or invalid JSON → `400`
- Missing `name` or `type` → `400 {"ok": false, "error": "name and type are required"}`

**IMPORTANT QUIRK:** If no credentials are provided, a placeholder is used:
```
--credential PLACEHOLDER=unused
```
This is because the `nemoclaw provider create` CLI requires at least one credential argument.

**CLI Command:**
```
nemoclaw provider create --name <name> --type <type> \
  --credential KEY1=VAL1 --credential KEY2=VAL2 \
  --config KEY1=VAL1 --config KEY2=VAL2
```

**Side Effect:** Config values are cached if provided.

**Response (200):** `{"ok": true}`
**Error (400/502):** `{"ok": false, "error": "..."}`

---

### 6.8 `PUT /api/providers/{name}`

**Purpose:** Update an existing provider.

**Request Body:**
```json
{
    "type": "openai",
    "credentials": {"OPENAI_API_KEY": "sk-new-key"},
    "config": {"OPENAI_BASE_URL": "https://api.openai.com/v1"}
}
```

**Validation:**
- No body or invalid JSON → `400`
- Missing `type` → `400 {"ok": false, "error": "type is required"}`

**CLI Command:**
```
nemoclaw provider update <name> --type <type> \
  --credential KEY1=VAL1 \
  --config KEY1=VAL1
```

**Side Effect:** Config values are cached if provided.

**Response (200):** `{"ok": true}`

---

### 6.9 `DELETE /api/providers/{name}`

**Purpose:** Delete a provider.

**CLI Command:**
```
nemoclaw provider delete <name>
```

**Side Effect:** Removes provider from config cache.

**Response (200):** `{"ok": true}`

---

### 6.10 `GET /api/cluster-inference`

**Purpose:** Get current cluster inference configuration.

**CLI Command:**
```
nemoclaw cluster inference get
```

**Output Parsing (`_parse_cluster_inference`):**
```
Provider:  nvidia-inference
Model:     meta/llama-3.1-70b-instruct
Version:   2
```
- Lines are ANSI-stripped
- Matched by prefix: `Provider:`, `Model:`, `Version:`
- Version is parsed as integer (defaults to 0)

**Special Case:** If CLI returns non-zero and stderr contains "not configured" or "not found":
```json
{"ok": true, "providerName": null, "modelId": "", "version": 0}
```

**Response (200):**
```json
{
    "ok": true,
    "providerName": "nvidia-inference",
    "modelId": "meta/llama-3.1-70b-instruct",
    "version": 2
}
```

---

### 6.11 `POST /api/cluster-inference`

**Purpose:** Set cluster inference configuration.

**Request Body:**
```json
{
    "providerName": "nvidia-inference",
    "modelId": "meta/llama-3.1-70b-instruct"
}
```

**Validation:**
- Missing `providerName` → `400`
- Missing `modelId` → `400`

**CLI Command:**
```
nemoclaw cluster inference set --provider <name> --model <model>
```

**Response (200):**
```json
{
    "ok": true,
    "providerName": "nvidia-inference",
    "modelId": "meta/llama-3.1-70b-instruct",
    "version": 3
}
```

---

## 7. Reverse Proxy (HTTP + WebSocket)

### 7.1 HTTP Proxy (`_proxy_to_sandbox`)

**Triggered when:** `_sandbox_ready()` returns `True` AND the request path is NOT an `/api/*` route.

**Flow:**
```
1. Open HTTP connection to 127.0.0.1:18789 (timeout=120s)
2. Read request body if Content-Length header exists
3. Copy all request headers EXCEPT:
   - "Host" → replaced with "127.0.0.1:18789"
4. Forward request (method, path+query, body, headers) to upstream
5. Read complete upstream response body
6. Set _proxy_response = True (suppresses CORS/cache headers)
7. Write response status, non-hop-by-hop headers, and Content-Length
8. Write response body
9. Close connection
```

**Hop-by-Hop Headers Filtered:**
```python
frozenset(("connection", "keep-alive", "proxy-authenticate",
           "proxy-authorization", "te", "trailers",
           "transfer-encoding", "upgrade"))
```

**IMPORTANT:** `Content-Length` from the upstream response is ALSO filtered and replaced with the actual length of `resp_body`. This handles cases where the upstream uses chunked encoding.

**Error Handling:** If anything fails → `502 "Sandbox unavailable"`. Connection is always closed after proxy.

**CRITICAL for Node.js:** The Python implementation reads the ENTIRE response body into memory before forwarding. For log streaming support, the Node.js version should use `pipe()` / streaming instead.

### 7.2 WebSocket Proxy (`_proxy_websocket`)

**Triggered when:** `Upgrade: websocket` header is present AND `_sandbox_ready()` returns `True`.

**This is checked BEFORE any API route matching — WebSocket upgrades take priority.**

**Flow:**
```
1. Open raw TCP connection to 127.0.0.1:18789 (timeout=5s)
2. Reconstruct the HTTP upgrade request manually:
   - Request line: "GET /path HTTP/1.1\r\n"
   - All headers forwarded, EXCEPT Host → replaced with "127.0.0.1:18789"
   - Terminated by "\r\n"
3. Send raw bytes to upstream
4. Create two daemon threads for bidirectional piping:
   - Thread 1: client → upstream (recv 64KB chunks, sendall)
   - Thread 2: upstream → client (recv 64KB chunks, sendall)
5. Join both threads with 7200s (2 hour) timeout
6. Close upstream socket
7. Set self.close_connection = True
```

**Error Handling:**
- Connection failure → `502 "Sandbox unavailable"`
- Pipe errors silently caught (connection broken = normal WS close)
- `socket.SHUT_WR` called on the destination when source closes

**CRITICAL for Node.js:**
- The `connection` object (`self.connection`) is the raw socket from the HTTP server
- The Python implementation manually reconstructs HTTP headers — Node.js `http` module provides the `upgrade` event with `socket` and `head` buffer which simplifies this
- The 64KB chunk size (`65536`) is a performance consideration
- The 2-hour timeout is important for long-running WebSocket connections

---

## 8. Template Rendering System (YAML → HTML)

### Overview

The server renders `other-agents.yaml` into HTML at startup and injects it into `index.html`, replacing the `{{OTHER_AGENTS_MODAL}}` placeholder.

### Caching

```python
_rendered_index: str | None = None  # Module-level cache
```

The rendered HTML is cached globally and only computed once (on first request). This means changes to `other-agents.yaml` or `index.html` require a server restart.

### YAML Schema (`other-agents.yaml`)

```yaml
title: "Modal Title"                    # Modal heading
intro: "Introductory paragraph text"    # Supports raw HTML
steps:                                  # Array of instruction sections
  - title: "Step Title"                 # Auto-numbered (1., 2., etc.)
    commands:                           # Commands shown in code block
      - "plain command string"          # Simple string → <span class="cmd">
      - cmd: "command text"             # Dict form with optional fields
        comment: "Comment above cmd"    # → <span class="comment"># Comment</span>
        id: "html-element-id"          # → id attribute on <span class="cmd">
    copyable: false                     # Show copy button? (default: false)
    copy_button_id: "btn-id"           # HTML id for the copy button
    block_id: "block-id"               # HTML id for the code-block div
    description: "Text below block"     # Supports raw HTML
```

### Rendering Rules

1. **Commands** are rendered inside a `<div class="code-block">`:
   - String commands → `<span class="cmd">{html_escaped}</span>`
   - Dict commands with `comment` → `<span class="comment"># {html_escaped}</span>` on separate line
   - Dict commands with `id` → `<span class="cmd" id="{id}">{html_escaped}</span>`
   - Multiple commands in a step are separated by double newlines (`\n\n`)
   - Multiple entries within a single command dict are separated by single newlines

2. **Copy buttons** logic:
   - If `copyable: true` AND `copy_button_id` is set → button with that ID
   - If `copyable: true` AND single command AND no button ID → button with `data-copy="{raw_cmd}"`
   - If `copyable: true` AND multiple commands AND no button ID → button with no data-copy (copies entire block text)

3. **HTML escaping:** All command text and comments are escaped via `html.escape()`.

4. **Fallback:** If YAML fails to parse or PyYAML is not installed, the placeholder is replaced with an HTML comment: `<!-- other-agents.yaml not available -->`

---

## 9. Policy Management Pipeline

### Policy Field Stripping (`_strip_policy_fields`)

This function removes top-level YAML fields that the gateway doesn't understand:
- Always removes: `inference`
- Optionally removes additional fields (e.g., `process`)

**Two implementations (auto-selected):**

1. **PyYAML available:** Parse → dict.pop() → dump
   - Preserves YAML structure perfectly
   - `default_flow_style=False, sort_keys=False` for readable output

2. **PyYAML unavailable:** Line-by-line regex stripping
   - Detects top-level keys by matching `^{key}:` at line start
   - Skips all indented continuation lines (starts with space/tab or is blank)
   - Stops skipping when a non-indented, non-blank line is found

### Gateway Policy Generation (`_generate_gateway_policy`)

Used during sandbox creation only:
1. Read `POLICY_FILE` (source policy.yaml)
2. Strip `inference` and `process` fields
3. Write to a temp file (`tempfile.mkstemp`)
4. Return temp file path (caller must delete)

### Policy Sync (`_sync_policy_to_gateway`)

Used for runtime policy updates:
1. Strip `inference` and `process` fields from incoming YAML
2. Write to temp file
3. Run `nemoclaw policy set nemoclaw --policy <tmpfile>` (30s timeout)
4. Parse output for version and hash
5. Always delete temp file (in `finally` block)

---

## 10. Provider CRUD System

### Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Provider CRUD                      │
│                                                       │
│  ┌─────────────┐    ┌──────────────────────────┐     │
│  │ nemoclaw CLI │◄──│ server.py subprocess calls│     │
│  │             │    │                          │     │
│  │ provider    │    │ CREATE: --name --type    │     │
│  │   list      │    │         --credential     │     │
│  │   get       │    │         --config         │     │
│  │   create    │    │ UPDATE: name --type      │     │
│  │   update    │    │         --credential     │     │
│  │   delete    │    │         --config         │     │
│  └─────────────┘    │ DELETE: name             │     │
│                     └──────────────────────────┘     │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │         Config Value Cache (JSON file)        │    │
│  │  /tmp/nemoclaw-provider-config-cache.json     │    │
│  │                                               │    │
│  │  The CLI does NOT return config VALUES,       │    │
│  │  only config KEYS. So we cache values on     │    │
│  │  create/update and merge them into GET        │    │
│  │  responses.                                   │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

### Why the Cache Exists

The `nemoclaw provider get` CLI only returns config **key names**, not their values. The server maintains a separate JSON file cache to remember config values that were set during `create` and `update` operations. This cache is:
- Read on every `GET /api/providers` request
- Written on every `POST` (create) and `PUT` (update) that includes config values
- Cleaned up on `DELETE`
- Bootstrapped at server startup with a default for `nvidia-inference`

---

## 11. Cluster Inference Management

Simple CRUD wrapper around:
- `nemoclaw cluster inference get`
- `nemoclaw cluster inference set --provider <name> --model <model>`

Output is parsed the same way as provider detail (line-by-line, prefix matching, ANSI stripping).

---

## 12. Caching Layer

### Provider Config Cache

**File:** `/tmp/nemoclaw-provider-config-cache.json`

**Format:**
```json
{
    "nvidia-inference": {
        "OPENAI_BASE_URL": "https://inference-api.nvidia.com/v1"
    },
    "my-custom-provider": {
        "CUSTOM_URL": "https://example.com"
    }
}
```

**Operations:**
| Function | Behavior |
|----------|----------|
| `_read_config_cache()` | Read JSON file, return `{}` on `FileNotFoundError` or `JSONDecodeError` |
| `_write_config_cache(cache)` | Write JSON file, silently ignore `OSError` |
| `_cache_provider_config(name, config)` | Read → merge → write |
| `_remove_cached_provider(name)` | Read → pop → write |
| `_bootstrap_config_cache()` | Only writes default if file doesn't exist |

### Rendered Index Cache

**Variable:** `_rendered_index` (module-level `str | None`)

Computed once on first request, never invalidated. Contains the full `index.html` with the YAML modal HTML injected.

---

## 13. Brev Integration & URL Building

### Brev ID Detection

The server needs the Brev environment ID to build externally-reachable URLs. It obtains this from two sources:

1. **Environment Variable:** `BREV_ENV_ID` (set by the Brev platform at container start)
2. **Host Header Detection:** Extracted from incoming request `Host` headers matching `\d+-(.+?)\.brevlab\.com`

```python
def _extract_brev_id(host: str) -> str:
    """Example: '80810-abcdef123.brevlab.com' → 'abcdef123'"""
    match = re.match(r"\d+-(.+?)\.brevlab\.com", host)
    return match.group(1) if match else ""
```

Detection is **idempotent** — once a Brev ID is detected from a Host header, it's cached globally and never overwritten.

### URL Building

```
_build_openclaw_url(token):
    If Brev ID available:
        → https://80810-{brev_id}.brevlab.com/[?token=xxx]
    Else:
        → http://127.0.0.1:{PORT}/[?token=xxx]
```

**The URL points to the welcome-ui server itself** (port 8081 = `80810` in Brev URL format), NOT directly to port 18789. This is critical because:
- Brev's port-forwarding creates subdomains per port
- Cross-origin requests between Brev port subdomains are blocked
- By proxying through port 8081, the browser stays on one origin

### Connection Details URL (for CLI users)

```
Gateway URL:
    If Brev ID: https://8080-{brev_id}.brevlab.com
    Else:       http://{hostname}:8080
```

This is a DIFFERENT port (8080) — the OpenShell gateway itself, not the welcome-ui.

---

## 14. Threading Model

```
┌──────────────────────────────────────────────────────────────────┐
│                        THREADING MODEL                            │
│                                                                    │
│  Main Thread                                                       │
│  └── server.serve_forever()                                        │
│       └── ThreadingHTTPServer spawns one thread per request        │
│                                                                    │
│  Background Threads (daemon=True):                                 │
│  ├── _run_sandbox_create     (spawned by POST /api/install-openclaw)│
│  │   └── _stream_output      (reads subprocess stdout → log file)  │
│  ├── _run_inject_key         (spawned by POST /api/inject-key)     │
│  └── (WebSocket pipe threads) (two per WS connection)              │
│                                                                    │
│  Locks:                                                            │
│  ├── _sandbox_lock      (protects _sandbox_state dict)             │
│  └── _inject_key_lock   (protects _inject_key_state dict)          │
│                                                                    │
│  IMPORTANT: No lock protects the config cache file.                │
│  Concurrent writes could corrupt it (unlikely in practice).        │
└──────────────────────────────────────────────────────────────────┘
```

**Key Threading Details:**
- `ThreadingHTTPServer` = one thread per connection (not per request)
- All background threads are daemon threads → they die when the main thread exits
- The subprocess for sandbox creation uses `start_new_session=True` → it gets its own process group and survives if the server thread dies
- WebSocket pipe threads have a 2-hour (7200s) join timeout
- The `_stream_output` thread for subprocess output uses line-buffered reads

---

## 15. Frontend Contract (app.js)

### API Call Flow

```
Page Load
  │
  ├── checkExistingSandbox()
  │     GET /api/sandbox-status
  │     → If "running" + url: show modal, mark ready
  │     → If "creating": show modal, start polling
  │
  ├── User clicks "Install OpenClaw" card
  │     → Show install modal
  │     → triggerInstall()
  │          POST /api/install-openclaw
  │          → On success: startPolling()
  │
  ├── Polling (every 3000ms)
  │     GET /api/sandbox-status
  │     → "running": mark ready, update UI
  │     → "error": show error, stop polling
  │     → "creating": keep polling
  │
  ├── User types API key
  │     → Debounced (300ms) submitKeyForInjection()
  │          POST /api/inject-key {key: "nvapi-..."}
  │     → keyInjected tracked via sandbox-status polling
  │
  ├── When sandboxReady + keyValid + keyInjected:
  │     → "Open OpenShell" button enabled
  │     → Click opens: sandboxUrl + ?nvapi=<key> in new tab
  │
  └── User clicks "Other Agents" card
        → loadConnectionDetails()
             GET /api/connection-details
        → Show instructions modal
```

### Five-State CTA Button

| State | Condition | Label | Enabled |
|-------|-----------|-------|---------|
| 1 | API key empty + tasks running | "Waiting for API key..." | No |
| 2 | API key valid + tasks running | "Provisioning Sandbox..." | No (spinner) |
| 3 | API key empty + tasks done | "Waiting for API key..." | No |
| 4 | API key valid + sandbox ready + key not injected | "Configuring API key..." | No (spinner) |
| 5 | API key valid + sandbox ready + key injected | "Open OpenShell" | Yes |

### API Key Validation

```javascript
function isApiKeyValid() {
    const v = apiKeyInput.value.trim();
    return v.startsWith("nvapi-") || v.startsWith("sk-");
}
```

Accepts NVIDIA API keys (`nvapi-`) and OpenAI-style keys (`sk-`).

---

## 16. External CLI Dependencies

All CLI commands are executed via `subprocess.run()` or `subprocess.Popen()`. Every command below MUST be available on the system `PATH`:

| Command | Timeout | Used By |
|---------|---------|---------|
| `nemoclaw sandbox create --name ... --from ... --forward ... [--policy ...] -- env ... nemoclaw-start` | None (Popen, waited manually) | `_run_sandbox_create` |
| `nemoclaw sandbox delete nemoclaw` | 30s | `_cleanup_existing_sandbox` |
| `nemoclaw provider list --names` | 30s | `_handle_providers_list` |
| `nemoclaw provider get <name>` | 30s | `_handle_providers_list` |
| `nemoclaw provider create --name <n> --type <t> --credential K=V --config K=V` | 30s | `_handle_provider_create` |
| `nemoclaw provider update <name> --type <t> --credential K=V --config K=V` | 30s | `_handle_provider_update`, `_run_inject_key` |
| `nemoclaw provider delete <name>` | 30s | `_handle_provider_delete` |
| `nemoclaw policy set <sandbox> --policy <file>` | 30s | `_sync_policy_to_gateway` |
| `nemoclaw cluster inference get` | 30s | `_handle_cluster_inference_get` |
| `nemoclaw cluster inference set --provider <p> --model <m>` | 30s | `_handle_cluster_inference_set` |
| `hostname -f` | 5s | `_get_hostname` |

---

## 17. File Dependencies & Paths

### Files Read

| Path | When | Required |
|------|------|----------|
| `ROOT/index.html` | First request to `/` | Yes |
| `ROOT/other-agents.yaml` | First request to `/` | No (graceful fallback) |
| `ROOT/styles.css` | Static file serving | Yes (for UI) |
| `ROOT/app.js` | Static file serving | Yes (for UI) |
| `SANDBOX_DIR/policy.yaml` | Sandbox creation | No (graceful fallback) |
| `/tmp/nemoclaw-sandbox-create.log` | Readiness checks, token extraction | Created by server |
| `/tmp/nemoclaw-provider-config-cache.json` | Provider CRUD | Created by server |

### Files Written

| Path | When | Format |
|------|------|--------|
| `/tmp/nemoclaw-sandbox-create.log` | During sandbox creation | Text (subprocess output) |
| `/tmp/nemoclaw-provider-config-cache.json` | Provider CRUD, bootstrap | JSON |
| `/tmp/sandbox-policy-*.yaml` | Sandbox creation (temp) | YAML |
| `/tmp/policy-sync-*.yaml` | Policy sync (temp) | YAML |

### Token Extraction from Log

```python
re.search(r"token=([A-Za-z0-9_\-]+)", content)
```

The token is found in URLs printed by the `nemoclaw-start.sh` script inside the sandbox.

### Gateway Readiness Sentinel

```python
"OpenClaw gateway starting in background" in f.read()
```

This exact string is printed by `nemoclaw-start.sh` after the OpenClaw gateway has been backgrounded.

---

## 18. Gotchas, Edge Cases & Migration Warnings

### 18.1 Proxy Mode Suppresses Default Headers

When `_proxy_response = True`, the `end_headers()` method does NOT add CORS or Cache-Control headers. This flag is set to `True` before writing proxy response headers and reset to `False` in the `finally` block. If this is not handled correctly, proxy responses will get double headers.

### 18.2 WebSocket Detection Before Route Matching

WebSocket upgrade requests are checked BEFORE any API route. This means if a WebSocket upgrade request is sent to `/api/sandbox-status`, it will be proxied to the sandbox (if ready) instead of handled as an API call. This is intentional — the sandbox's OpenClaw UI uses WebSockets.

### 18.3 Sandbox Ready Check Is Polled from Multiple Paths

`_sandbox_ready()` is called:
1. In the routing function (to decide proxy vs. welcome-ui mode)
2. In `/api/sandbox-status` handler (with slightly different logic)
3. Both can trigger the `idle`/`creating` → `running` transition

This means the sandbox can be detected as running even if `_run_sandbox_create` hasn't finished its own polling loop yet.

### 18.4 No Body Parsing for OPTIONS

OPTIONS requests return `204` immediately with CORS headers. No body parsing occurs.

### 18.5 Config Cache Race Condition

The provider config cache (`/tmp/nemoclaw-provider-config-cache.json`) has no file locking. Concurrent requests that modify different providers could overwrite each other's changes. In practice this is rare since provider CRUD is typically sequential.

### 18.6 ANSI Stripping Is Critical

All CLI output parsing MUST strip ANSI escape codes first. The `nemoclaw` CLI may use colored output even when stdout is a pipe. The regex used:
```
\x1b\[[0-9;]*[a-zA-Z]
```

### 18.7 Policy Stripping Has Two Code Paths

If PyYAML is not installed, the policy field stripping falls back to regex-based line stripping. The Node.js version should always use a YAML parser (like `js-yaml`) since it will be available in the Node ecosystem.

### 18.8 Subprocess Environment

The sandbox creation subprocess inherits the full environment (`os.environ.copy()`). No additional env vars are injected through the subprocess env — they're passed via the `-- env VAR=VAL` syntax in the command itself.

### 18.9 The `--from` Flag Changed

The code has a commented-out line:
```python
# "--from", NEMOCLAW_IMAGE,
```
And uses instead:
```python
"--from", "nemoclaw",
```
This means it uses a local sandbox name rather than a container image reference.

### 18.10 Inject Key Hardcodes Provider Name

The `_run_inject_key` function hardcodes `nvidia-inference` as the provider name. This is not configurable via the API.

### 18.11 Error State Truncation

When sandbox creation fails, only the last 2000 characters of the log are stored:
```python
_sandbox_state["error"] = f.read()[-2000:]
```

### 18.12 Static File Serving Falls Through to SimpleHTTPRequestHandler

For non-API, non-index paths when the sandbox is NOT ready, Python's built-in `SimpleHTTPRequestHandler` serves files from the `ROOT` directory. This supports directory listing and MIME type detection. The Node.js equivalent would be `express.static()` or similar.

### 18.13 Host Header Rewriting in Proxy

Both HTTP and WebSocket proxies rewrite the `Host` header to `127.0.0.1:18789`. All other headers are forwarded as-is. This is critical because the upstream may validate the Host header.

### 18.14 Connection Closure After Proxy

Both HTTP and WebSocket proxy handlers set `self.close_connection = True`, forcing the connection closed after each proxied request. This prevents HTTP keep-alive from causing issues with the proxy.

### 18.15 Process Group Isolation

`start_new_session=True` on the sandbox creation Popen means the subprocess and all its children are in a separate process group. Sending SIGTERM to the server won't kill the sandbox creation process.

### 18.16 Key Hash Is SHA-256

```python
hashlib.sha256(key.encode()).hexdigest()
```

The full hex digest is stored, but only the first 12 characters are logged for debugging.

### 18.17 Log Streaming Gap for Node.js

The Python server writes sandbox creation output to `/tmp/nemoclaw-sandbox-create.log` but does NOT stream it to the frontend. The frontend polls `/api/sandbox-status` every 3 seconds for status only. **For the Node.js version, you should add a log-streaming endpoint** (e.g., SSE or WebSocket on `/api/sandbox-logs`) that tails the log file in real-time.

### 18.18 Temp File Cleanup Patterns

- **Sandbox creation:** Temp policy file is cleaned up in the main flow after `proc.wait()`, but could be leaked if an exception occurs before that point.
- **Policy sync:** Temp file is cleaned up in a `finally` block — always cleaned up.

The Node.js version should use `try/finally` or `process.on('exit')` to ensure cleanup.

---

## 19. Node.js Migration Checklist

### Must-Have Functionality

- [ ] HTTP server on configurable port (default 8081)
- [ ] `ThreadingHTTPServer` equivalent — Node.js is single-threaded but async; use `http.createServer()` which handles concurrency via the event loop
- [ ] All 11 API endpoints with identical request/response contracts
- [ ] Static file serving from the same directory
- [ ] Template rendering: `{{OTHER_AGENTS_MODAL}}` injection from YAML
- [ ] Reverse proxy (HTTP) to localhost:18789
- [ ] Reverse proxy (WebSocket) to localhost:18789
- [ ] Subprocess execution for all `nemoclaw` CLI commands
- [ ] State machines for sandbox and key injection (use in-memory objects)
- [ ] Provider config cache (JSON file read/write)
- [ ] Brev ID detection from Host header
- [ ] CORS headers on all non-proxy responses
- [ ] ANSI code stripping for CLI output parsing

### New Feature: Log Streaming

- [ ] Add `GET /api/sandbox-logs` endpoint (SSE or WebSocket)
- [ ] Tail `/tmp/nemoclaw-sandbox-create.log` in real-time
- [ ] Stream subprocess output directly to connected clients
- [ ] Consider using `child_process.spawn()` with piped stdout for real-time streaming
- [ ] Frontend should connect to log stream when install is triggered

### Recommended Node.js Libraries

| Purpose | Recommended Package |
|---------|-------------------|
| HTTP server | Built-in `http` module or Express |
| Static files | `express.static()` or `serve-static` |
| WebSocket proxy | `http-proxy` or manual with `net` module |
| YAML parsing | `js-yaml` |
| Subprocess | Built-in `child_process` (`spawn`, `execFile`) |
| HTML escaping | `he` or `escape-html` |
| CORS | `cors` middleware (if Express) or manual headers |
| SSE (log streaming) | Manual implementation or `better-sse` |
| File watching (logs) | `fs.watch()` or `chokidar` for tail -f behavior |
| Temp files | Built-in `os.tmpdir()` + `fs.mkdtemp()` |

### Architecture Differences to Watch

1. **Python threads → Node.js async/await:** Python uses threads for background work. Node.js should use `child_process.spawn()` with event-driven I/O.

2. **Synchronous file reads in Python → async in Node.js:** Several functions (`_read_config_cache`, `_gateway_log_ready`, `_read_openclaw_token`) read files synchronously. In Node.js, use async versions to avoid blocking the event loop.

3. **Global mutable state with locks → No locks needed in Node.js:** Since Node.js is single-threaded (event loop), you don't need locks for `_sandbox_state` and `_inject_key_state`. Simple objects work, but be careful with async operations that could interleave.

4. **SimpleHTTPRequestHandler → Express static middleware:** Python's built-in static file handler supports directory listing and content-type detection. Ensure the Node.js equivalent handles the same MIME types.

5. **subprocess.run() blocking → child_process.execFile() callback/promise:** All CLI calls in Python use blocking `subprocess.run()`. In Node.js, wrap `child_process.execFile()` in promises.

6. **subprocess.Popen with streaming → child_process.spawn() with pipe:** The sandbox creation process uses line-by-line output streaming. In Node.js, `spawn()` gives you stdout/stderr as streams.

7. **HTTP proxy reads full body → Node.js can stream:** The Python proxy reads the entire response body before forwarding. Node.js should pipe the response stream directly for better performance and to support log streaming.

---

## Appendix A: Complete Request/Response Matrix

| Method | Path | Status Codes | Auth | Body In | Body Out |
|--------|------|-------------|------|---------|----------|
| GET | `/api/sandbox-status` | 200 | No | None | JSON |
| POST | `/api/install-openclaw` | 200, 409 | No | None | JSON |
| POST | `/api/inject-key` | 200, 202, 400 | No | JSON | JSON |
| POST | `/api/policy-sync` | 200, 400, 502 | No | YAML text | JSON |
| GET | `/api/connection-details` | 200 | No | None | JSON |
| GET | `/api/providers` | 200, 502 | No | None | JSON |
| POST | `/api/providers` | 200, 400, 502 | No | JSON | JSON |
| PUT | `/api/providers/{name}` | 200, 400, 502 | No | JSON | JSON |
| DELETE | `/api/providers/{name}` | 200, 400, 502 | No | None | JSON |
| GET | `/api/cluster-inference` | 200, 400, 502 | No | None | JSON |
| POST | `/api/cluster-inference` | 200, 400, 502 | No | JSON | JSON |
| OPTIONS | any | 204 | No | None | None |
| GET/HEAD | `/`, `/index.html` | 200 | No | None | HTML |
| GET/HEAD | `/*.css`, `/*.js` | 200/404 | No | None | Static |
| * | any (sandbox ready) | varies | No | Proxied | Proxied |

## Appendix B: Log Format Reference

All server logging goes to `stderr` with prefixed tags:

| Prefix | Source |
|--------|--------|
| `[welcome-ui]` | General server messages, proxy errors |
| `[sandbox]` | Lines from sandbox creation subprocess |
| `[inject-key HH:MM:SS]` | Key injection lifecycle |
| `[policy-sync HH:MM:SS]` | Policy sync lifecycle |

Timestamps use `time.strftime("%H:%M:%S")` (local time, no date).
