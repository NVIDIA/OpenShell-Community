# NemoClaw for OpenClaw

Use NemoClaw through OpenClaw to drive OpenShell-backed sandbox workflows.
This launchable is opinionated toward OpenClaw as the primary interface and
OpenShell as the runtime beneath it.

## Install

### Prerequisites

```bash
npm install -g openclaw@latest
```

Install the NemoClaw plugin from a public GitHub checkout:

```bash
cd /home/ubuntu
git clone https://github.com/NVIDIA/openshell-openclaw-plugin.git
cd /home/ubuntu/openshell-openclaw-plugin/nemoclaw
npm install
npm run build
openclaw plugins install .
```

Install the NemoClaw plugin from a private GitHub checkout:

```bash
cd /home/ubuntu
git clone https://x-access-token:${GITHUB_TOKEN}@github.com/NVIDIA/openshell-openclaw-plugin.git
cd /home/ubuntu/openshell-openclaw-plugin/nemoclaw
npm install
npm run build
openclaw plugins install .
```

Install the NemoClaw plugin from the local path created by `brev/launch-plugin.sh`:

```bash
cd /home/ubuntu/openshell-openclaw-plugin/nemoclaw
npm install
npm run build
openclaw plugins install .
```

If you also want the standalone helper CLI used by this launchable:

```bash
cd /home/ubuntu/openshell-openclaw-plugin
sudo npm install -g .
nemoclaw setup
```

## OpenClaw Commands

| Command | Description |
|---------|-------------|
| `openclaw nemoclaw launch` | Fresh install into OpenShell (warns net-new users) |
| `openclaw nemoclaw migrate` | Migrate host OpenClaw into sandbox (snapshot + cutover) |
| `openclaw nemoclaw connect` | Interactive shell into the sandbox |
| `openclaw nemoclaw status` | Blueprint state, sandbox health, inference config |
| `openclaw nemoclaw eject` | Rollback to host installation from snapshot |
| `/nemoclaw` | Slash command in chat (status, eject) |

## Usage

### Connect to the sandbox

```bash
nemoclaw connect                # local
nemoclaw connect my-gpu-box     # remote Brev instance
```

### Run OpenClaw (inside the sandbox)

```bash
openclaw agent --agent main --local -m "your prompt" --session-id s1
```

### Switch inference providers

```bash
# NVIDIA cloud (Nemotron 3 Super 120B)
openshell inference set --provider nvidia-nim --model nvidia/nemotron-3-super-120b-a12b

# Local vLLM
openshell inference set --provider vllm-local --model nvidia/nemotron-3-nano-30b-a3b
```

### Monitor

```bash
openshell term
```
