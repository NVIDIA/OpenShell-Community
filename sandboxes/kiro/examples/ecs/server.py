#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Minimal HTTP wrapper around Kiro CLI for ECS/Fargate deployment."""
import subprocess
import json
import os
import re
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get("PORT", "8080"))

ANSI_RE = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]|\x1b\[\?[0-9;]*[a-zA-Z]|\x1b\[[0-9]*G|\x1b\(B|\x1b\[m')
BRAILLE_RANGE = range(0x2800, 0x28FF + 1)


def strip_ansi(text):
    return ANSI_RE.sub('', text)


def is_noise_line(line):
    stripped = line.strip()
    if not stripped:
        return True
    if any(ord(c) in BRAILLE_RANGE for c in stripped):
        return True
    if 'Thinking...' in stripped:
        return True
    if re.match(r'^[\d%\s>]+$', stripped):
        return True
    noise_markers = [
        'Jump into building with Kiro', '/context add', '/mcp', '/help',
        '/model', '/usage', '/quit', 'Credits:', 'To exit the CLI',
        'Ask a question', 'Connect to external tools', 'Model:', 'Plan:',
    ]
    return any(marker in stripped for marker in noise_markers)


def clean_output(text):
    cleaned = strip_ansi(text)
    cleaned = re.sub(r'[^\x20-\x7E\n]', '', cleaned)
    cleaned = re.sub(r'\d+%\s*>', '', cleaned)
    cleaned = re.sub(r'\s*>\s*$', '', cleaned, flags=re.MULTILINE)
    lines = cleaned.split('\n')
    result_lines = []
    for line in lines:
        if not is_noise_line(line):
            content = line.strip()
            if content.startswith('> '):
                content = content[2:]
            if content:
                result_lines.append(content)
    return '\n'.join(result_lines).strip()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {"status": "healthy"})
        else:
            self._respond(200, {"service": "kiro-sandbox", "usage": "POST / with {\"command\": \"...\"}"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        command = body.get("command", "")
        if not command:
            self._respond(400, {"error": "missing 'command' field"})
            return
        try:
            result = subprocess.run(
                ["kiro", "chat", command],
                capture_output=True, text=True, timeout=120,
                env={**os.environ, "NO_COLOR": "1", "TERM": "dumb"}
            )
            self._respond(200, {"response": clean_output(result.stdout), "exit_code": result.returncode})
        except subprocess.TimeoutExpired:
            self._respond(504, {"error": "command timed out (120s)"})

    def _respond(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    print(f"Kiro sandbox API listening on :{PORT}")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
