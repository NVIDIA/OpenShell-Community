# Spraay Payments Skill

Send tokens to one or many recipients on any of 13 supported blockchains using the Spraay x402 gateway.

## When to Use

Use this skill when the user or agent needs to:

- Send tokens (USDC, ETH, MATIC, etc.) to one or more wallet addresses
- Execute batch payments to multiple recipients in a single transaction
- Distribute tokens across different chains
- Pay invoices, bounties, or rewards programmatically

## Supported Chains

Base, Ethereum, Arbitrum, Polygon, BNB Chain, Avalanche, Solana, Bitcoin, Stacks, Unichain, Plasma, BOB, Bittensor

## How It Works

1. The Spraay gateway uses the **x402 protocol** — HTTP 402 Payment Required
2. Each API call costs a small USDC fee (typically $0.01–$0.05)
3. The gateway executes the on-chain transaction after payment verification
4. Responses include transaction hashes for on-chain verification

## Commands

### Check balance
```bash
spraay balance --address 0xYourAddress --chain base --token USDC
```

### Send to multiple recipients
```bash
spraay batch-send \
  --recipients '[
    {"address": "0xRecipient1", "amount": "10.0"},
    {"address": "0xRecipient2", "amount": "25.0"},
    {"address": "0xRecipient3", "amount": "5.0"}
  ]' \
  --token USDC \
  --chain base
```

### Get token price
```bash
spraay price --token ETH --chain base
```

## Important Notes

- Always verify the recipient addresses before sending
- Check balances before executing batch sends
- The `SPRAAY_PAYMENT_ADDRESS` environment variable must be set
- All amounts are in human-readable format (e.g., "1.0" = 1 USDC)
- Transaction fees are paid in USDC via x402 on top of the transfer amount

## Error Handling

- HTTP 402: Payment required — agent wallet needs USDC for the gateway fee
- HTTP 400: Invalid parameters — check addresses and amounts
- HTTP 503: Chain RPC unavailable — retry or try a different RPC

## API Reference

Full endpoint documentation: https://docs.spraay.app
