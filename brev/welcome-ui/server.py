#!/usr/bin/env python3

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""NemoClaw Welcome UI — HTTP server with sandbox lifecycle APIs."""

import hashlib
import http.client
import http.server
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time

try:
    import yaml as _yaml
except ImportError:
    _yaml = None

PORT = int(os.environ.get("PORT", 8081))
ROOT = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.environ.get("REPO_ROOT", os.path.join(ROOT, "..", ".."))
SANDBOX_DIR = os.path.join(REPO_ROOT, "sandboxes", "nemoclaw")
NEMOCLAW_IMAGE = "ghcr.io/nvidia/nemoclaw-community/sandboxes/nemoclaw:local"
POLICY_FILE = os.path.join(SANDBOX_DIR, "policy.yaml")

LOG_FILE = "/tmp/nemoclaw-sandbox-create.log"
BREV_ENV_ID = os.environ.get("BREV_ENV_ID", "")
_detected_brev_id = ""

SANDBOX_PORT = 18789

_sandbox_lock = threading.Lock()
_sandbox_state = {
    "status": "idle",  # idle | creating | running | error
    "pid": None,
    "url": None,
    "error": None,
}

_inject_key_lock = threading.Lock()
_inject_key_state = {
    "status": "idle",  # idle | injecting | done | error
    "error": None,
    "key_hash": None,
}


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def _inject_log(msg: str) -> None:
    ts = time.strftime("%H:%M:%S")
    sys.stderr.write(f"[inject-key {ts}] {msg}\n")
    sys.stderr.flush()


def _run_inject_key(key: str, key_hash: str) -> None:
    """Background thread: update the NemoClaw provider credential."""
    _inject_log(f"step 1/3: received key (hash={key_hash[:12]}…)")
    cmd = [
        "nemoclaw", "provider", "update", "nvidia-inference",
        "--type", "openai",
        "--credential", f"OPENAI_API_KEY={key}",
        "--config", "OPENAI_BASE_URL=https://inference-api.nvidia.com/v1",
    ]
    _inject_log(f"step 2/3: running nemoclaw provider update nvidia-inference …")
    try:
        t0 = time.time()
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=120,
        )
        elapsed = time.time() - t0
        _inject_log(f"         CLI exited {result.returncode} in {elapsed:.1f}s")
        if result.stdout.strip():
            _inject_log(f"         stdout: {result.stdout.strip()}")
        if result.stderr.strip():
            _inject_log(f"         stderr: {result.stderr.strip()}")

        if result.returncode != 0:
            err = (result.stderr or result.stdout or "unknown error").strip()
            _inject_log(f"step 3/3: FAILED — {err}")
            with _inject_key_lock:
                _inject_key_state["status"] = "error"
                _inject_key_state["error"] = err
            return

        _inject_log(f"step 3/3: SUCCESS — provider nvidia-inference updated")
        with _inject_key_lock:
            _inject_key_state["status"] = "done"
            _inject_key_state["error"] = None
            _inject_key_state["key_hash"] = key_hash

    except Exception as exc:
        _inject_log(f"step 3/3: EXCEPTION — {exc}")
        with _inject_key_lock:
            _inject_key_state["status"] = "error"
            _inject_key_state["error"] = str(exc)


def _sandbox_ready() -> bool:
    with _sandbox_lock:
        if _sandbox_state["status"] == "running":
            return True
        if _sandbox_state["status"] in ("idle", "creating"):
            if _gateway_log_ready() and _port_open("127.0.0.1", SANDBOX_PORT):
                _sandbox_state["status"] = "running"
                return True
    return False


def _extract_brev_id(host: str) -> str:
    """Extract the Brev environment ID from a Host header like '80810-xxx.brevlab.com'."""
    match = re.match(r"\d+-(.+?)\.brevlab\.com", host)
    return match.group(1) if match else ""


def _maybe_detect_brev_id(host: str) -> None:
    """Cache the Brev environment ID from the request Host header (idempotent)."""
    global _detected_brev_id
    if not _detected_brev_id:
        brev_id = _extract_brev_id(host)
        if brev_id:
            _detected_brev_id = brev_id


def _build_openclaw_url(token: str | None) -> str:
    """Build the externally reachable OpenClaw URL.

    Points to the welcome-ui server itself (port 8081) which reverse-proxies
    to the sandbox.  This keeps the browser on a single origin and avoids
    Brev cross-origin blocks between port subdomains.
    """
    brev_id = BREV_ENV_ID or _detected_brev_id
    if brev_id:
        url = f"https://80810-{brev_id}.brevlab.com/"
    else:
        url = f"http://127.0.0.1:{PORT}/"
    if token:
        url += f"?token={token}"
    return url


def _port_open(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _read_openclaw_token() -> str | None:
    """Try to extract the auth token from the sandbox's openclaw config via logs."""
    try:
        with open(LOG_FILE) as f:
            content = f.read()
        match = re.search(r"token=([A-Za-z0-9_\-]+)", content)
        if match:
            return match.group(1)
    except FileNotFoundError:
        pass
    return None


def _gateway_log_ready() -> bool:
    """True once nemoclaw-start.sh has launched the OpenClaw gateway.

    The startup script prints this sentinel *after* ``openclaw gateway``
    has been backgrounded and the auth token extracted, so its presence
    in the log is a reliable readiness signal — unlike a bare port check
    which fires as soon as the forwarding tunnel opens.
    """
    try:
        with open(LOG_FILE) as f:
            return "OpenClaw gateway starting in background" in f.read()
    except FileNotFoundError:
        return False


def _generate_gateway_policy() -> str | None:
    """Create a temp policy file suitable for gateway creation.

    Strips ``inference`` (not in the proto schema) and ``process`` (immutable
    after creation — including it at creation locks you into it and makes
    subsequent updates impossible).

    Returns the path to the temp file, or None if no source policy was found.
    The caller is responsible for deleting the file.
    """
    if not os.path.isfile(POLICY_FILE):
        sys.stderr.write(f"[welcome-ui] Policy file not found: {POLICY_FILE}\n")
        return None

    try:
        with open(POLICY_FILE) as f:
            raw = f.read()
        stripped = _strip_policy_fields(raw, extra_fields=("process",))
        fd, path = tempfile.mkstemp(suffix=".yaml", prefix="sandbox-policy-")
        with os.fdopen(fd, "w") as f:
            f.write(stripped)
        sys.stderr.write(f"[welcome-ui] Generated gateway policy from {POLICY_FILE} → {path}\n")
        return path
    except Exception as exc:
        sys.stderr.write(f"[welcome-ui] Failed to generate gateway policy: {exc}\n")
        return None


def _cleanup_existing_sandbox():
    """Delete any leftover sandbox named 'nemoclaw' from a previous attempt."""
    try:
        subprocess.run(
            ["nemoclaw", "sandbox", "delete", "nemoclaw"],
            capture_output=True, timeout=30,
        )
    except Exception:
        pass


def _run_sandbox_create():
    """Background thread: runs nemoclaw sandbox create and monitors until ready."""
    global _sandbox_state

    with _sandbox_lock:
        _sandbox_state["status"] = "creating"
        _sandbox_state["error"] = None
        _sandbox_state["url"] = None

    _cleanup_existing_sandbox()

    chat_ui_url = _build_openclaw_url(token=None)

    policy_path = _generate_gateway_policy()

    env = os.environ.copy()
    # Use `env` to inject vars into the sandbox command.  Avoids the
    # nemoclaw -e flag which has a quoting bug that causes SSH to
    # misinterpret the export string as a cipher type.
    # API keys are NOT passed here; they are injected client-side via
    # URL parameters when the user opens the OpenClaw UI.
    cmd = [
        "nemoclaw", "sandbox", "create",
        "--name", "nemoclaw",
        "--from", NEMOCLAW_IMAGE,
        "--forward", "18789",
    ]
    if policy_path:
        cmd += ["--policy", policy_path]
    cmd += [
        "--",
        "env",
        f"CHAT_UI_URL={chat_ui_url}",
        "nemoclaw-start",
    ]

    cmd_display = " ".join(cmd[:8]) + " -- ..."
    sys.stderr.write(f"[welcome-ui] Running: {cmd_display}\n")
    sys.stderr.flush()

    try:
        log_fh = open(LOG_FILE, "w")
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env,
            start_new_session=True,
        )

        def _stream_output():
            for line in proc.stdout:
                log_fh.write(line.decode("utf-8", errors="replace"))
                log_fh.flush()
                sys.stderr.write(f"[sandbox] {line.decode('utf-8', errors='replace')}")
                sys.stderr.flush()
            log_fh.close()

        streamer = threading.Thread(target=_stream_output, daemon=True)
        streamer.start()

        with _sandbox_lock:
            _sandbox_state["pid"] = proc.pid

        proc.wait()
        streamer.join(timeout=5)

        if policy_path:
            try:
                os.unlink(policy_path)
            except OSError:
                pass

        if proc.returncode != 0:
            with _sandbox_lock:
                _sandbox_state["status"] = "error"
                try:
                    with open(LOG_FILE) as f:
                        _sandbox_state["error"] = f.read()[-2000:]
                except Exception:
                    _sandbox_state["error"] = f"Process exited with code {proc.returncode}"
            return

        deadline = time.time() + 120
        while time.time() < deadline:
            if _gateway_log_ready() and _port_open("127.0.0.1", 18789):
                token = _read_openclaw_token()
                if token is None:
                    for _ in range(5):
                        time.sleep(1)
                        token = _read_openclaw_token()
                        if token is not None:
                            break
                url = _build_openclaw_url(token)
                with _sandbox_lock:
                    _sandbox_state["status"] = "running"
                    _sandbox_state["url"] = url
                return
            time.sleep(3)

        with _sandbox_lock:
            _sandbox_state["status"] = "error"
            _sandbox_state["error"] = "Timed out waiting for OpenClaw gateway on port 18789"

    except Exception as exc:
        with _sandbox_lock:
            _sandbox_state["status"] = "error"
            _sandbox_state["error"] = str(exc)


def _get_hostname() -> str:
    """Best-effort external hostname for connection details."""
    try:
        result = subprocess.run(
            ["hostname", "-f"], capture_output=True, text=True, timeout=5
        )
        hostname = result.stdout.strip()
        if hostname:
            return hostname
    except Exception:
        pass
    return socket.getfqdn()


def _strip_policy_fields(yaml_text: str, extra_fields: tuple[str, ...] = ()) -> str:
    """Remove fields that the gateway does not understand or rejects.

    Always strips ``inference``.  Pass additional top-level keys via
    *extra_fields* (e.g. ``("process",)``) to strip those too.
    """
    remove = {"inference"} | set(extra_fields)
    if _yaml is not None:
        doc = _yaml.safe_load(yaml_text)
        if isinstance(doc, dict):
            for key in remove:
                doc.pop(key, None)
            return _yaml.dump(doc, default_flow_style=False, sort_keys=False)
    lines = yaml_text.splitlines(keepends=True)
    out, skip = [], False
    for line in lines:
        if any(re.match(rf"^{re.escape(k)}:", line) for k in remove):
            skip = True
            continue
        if skip and (line[0:1] in (" ", "\t") or line.strip() == ""):
            continue
        skip = False
        out.append(line)
    return "".join(out)


def _log(msg: str) -> None:
    ts = time.strftime("%H:%M:%S")
    sys.stderr.write(f"[policy-sync {ts}] {msg}\n")
    sys.stderr.flush()


def _sync_policy_to_gateway(yaml_text: str, sandbox_name: str = "nemoclaw") -> dict:
    """Push a policy YAML to the NemoClaw gateway via the host-side CLI."""
    _log(f"step 2/4: stripping inference+process fields ({len(yaml_text)} bytes in)")
    stripped = _strip_policy_fields(yaml_text, extra_fields=("process",))
    _log(f"         stripped to {len(stripped)} bytes")

    fd, tmp_path = tempfile.mkstemp(suffix=".yaml", prefix="policy-sync-")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(stripped)
        cmd = ["nemoclaw", "policy", "set", sandbox_name, "--policy", tmp_path]
        _log(f"step 3/4: running {' '.join(cmd)}")
        t0 = time.time()
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        elapsed = time.time() - t0
        _log(f"         CLI exited {result.returncode} in {elapsed:.1f}s")
        if result.stdout.strip():
            _log(f"         stdout: {result.stdout.strip()}")
        if result.stderr.strip():
            _log(f"         stderr: {result.stderr.strip()}")
    finally:
        os.unlink(tmp_path)

    if result.returncode != 0:
        err_msg = (result.stderr or result.stdout or "unknown error").strip()
        _log(f"step 4/4: FAILED — {err_msg}")
        return {"ok": False, "error": err_msg}

    output = result.stdout + result.stderr
    ver_match = re.search(r"version\s+(\d+)", output)
    hash_match = re.search(r"hash:\s*([a-f0-9]+)", output)
    version = int(ver_match.group(1)) if ver_match else 0
    policy_hash = hash_match.group(1) if hash_match else ""
    _log(f"step 4/4: SUCCESS — version={version} hash={policy_hash}")
    return {"ok": True, "applied": True, "version": version, "policy_hash": policy_hash}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    _proxy_response = False

    def end_headers(self):
        if not self._proxy_response:
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    # -- Unified routing ------------------------------------------------

    def _route(self):
        _maybe_detect_brev_id(self.headers.get("Host", ""))
        path = self.path.split("?")[0]

        if self.headers.get("Upgrade", "").lower() == "websocket" and _sandbox_ready():
            return self._proxy_websocket()

        if self.command == "OPTIONS":
            self.send_response(204)
            self.end_headers()
            return

        if path == "/api/sandbox-status" and self.command == "GET":
            return self._handle_sandbox_status()
        if path == "/api/connection-details" and self.command == "GET":
            return self._handle_connection_details()
        if path == "/api/install-openclaw" and self.command == "POST":
            return self._handle_install_openclaw()
        if path == "/api/policy-sync" and self.command == "POST":
            return self._handle_policy_sync()
        if path == "/api/inject-key" and self.command == "POST":
            return self._handle_inject_key()

        if _sandbox_ready():
            return self._proxy_to_sandbox()

        if self.command in ("GET", "HEAD"):
            return super().do_GET()

        self.send_error(404)

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = do_HEAD = lambda self: self._route()
    def do_OPTIONS(self): return self._route()

    # -- Reverse proxy to sandbox --------------------------------------

    _HOP_BY_HOP = frozenset((
        "connection", "keep-alive", "proxy-authenticate",
        "proxy-authorization", "te", "trailers",
        "transfer-encoding", "upgrade",
    ))

    def _proxy_to_sandbox(self):
        """Forward an HTTP request to the sandbox proxy on localhost."""
        try:
            conn = http.client.HTTPConnection("127.0.0.1", SANDBOX_PORT, timeout=120)

            body = None
            cl = self.headers.get("Content-Length")
            if cl:
                body = self.rfile.read(int(cl))

            hdrs = {}
            for key, val in self.headers.items():
                if key.lower() == "host":
                    continue
                hdrs[key] = val
            hdrs["Host"] = f"127.0.0.1:{SANDBOX_PORT}"

            conn.request(self.command, self.path, body=body, headers=hdrs)
            resp = conn.getresponse()

            resp_body = resp.read()

            self._proxy_response = True
            self.send_response_only(resp.status, resp.reason)
            for key, val in resp.getheaders():
                if key.lower() in self._HOP_BY_HOP:
                    continue
                if key.lower() == "content-length":
                    continue
                self.send_header(key, val)
            self.send_header("Content-Length", str(len(resp_body)))
            self.end_headers()

            self.wfile.write(resp_body)
            self.wfile.flush()
            conn.close()
        except Exception as exc:
            sys.stderr.write(f"[welcome-ui] proxy error: {exc}\n")
            try:
                self.send_error(502, "Sandbox unavailable")
            except Exception:
                pass
        finally:
            self._proxy_response = False
            self.close_connection = True

    def _proxy_websocket(self):
        """Pipe a WebSocket upgrade to the sandbox via raw sockets."""
        try:
            upstream = socket.create_connection(
                ("127.0.0.1", SANDBOX_PORT), timeout=5,
            )
        except OSError:
            self.send_error(502, "Sandbox unavailable")
            return

        req = f"{self.requestline}\r\n"
        for key, val in self.headers.items():
            if key.lower() == "host":
                req += f"Host: 127.0.0.1:{SANDBOX_PORT}\r\n"
            else:
                req += f"{key}: {val}\r\n"
        req += "\r\n"
        upstream.sendall(req.encode())

        client = self.connection

        def _pipe(src, dst):
            try:
                while True:
                    data = src.recv(65536)
                    if not data:
                        break
                    dst.sendall(data)
            except Exception:
                pass
            try:
                dst.shutdown(socket.SHUT_WR)
            except Exception:
                pass

        t1 = threading.Thread(target=_pipe, args=(client, upstream), daemon=True)
        t2 = threading.Thread(target=_pipe, args=(upstream, client), daemon=True)
        t1.start()
        t2.start()
        t1.join(timeout=7200)
        t2.join(timeout=7200)
        try:
            upstream.close()
        except Exception:
            pass
        self.close_connection = True

    # -- POST /api/install-openclaw ------------------------------------

    def _handle_install_openclaw(self):
        with _sandbox_lock:
            if _sandbox_state["status"] == "creating":
                return self._json_response(409, {
                    "ok": False,
                    "error": "Sandbox is already being created",
                })
            if _sandbox_state["status"] == "running":
                return self._json_response(409, {
                    "ok": False,
                    "error": "Sandbox is already running",
                })

        _maybe_detect_brev_id(self.headers.get("Host", ""))

        thread = threading.Thread(
            target=_run_sandbox_create,
            daemon=True,
        )
        thread.start()

        return self._json_response(200, {"ok": True})

    # -- POST /api/policy-sync ------------------------------------------

    def _handle_policy_sync(self):
        origin = self.headers.get("Origin", "unknown")
        _log(f"── POST /api/policy-sync received (origin={origin})")
        _log("step 1/4: reading request body")
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            _log("         REJECTED: empty body")
            return self._json_response(400, {"ok": False, "error": "empty body"})
        body = self.rfile.read(content_length).decode("utf-8", errors="replace")
        _log(f"         received {len(body)} bytes")
        if "version:" not in body:
            _log("         REJECTED: missing version field")
            return self._json_response(400, {
                "ok": False, "error": "invalid policy: missing version field",
            })
        result = _sync_policy_to_gateway(body)
        status = 200 if result.get("ok") else 502
        _log(f"── responding {status}: {json.dumps(result)}")
        return self._json_response(status, result)

    # -- POST /api/inject-key -------------------------------------------

    def _handle_inject_key(self):
        """Asynchronously update the NemoClaw provider credential.

        Returns immediately (202) and runs the slow CLI command in a
        background thread.  The frontend polls /api/sandbox-status to
        learn when injection is complete.
        """
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return self._json_response(400, {"ok": False, "error": "empty body"})
        raw = self.rfile.read(content_length).decode("utf-8", errors="replace")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return self._json_response(400, {"ok": False, "error": "invalid JSON"})

        key = data.get("key", "").strip()
        if not key:
            return self._json_response(400, {"ok": False, "error": "missing key"})

        key_hash = _hash_key(key)

        with _inject_key_lock:
            if (_inject_key_state["status"] == "done"
                    and _inject_key_state["key_hash"] == key_hash):
                return self._json_response(200, {"ok": True, "already": True})

            if (_inject_key_state["status"] == "injecting"
                    and _inject_key_state["key_hash"] == key_hash):
                return self._json_response(202, {"ok": True, "started": True})

            _inject_key_state["status"] = "injecting"
            _inject_key_state["error"] = None
            _inject_key_state["key_hash"] = key_hash

        thread = threading.Thread(
            target=_run_inject_key, args=(key, key_hash), daemon=True,
        )
        thread.start()

        return self._json_response(202, {"ok": True, "started": True})

    # -- GET /api/sandbox-status ----------------------------------------

    def _handle_sandbox_status(self):
        with _sandbox_lock:
            state = dict(_sandbox_state)

        if (state["status"] in ("creating", "idle")
                and _gateway_log_ready()
                and _port_open("127.0.0.1", SANDBOX_PORT)):
            token = _read_openclaw_token()
            url = _build_openclaw_url(token)
            with _sandbox_lock:
                _sandbox_state["status"] = "running"
                _sandbox_state["url"] = url
            state["status"] = "running"
            state["url"] = url

        with _inject_key_lock:
            key_injected = _inject_key_state["status"] == "done"
            key_inject_error = _inject_key_state.get("error")

        return self._json_response(200, {
            "status": state["status"],
            "url": state.get("url"),
            "error": state.get("error"),
            "key_injected": key_injected,
            "key_inject_error": key_inject_error,
        })

    # -- GET /api/connection-details ------------------------------------

    def _handle_connection_details(self):
        hostname = _get_hostname()
        return self._json_response(200, {
            "hostname": hostname,
            "gatewayPort": 8080,
            "instructions": {
                "install": "pip install nemoclaw",
                "connect": f"nemoclaw cluster connect {hostname}",
                "createSandbox": "nemoclaw sandbox create -- claude",
                "tui": "nemoclaw term",
            },
        })

    # -- Helpers --------------------------------------------------------

    def _json_response(self, status: int, body: dict):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[welcome-ui] {fmt % args}\n")


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("", PORT), Handler)
    print(f"NemoClaw Welcome UI → http://localhost:{PORT}")
    server.serve_forever()
