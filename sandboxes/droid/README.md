# Factory Droid Sandbox

OpenShell sandbox image pre-configured with [Factory Droid CLI](https://docs.factory.ai/) for AI-powered software engineering.

## What's Included

- **Droid CLI** (`droid@0.90.0`) — Factory's AI coding agent
- Everything from the [base sandbox](../base/README.md)

## Build

```bash
docker build -t openshell-droid .
```

To build against a specific base image:

```bash
docker build -t openshell-droid --build-arg BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest .
```

## Usage

### 1. Set up inference routing

Direct access to NVIDIA inference endpoints (`inference-api.nvidia.com`, `integrate.api.nvidia.com`) is blocked inside OpenShell sandboxes (SSRF protection). Use OpenShell's `inference.local` routing instead:

```bash
# Create an NVIDIA provider with your API key
openshell provider create \
  --name nvidia \
  --type nvidia \
  --credential "NVIDIA_API_KEY=nvapi-YOUR_KEY_HERE"

# Configure inference routing
openshell inference set \
  --provider nvidia \
  --model "nvidia/nemotron-3-super-120b-a12b" \
  --no-verify
```

### 2. Create the sandbox

The `--provider` flag is **required** so that `inference.local` is available inside the sandbox:

```bash
openshell sandbox create --from droid --provider nvidia
```

### 3. Configure Droid inside the sandbox

```bash
mkdir -p /sandbox/.factory
cat > /sandbox/.factory/settings.json << 'EOF'
{
  "cloudSessionSync": false,
  "includeCoAuthoredByDroid": false,
  "enableDroidShield": false,
  "commandDenylist": [],
  "modelPolicy": { "allowCustomModels": true, "allowAllFactoryModels": false },
  "customModels": [{
    "id": "custom:nvidia/nemotron-3-super-120b-a12b",
    "model": "nvidia/nemotron-3-super-120b-a12b",
    "baseUrl": "https://inference.local/v1",
    "apiKey": "EMPTY",
    "displayName": "Nemotron Super 120B",
    "maxContextLimit": 131072,
    "enableThinking": true,
    "maxOutputTokens": 16384,
    "noImageSupport": true,
    "provider": "generic-chat-completion-api"
  }],
  "sessionDefaultSettings": {
    "model": "custom:nvidia/nemotron-3-super-120b-a12b",
    "autonomyMode": "auto-low"
  }
}
EOF
```

Key details:
- `baseUrl` must be `https://inference.local/v1` (not the external NVIDIA endpoint)
- `apiKey` can be `EMPTY` because the OpenShell privacy router injects credentials from the provider config

### 4. Run Droid

```bash
export FACTORY_API_KEY=fk-YOUR_KEY_HERE
droid exec --skip-permissions-unsafe --model "custom:nvidia/nemotron-3-super-120b-a12b" "echo hello"
```
