# OpenClaw Sandbox

NemoClaw sandbox image pre-configured with [OpenClaw](https://github.com/openclaw) for open agent manipulation and control.

## What's Included

- **OpenClaw CLI** -- Agent orchestration and gateway management
- **OpenClaw Gateway** -- Local gateway for agent-to-tool communication
- **Node.js 22** -- Runtime required by the OpenClaw gateway
- **openclaw-start** -- Helper script that onboards and starts the gateway automatically

## Build

```bash
docker build -t nemoclaw-openclaw .
```

To build against a specific base image:

```bash
docker build -t nemoclaw-openclaw --build-arg BASE_IMAGE=nemoclaw/sandbox:v0.1.0 .
```

## Usage

### Create a sandbox

```bash
nemoclaw sandbox create --from openclaw
```

### With port forwarding (to access the OpenClaw UI)

```bash
nemoclaw sandbox create --from openclaw --forward 18789 -- openclaw-start
```

This runs the `openclaw-start` helper which:

1. Runs `openclaw onboard` to configure the environment
2. Starts the OpenClaw gateway in the background
3. Prints the gateway URL (with auth token if available)

Access the UI at `http://127.0.0.1:18789/`.

### Manual startup

If you prefer to start OpenClaw manually inside the sandbox:

```bash
openclaw onboard
openclaw gateway run
```

## Configuration

OpenClaw stores its configuration in `~/.openclaw/openclaw.json` inside the sandbox. The config is generated during `openclaw onboard`.
