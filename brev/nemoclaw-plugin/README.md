# NemoClaw for OpenClaw

Use NemoClaw through OpenClaw to drive OpenShell-backed sandbox workflows.
This Launchable is opinionated toward OpenClaw as the primary interface and
OpenShell as the runtime beneath it.

## Launchable Flow

When this Brev Launchable completes host setup, it opens `code-server` and
starts an interactive terminal that runs:

```bash
cd ${HOME}/NemoClaw
bash ./install.sh
```

## Manual Install

If you want to run the plugin installer yourself:

```bash
cd ${HOME}/NemoClaw
bash ./install.sh
```

Public GitHub checkout:

```bash
cd ${HOME}
git clone https://github.com/NVIDIA/NemoClaw.git
cd ${HOME}/NemoClaw
bash ./install.sh
```

## NemoClaw Commands

### Getting Started

| Command | Description |
|---------|-------------|
| `nemoclaw onboard` | Interactive setup wizard (recommended) |
| `nemoclaw setup` | Legacy setup (deprecated, use `onboard`) |
| `nemoclaw setup-spark` | Set up on DGX Spark (fixes cgroup v2 + Docker) |

### Sandbox Management

| Command | Description |
|---------|-------------|
| `nemoclaw list` | List all sandboxes |
| `nemoclaw <name> connect` | Connect to a sandbox |
| `nemoclaw <name> status` | Show sandbox status and health |
| `nemoclaw <name> logs [--follow]` | View sandbox logs |
| `nemoclaw <name> destroy` | Stop NIM + delete sandbox |

### Policy Presets

| Command | Description |
|---------|-------------|
| `nemoclaw <name> policy-add` | Add a policy preset to a sandbox |
| `nemoclaw <name> policy-list` | List presets (● = applied) |

### Deploy

| Command | Description |
|---------|-------------|
| `nemoclaw deploy <instance>` | Deploy to a Brev VM and start services |

### Services

| Command | Description |
|---------|-------------|
| `nemoclaw start` | Start services (Telegram, tunnel) |
| `nemoclaw stop` | Stop all services |
| `nemoclaw status` | Show sandbox list and service status |

## Usage

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
