#!/usr/bin/env python3

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""NemoClaw Welcome UI — HTTP server with sandbox lifecycle APIs."""

import http.server
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time

PORT = int(os.environ.get("PORT", 8081))
ROOT = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.environ.get("REPO_ROOT", os.path.join(ROOT, "..", ".."))
SANDBOX_DIR = os.path.join(REPO_ROOT, "sandboxes", "nemoclaw")

LOG_FILE = "/tmp/nemoclaw-sandbox-create.log"

_sandbox_lock = threading.Lock()
_sandbox_state = {
    "status": "idle",  # idle | creating | running | error
    "pid": None,
    "url": None,
    "error": None,
}


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


def _cleanup_existing_sandbox():
    """Delete any leftover sandbox named 'nemoclaw' from a previous attempt."""
    try:
        subprocess.run(
            ["nemoclaw", "sandbox", "delete", "nemoclaw"],
            capture_output=True, timeout=30,
        )
    except Exception:
        pass


def _run_sandbox_create(api_key: str, brev_ui_url: str):
    """Background thread: runs nemoclaw sandbox create and monitors until ready."""
    global _sandbox_state

    with _sandbox_lock:
        _sandbox_state["status"] = "creating"
        _sandbox_state["error"] = None
        _sandbox_state["url"] = None

    _cleanup_existing_sandbox()

    env = os.environ.copy()
    # Use `env` to inject vars into the sandbox command.  Avoids the
    # nemoclaw -e flag which has a quoting bug that causes SSH to
    # misinterpret the export string as a cipher type.
    cmd = [
        "nemoclaw", "sandbox", "create",
        "--name", "nemoclaw",
        "--from", SANDBOX_DIR,
        "--forward", "18789",
        "--",
        "env",
        f"NVIDIA_INFERENCE_API_KEY={api_key}",
        f"NVIDIA_INTEGRATE_API_KEY={api_key}",
        f"BREV_UI_URL={brev_ui_url}",
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
            if _port_open("127.0.0.1", 18789):
                token = _read_openclaw_token()
                url = "http://127.0.0.1:18789/"
                if token:
                    url += f"?token={token}"
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


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    # -- Routing --------------------------------------------------------

    def do_POST(self):
        if self.path == "/api/install-openclaw":
            return self._handle_install_openclaw()
        self.send_error(404)

    def do_GET(self):
        if self.path == "/api/sandbox-status":
            return self._handle_sandbox_status()
        if self.path == "/api/connection-details":
            return self._handle_connection_details()
        return super().do_GET()

    # -- POST /api/install-openclaw ------------------------------------

    def _handle_install_openclaw(self):
        content_length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(content_length) if content_length else b"{}"
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return self._json_response(400, {"ok": False, "error": "Invalid JSON"})

        api_key = data.get("apiKey", "").strip()
        if not api_key:
            return self._json_response(400, {"ok": False, "error": "apiKey is required"})

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

        brev_ui_url = f"http://{self.headers.get('Host', 'localhost:8080')}"

        thread = threading.Thread(
            target=_run_sandbox_create,
            args=(api_key, brev_ui_url),
            daemon=True,
        )
        thread.start()

        return self._json_response(200, {"ok": True})

    # -- GET /api/sandbox-status ----------------------------------------

    def _handle_sandbox_status(self):
        with _sandbox_lock:
            state = dict(_sandbox_state)

        if state["status"] == "creating" and _port_open("127.0.0.1", 18789):
            token = _read_openclaw_token()
            url = "http://127.0.0.1:18789/"
            if token:
                url += f"?token={token}"
            with _sandbox_lock:
                _sandbox_state["status"] = "running"
                _sandbox_state["url"] = url
            state["status"] = "running"
            state["url"] = url

        return self._json_response(200, {
            "status": state["status"],
            "url": state.get("url"),
            "error": state.get("error"),
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
