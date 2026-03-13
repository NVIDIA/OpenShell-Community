# NeMoClaw Sandbox

NemoClaw sandbox image that layers the **NeMoClaw DevX UI extension** on top of the [OpenClaw](https://github.com/openclaw) sandbox.

## What's Included

Everything from the `openclaw` sandbox (OpenClaw CLI, gateway, Node.js 22, developer tools), plus:

- **NVIDIA Model Selector** — switch between NVIDIA-hosted models (Kimi K2.5, Nemotron 3 Super, DeepSeek V3.2) directly from the OpenClaw UI
- **Deploy Modal** — one-click deploy to DGX Spark / DGX Station from any conversation
- **API Keys Page** — settings page to enter and manage NVIDIA API keys, persisted in browser `localStorage`
- **NeMoClaw Nav Group** — sidebar navigation with status indicators for key configuration
- **Contextual Nudges** — inline links in error states that guide users to configure missing API keys
- **nemoclaw-start** — startup script that injects API keys, onboards, and starts the gateway

## Build

Build from the sandbox directory:

```bash
docker build -t nemoclaw sandboxes/nemoclaw/
```

## Usage

### Create a sandbox

```bash
nemoclaw sandbox create --from sandboxes/nemoclaw \
  --forward 18789 \
  -- env CHAT_UI_URL=http://127.0.0.1:18789 \
         nemoclaw-start
```

The `--from <path>` flag builds the image and imports it into the cluster automatically.

`CHAT_UI_URL` is the URL where the chat UI will be accessed. The origin is
added to `allowedOrigins` so the browser can authenticate without the slow
device-pairing fallback. Examples:

| Environment | `CHAT_UI_URL` |
|---|---|
| Local | `http://127.0.0.1:18789` |
| Brev | `https://187890-<id>.brevlab.com` |

`nemoclaw-start` then:

1. Substitutes `__NVIDIA_*_API_KEY__` placeholders in the bundled JS with runtime environment variables (if provided)
2. Runs `openclaw onboard` to configure the environment
3. Starts the OpenClaw gateway in the background
4. Prints the gateway URL with auth token

Access the UI at `http://127.0.0.1:18789/`.

### API Keys

API keys can be provided in two ways (in order of precedence):

1. **Browser `localStorage`** — enter keys via the API Keys page in the UI sidebar (persists across page reloads)
2. **Environment variables** — baked into the JS bundle at container startup by `nemoclaw-start`

| Variable | Description |
|---|---|
| `NVIDIA_INTEGRATE_API_KEY` | Key for `integrate.api.nvidia.com` (Kimi K2.5, Nemotron Ultra, DeepSeek V3.2) |

Keys are optional at sandbox creation time. If omitted, the UI will prompt users to enter them via the API Keys page.

### Manual startup

If you prefer to start OpenClaw manually inside the sandbox:

```bash
nemoclaw sandbox connect <sandbox-name>
openclaw onboard
openclaw gateway run
```

Note: without running `nemoclaw-start`, the API key placeholders will remain as literals and model endpoints will not work unless keys are entered via the UI.

## How the Extension Works

The extension source lives in `nemoclaw-ui-extension/extension/` within this directory. At Docker build time:

1. The TypeScript + CSS source is staged at `/opt/nemoclaw-devx/`
2. `esbuild` bundles it into `nemoclaw-devx.js` and `nemoclaw-devx.css`
3. The bundles are placed in the OpenClaw SPA assets directory (`dist/control-ui/assets/`)
4. `<script>` and `<link>` tags are injected into `index.html` via `sed`
5. `esbuild` is uninstalled to keep the image lean

At runtime, the extension bootstraps via `MutationObserver`, detecting OpenClaw DOM elements and injecting the model selector, deploy modal, nav group, and API keys page as overlays.

## Extension Source Files

| File | Purpose |
|---|---|
| `index.ts` | Entry point — bootstraps all components, wires `data-nemoclaw-goto` navigation |
| `model-registry.ts` | Model definitions, API key getters/setters (localStorage + env fallback) |
| `model-selector.ts` | Dropdown to switch between NVIDIA models |
| `deploy-modal.ts` | Deploy-to-DGX modal with target selection |
| `api-keys-page.ts` | API Keys settings page with masked inputs and save/validation |
| `nav-group.ts` | Sidebar navigation group with status dot indicators |
| `gateway-bridge.ts` | Communication bridge to the OpenClaw gateway |
| `icons.ts` | SVG icon constants |
| `styles.css` | All extension styles |
