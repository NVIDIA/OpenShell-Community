# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Cursor Desktop sandbox image for OpenShell Community
#
# Runs the Cursor Linux desktop application inside an OpenShell sandbox and
# delivers the UI through a browser using Xvfb + openbox + x11vnc + noVNC.
# Cursor is treated as an agent-capable desktop application kept inside
# OpenShell policy boundaries.
#
# Run:    openshell sandbox create --from cursor-desktop --forward 6080
# Build:  docker build --build-arg CURSOR_VERSION=2.6 -t openshell-cursor-desktop .

# ── Base ───────────────────────────────────────────────────────────────────────
# Use the NVIDIA-pinned Ubuntu noble base as all community sandboxes.
# NOTE: Cursor ships amd64-only packages. On amd64 hosts the full stack is
# installed. On arm64 hosts (e.g. Apple Silicon via OpenShell) the image builds
# with Firefox instead of Chrome, and Cursor is skipped — the display stack
# still starts so the noVNC session is reachable for validation.
# For full local testing on Apple Silicon use local-test.sh (Docker Desktop
# with --platform linux/amd64 uses Rosetta 2 to run the amd64 image).
FROM nvcr.io/nvidia/base/ubuntu:noble-20251013

# ── Build arguments ────────────────────────────────────────────────────────────
# Pin the Cursor version for reproducible builds.
ARG CURSOR_VERSION=2.6

# ── Environment ────────────────────────────────────────────────────────────────
ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:1 \
    VNC_PORT=5901 \
    NOVNC_PORT=6080 \
    CURSOR_VERSION=${CURSOR_VERSION}

WORKDIR /sandbox

# ── System packages ────────────────────────────────────────────────────────────
# Note: libasound2 was renamed to libasound2t64 in Ubuntu 24.04 (noble).
# novnc installs to /usr/share/novnc/ on noble — do NOT reference /opt/novnc/.
# netcat-openbsd (healthcheck/startup probes) and x11-utils (provides xdpyinfo).
# The NVIDIA base image only enables Ubuntu 'main'; fonts-liberation (required by
# google-chrome-stable) lives in 'universe', so enable it first.
RUN apt-get update && \
    apt-get install -y --no-install-recommends software-properties-common && \
    add-apt-repository universe && \
    apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git wget gnupg file xdg-utils \
        dbus-x11 \
        openbox wmctrl xterm \
        xvfb \
        x11vnc \
        novnc websockify nginx \
        x11-utils x11-xserver-utils netcat-openbsd \
        libgtk-3-0 libnss3 libxss1 libasound2t64 libxrandr2 libxdamage1 \
        libgbm1 libxcomposite1 libxfixes3 libx11-xcb1 libxcb-dri3-0 \
        libdrm2 libglib2.0-0 libatk1.0-0 libatk-bridge2.0-0 libxkbcommon0 \
        fonts-dejavu fonts-noto-color-emoji \
        procps net-tools python3 python3-xdg \
    && rm -rf /var/lib/apt/lists/*

# ── Browser ────────────────────────────────────────────────────────────────────
# On amd64: Google Chrome from the official .deb (chromium-browser on Ubuntu
# 24.04 is a snap stub and doesn't work in containers).
# On arm64: Firefox, which ships native arm64 .deb packages. The Cursor OAuth
# flow works with any modern browser.
RUN ARCH=$(dpkg --print-architecture) && \
    apt-get update && \
    if [ "$ARCH" = "amd64" ]; then \
        curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
            -o /tmp/browser.deb && \
        apt-get install -y /tmp/browser.deb && \
        rm -f /tmp/browser.deb; \
    else \
        apt-get install -y --no-install-recommends firefox; \
    fi && \
    rm -rf /var/lib/apt/lists/*

# ── Users ──────────────────────────────────────────────────────────────────────
# Create supervisor and sandbox users to match the community sandbox convention.
RUN groupadd -r supervisor && \
    useradd -r -g supervisor -s /usr/sbin/nologin supervisor && \
    groupadd -r sandbox && \
    useradd -r -g sandbox -d /sandbox -s /bin/bash sandbox

# ── Workspace directory ────────────────────────────────────────────────────────
RUN mkdir -p /sandbox/workspace && chown -R sandbox:sandbox /sandbox

# ── Cursor installation ────────────────────────────────────────────────────────
# Cursor ships amd64-only AppImages. Skip on arm64 — the display stack still
# starts and the noVNC session is reachable for smoke-testing the sandbox.
COPY scripts/install-cursor.sh /tmp/install-cursor.sh
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then \
        bash /tmp/install-cursor.sh; \
    else \
        echo "INFO: Cursor is amd64-only, skipping on $ARCH (display stack still starts)."; \
    fi && \
    rm -f /tmp/install-cursor.sh

# ── Disable Cursor auto-update ─────────────────────────────────────────────────
# Pre-seed settings so Cursor doesn't auto-update or report telemetry on first
# launch. Written unconditionally — harmless when Cursor was skipped on arm64.
RUN mkdir -p /sandbox/.config/Cursor/User && \
    printf '{"update.mode":"none","telemetry.telemetryLevel":"off"}\n' \
        > /sandbox/.config/Cursor/User/settings.json && \
    chown -R sandbox:sandbox /sandbox/.config

# ── Browser setup ──────────────────────────────────────────────────────────────
# Wire whichever browser was installed as the system default and xdg-open
# target so Electron's shell.openExternal() reaches the right browser.
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then \
        BROWSER_BIN=/usr/bin/google-chrome-stable && \
        BROWSER_DESKTOP=google-chrome.desktop && \
        # Wrap chrome to pass --no-sandbox (no user namespaces inside containers).
        mv /usr/bin/google-chrome-stable /usr/bin/google-chrome-stable.real && \
        printf '#!/bin/sh\nexec /usr/bin/google-chrome-stable.real --no-sandbox "$@"\n' \
            > /usr/bin/google-chrome-stable && \
        chmod +x /usr/bin/google-chrome-stable && \
        ln -sf /usr/bin/google-chrome-stable /usr/bin/google-chrome; \
    else \
        BROWSER_BIN=/usr/bin/firefox && \
        BROWSER_DESKTOP=firefox.desktop; \
    fi && \
    update-alternatives --install /usr/bin/x-www-browser x-www-browser \
        "$BROWSER_BIN" 200 && \
    update-alternatives --set x-www-browser "$BROWSER_BIN" && \
    printf "#!/bin/sh\nexec %s \"\$@\"\n" "$BROWSER_BIN" > /usr/local/bin/xdg-open && \
    chmod +x /usr/local/bin/xdg-open && \
    mv /usr/bin/xdg-open /usr/bin/xdg-open.real && \
    printf "#!/bin/sh\nexec %s \"\$@\"\n" "$BROWSER_BIN" > /usr/bin/xdg-open && \
    chmod +x /usr/bin/xdg-open && \
    mkdir -p /sandbox/.config && \
    printf "[Default Applications]\nx-scheme-handler/http=%s\nx-scheme-handler/https=%s\ntext/html=%s\n\n[Added Associations]\nx-scheme-handler/http=%s\nx-scheme-handler/https=%s\n" \
        "$BROWSER_DESKTOP" "$BROWSER_DESKTOP" "$BROWSER_DESKTOP" \
        "$BROWSER_DESKTOP" "$BROWSER_DESKTOP" \
        > /sandbox/.config/mimeapps.list && \
    chown sandbox:sandbox /sandbox/.config/mimeapps.list

# ── Openbox config ─────────────────────────────────────────────────────────────
# rc.xml: auto-raises new windows (Chrome auth popup) above the maximised Cursor
# window. autostart: launches Cursor inside the dbus session so xdg-open works.
RUN mkdir -p /sandbox/.config/openbox
COPY scripts/openbox-rc.xml    /sandbox/.config/openbox/rc.xml
COPY scripts/openbox-autostart /sandbox/.config/openbox/autostart
RUN chmod +x /sandbox/.config/openbox/autostart && \
    chown -R sandbox:sandbox /sandbox/.config/openbox

# ── noVNC custom index ─────────────────────────────────────────────────────────
# Replaces the default noVNC UI with a minimal page that connects directly
# and scales the desktop to fill the browser window.
COPY scripts/novnc-index.html /usr/share/novnc/index.html

# ── nginx config ───────────────────────────────────────────────────────────────
# nginx serves /usr/share/novnc/ over HTTP (port 6080) and proxies the
# /websockify path to an internal websockify instance (port 5902).
# All writable paths use /tmp so nginx can run as the non-root sandbox user.
COPY scripts/nginx.conf /etc/nginx/novnc.conf

# ── Policy ─────────────────────────────────────────────────────────────────────
COPY policy.yaml /etc/openshell/policy.yaml

# ── Skills ─────────────────────────────────────────────────────────────────────
COPY skills/ /sandbox/.agents/skills/
RUN mkdir -p /sandbox/.claude/skills && \
    for skill in /sandbox/.agents/skills/*/; do \
        [ -d "$skill" ] || continue; \
        ln -sf "$skill" "/sandbox/.claude/skills/$(basename "$skill")"; \
    done && \
    chown -R sandbox:sandbox /sandbox/.claude /sandbox/.agents

# ── Shell init ─────────────────────────────────────────────────────────────────
RUN printf 'export DISPLAY=:1\nexport PS1="\\u@cursor-desktop:\\w\\$ "\n' \
        >> /sandbox/.bashrc && \
    chown sandbox:sandbox /sandbox/.bashrc

# ── Entrypoint and health scripts ──────────────────────────────────────────────
COPY startup.sh     /usr/local/bin/startup
COPY healthcheck.sh /usr/local/bin/healthcheck
RUN chmod 755 /usr/local/bin/startup /usr/local/bin/healthcheck

# ── Health check ───────────────────────────────────────────────────────────────
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
    CMD /usr/local/bin/healthcheck

EXPOSE 5901 6080

# Run as sandbox to match community convention and OpenShell's process policy.
# Pre-create /tmp/.X11-unix with sticky-bit permissions so Xvfb can create its
# socket when running as the non-root sandbox user (euid != 0 prevents Xvfb
# from creating this directory itself).
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

# All display services (Xvfb, openbox, x11vnc, noVNC) run without root — they
# only need write access to /tmp (X11 sockets) and network (VNC/noVNC ports).
USER sandbox

ENTRYPOINT ["/bin/bash", "/usr/local/bin/startup"]
CMD []
