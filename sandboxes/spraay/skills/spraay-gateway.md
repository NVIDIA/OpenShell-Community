# Spraay Gateway Skill

Query the Spraay x402 gateway to discover available endpoints, check pricing, and understand supported chains and tokens.

## When to Use

Use this skill when the user or agent needs to:

- See all available Spraay gateway routes and their pricing
- Check which chains and tokens are supported
- Verify gateway health and connectivity
- Understand x402 payment requirements before making a request

## Commands

### Check gateway health
```bash
spraay health
```

### Get gateway info
```bash
spraay info
```

### List all routes with pricing
```bash
spraay routes
```

### List supported chains
```bash
spraay chains
```

### Make a raw API call
```bash
spraay raw GET /v1/some-endpoint
spraay raw POST /v1/some-endpoint '{"key": "value"}'
```

## Gateway Overview

The Spraay gateway at `gateway.spraay.app` exposes 76+ paid endpoints across 16 categories:

| Category | Description | Example Endpoints |
|----------|-------------|-------------------|
| 1. Batch Payments | Multi-recipient token sends | `/v1/batch-send` |
| 2. Token Swaps | DEX aggregation | `/v1/swap`, `/v1/quote` |
| 3. Escrow | Milestone-based contracts | `/v1/escrow/*` |
| 4. Payroll | Recurring payment runs | `/v1/payroll/*` |
| 5. Price Oracle | Token pricing data | `/v1/price` |
| 6. Balance | Wallet balance queries | `/v1/balance` |
| 7. NFT | Mint and transfer NFTs | `/v1/nft/*` |
| 8. Bridge | Cross-chain transfers | `/v1/bridge/*` |
| 9. Staking | Stake and unstake tokens | `/v1/staking/*` |
| 10. Governance | DAO proposal tools | `/v1/governance/*` |
| 11. Analytics | On-chain data queries | `/v1/analytics/*` |
| 12. AI Inference | Proxy to AI models | `/v1/inference/*` |
| 13. Wallet | Wallet management | `/v1/wallet/*` |
| 14. Agent Wallet | Managed agent wallets | `/v1/agent-wallet/*` |
| 15. RTP | Robot Task Protocol | `/v1/rtp/*` |
| 16. Identity | On-chain identity | `/v1/identity/*` |

## Pricing Tiers

- **Free endpoints**: `/health`, `/v1/info`, `/v1/routes`, `/v1/chains` (11 total)
- **Standard**: $0.01–$0.05 per request (most query endpoints)
- **Premium**: $0.05–$0.25 per request (escrow, bridge, payroll execution)

## x402 Payment Flow

All paid endpoints use the HTTP 402 protocol:

1. Client sends a request without payment
2. Gateway responds with `402 Payment Required` + payment details header
3. Client signs a USDC payment transaction
4. Client resends request with the signed payment in the header
5. Gateway verifies payment and processes the request

The payment address for all gateway requests:
`0xAd62f03C7514bb8c51f1eA70C2b75C37404695c8`

## Important Notes

- Free endpoints do not require x402 payment
- The gateway is chain-agnostic — specify the target chain per request
- Rate limiting applies: check `X-RateLimit-*` response headers
- The Spraay MCP server (`@plagtech/spraay-x402-mcp`) wraps all these endpoints for LLM tool use
