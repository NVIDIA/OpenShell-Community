# Spraay — Crypto Payment Sandbox for OpenShell

OpenShell sandbox image pre-configured with [Spraay](https://spraay.app) for AI agent crypto payments via the x402 protocol.

## What's Included

| Component | Description |
|-----------|-------------|
| **Spraay CLI** | Shell wrapper for 76+ paid gateway endpoints across 13 blockchains |
| **x402 Protocol** | HTTP 402-based micropayment protocol — agents pay per request with USDC |
| **Agent Skills** | Pre-built skills for batch payments, escrow, payroll, token swaps, and Robot Task Protocol (RTP) |
| **Multi-Chain** | Base, Ethereum, Arbitrum, Polygon, BNB, Avalanche, Solana, Bitcoin, Stacks, Unichain, Plasma, BOB, Bittensor |

## Quick Start

### Using the pre-built image

```bash
openshell sandbox create --from spraay -- claude
```

### Building locally

```bash
docker build -t openshell-spraay \
  --build-arg BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest .
```

Then launch:

```bash
openshell sandbox create --from openshell-spraay -- claude
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SPRAAY_GATEWAY_URL` | No | Gateway URL (default: `https://gateway.spraay.app`) |
| `SPRAAY_PAYMENT_ADDRESS` | Yes | Your wallet address for x402 payments |
| `SPRAAY_CHAIN` | No | Default chain (default: `base`) |

## Skills

The sandbox ships with agent skills in `.agents/skills/`:

| Skill | Description |
|-------|-------------|
| `spraay-payments` | Batch send tokens to multiple recipients on any supported chain |
| `spraay-escrow` | Create and manage escrow contracts with milestone-based releases |
| `spraay-rtp` | Robot Task Protocol — hire robots and IoT devices via x402 micropayments |
| `spraay-gateway` | Query gateway endpoints, check pricing, discover available routes |

## Network Policy

The default network policy allows egress to:

- `gateway.spraay.app` — Spraay x402 gateway (HTTPS)
- `*.infura.io` — RPC provider (HTTPS)
- `*.alchemy.com` — RPC provider (HTTPS)
- `*.base.org` — Base chain RPC (HTTPS)

All other egress is denied by default. Customize via OpenShell policy overrides.

## How x402 Works Inside the Sandbox

1. Agent calls a Spraay gateway endpoint (e.g., `/v1/batch-send`)
2. Gateway returns HTTP `402 Payment Required` with a payment header
3. Agent signs USDC payment using its configured wallet
4. Gateway verifies payment on-chain and executes the request
5. Agent receives the result

The sandbox enforces that all payment signing happens within the isolated environment. Private keys never leave the sandbox boundary.

## Use Cases

- **Autonomous payroll**: Agent runs scheduled batch payments to employees/contractors
- **Escrow automation**: Agent creates milestone-based escrow for freelance work
- **Robot hiring**: Agent uses RTP to commission physical tasks from IoT devices
- **Multi-chain treasury**: Agent manages token distributions across 13+ chains
- **DCA/Scheduled swaps**: Agent executes dollar-cost averaging strategies

## Resources

- [Spraay Gateway Docs](https://docs.spraay.app)
- [x402 Protocol Spec](https://www.x402.org)
- [Spraay MCP Server](https://smithery.ai/server/@plagtech/spraay-x402-mcp)
- [OpenShell Documentation](https://docs.nvidia.com/openshell/latest/index.html)

## License

Apache 2.0 — see [LICENSE](../../LICENSE).
