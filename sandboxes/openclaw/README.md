# OpenClaw Sandbox

OpenShell sandbox image pre-configured with [OpenClaw](https://github.com/openclaw) for open agent manipulation and control.

## What's Included

| File | Purpose |
|---|---|
| `Dockerfile` | Builds the sandbox image with OpenClaw + WS proxy patch |
| `policy.yaml` | Network policies for 12 services (LLMs, Slack, GitHub, …) |
| `openclaw-ws-proxy-patch.js` | Monkey-patches `ws` to tunnel Slack WebSockets through the CONNECT proxy |
| `openclaw-slack-manifest.yaml` | One-click Slack app manifest with all 23 scopes and 12 events |
| `openclaw-start.sh` | Gateway lifecycle manager (start / stop / status / logs / pair) |

## Build

```bash
docker build -t openshell-openclaw .
```

To build against a specific base image:

```bash
docker build -t openshell-openclaw \
  --build-arg BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest .
```

## Usage

### Create a sandbox

```bash
openshell sandbox create --from openclaw --forward 18789 -- openclaw-start
```

This runs `openclaw-start` which:

1. Runs `openclaw onboard` to configure the environment
2. Starts the OpenClaw gateway under `nohup` (survives SSH disconnects)
3. Prints the gateway URL (with auth token if available)

Access the UI at `http://127.0.0.1:18789/`.

### Gateway management

Once inside the sandbox:

```bash
openclaw-start              # start (or restart) the gateway
openclaw-start stop         # stop the gateway
openclaw-start status       # check if running
openclaw-start logs         # tail the gateway log
openclaw-start pair CODE    # approve a Slack/Telegram pairing request
```

### Manual startup

```bash
openclaw onboard
openclaw gateway run
```

## Network Policy Coverage

The included `policy.yaml` covers:

| Category | Services |
|---|---|
| **LLM providers** | Anthropic, OpenAI, Google (Gemini/Vertex) |
| **Messaging** | Telegram, Slack REST API, Slack Socket Mode (WebSocket) |
| **Code** | GitHub (git + REST API), npm, PyPI |
| **Search** | Brave Search, OpenRouter |
| **Web** | LinkedIn |

All policies default to `enforcement: audit` except Slack WebSocket which uses `enforcement: enforce`.

### Slack wildcard gotcha

Do **not** add a `*.slack.com` wildcard to the `slack` policy. On OpenShell ≤ 0.0.15, a wildcard match takes priority over the `slack_websocket` policy's `tls: skip` setting, causing the L7 proxy to intercept the TLS handshake and break Socket Mode.

## WebSocket Proxy Patch

OpenShell routes all outbound traffic through an HTTP CONNECT proxy. The Slack SDK's `ws` library does not natively support CONNECT proxies for WebSocket connections. The `openclaw-ws-proxy-patch.js` file monkey-patches the `ws` module to:

1. Detect connections to `wss-primary.slack.com` and `wss-backup.slack.com`
2. Establish a CONNECT tunnel through the proxy
3. Perform TLS over the tunnel

The patch is auto-loaded via `NODE_OPTIONS="--require /sandbox/openclaw-ws-proxy-patch.js"` set in the Dockerfile.

> **Related:** [OpenShell #387](https://github.com/NVIDIA/OpenShell-Community/issues/387) — feature request for native WebSocket proxy support.

## Slack Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From an app manifest**
3. Paste `openclaw-slack-manifest.yaml`
4. Generate an **App-Level Token** with `connections:write` scope
5. Install to your workspace and copy the **Bot User OAuth Token**
6. Pass both tokens during `openclaw onboard`

## Troubleshooting

### DNS resolution fails inside the sandbox

OpenShell's CoreDNS may not forward external queries by default. Patch the Corefile to add `forward . 8.8.8.8 8.8.4.4`:

```bash
openshell doctor exec -- kubectl patch configmap coredns -n kube-system \
  --type merge -p '{"data":{"Corefile":"...<see setup script>..."}}'
openshell doctor exec -- kubectl rollout restart deployment coredns -n kube-system
```

### Slack Socket Mode disconnects or times out

- Verify `tls: skip` is set on `wss-primary.slack.com` and `wss-backup.slack.com` in `policy.yaml`
- Confirm `NODE_OPTIONS` includes `--require /sandbox/openclaw-ws-proxy-patch.js`
- Check logs: `openclaw-start logs | grep ws-proxy-patch`

### Gateway won't start

- Run `openclaw-start status` to check for zombie processes
- Run `openclaw-start stop` then `openclaw-start` to restart cleanly
- Inspect the log: `cat /sandbox/.openclaw/gateway.log`

## Configuration

OpenClaw stores its configuration in `~/.openclaw/openclaw.json` inside the sandbox. The config is generated during `openclaw onboard`.
