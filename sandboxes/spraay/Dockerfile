ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest
FROM ${BASE_IMAGE}

# ── Spraay x402 Payment Toolkit ──────────────────────────────────────────────
# Pre-configured sandbox for AI agent crypto payments via the x402 protocol.
# Supports 13 blockchains, 76+ gateway endpoints, batch payments, escrow,
# payroll, token swaps, and Robot Task Protocol (RTP).

# Install Node.js (required for ethers.js wallet operations)
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g ethers@6 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Python dependencies for wallet and signing operations
USER sandbox
RUN pip install --no-cache-dir \
    httpx \
    eth-account \
    web3 \
    pynacl \
    base58

# ── Spraay CLI wrapper ──────────────────────────────────────────────────────
COPY spraay.sh /usr/local/bin/spraay
USER root
RUN chmod +x /usr/local/bin/spraay
USER sandbox

# ── Agent skills ─────────────────────────────────────────────────────────────
COPY skills/ /sandbox/.agents/skills/

# ── Default environment ──────────────────────────────────────────────────────
ENV SPRAAY_GATEWAY_URL=https://gateway.spraay.app
ENV SPRAAY_CHAIN=base

# ── Healthcheck ──────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf ${SPRAAY_GATEWAY_URL}/health || exit 1
