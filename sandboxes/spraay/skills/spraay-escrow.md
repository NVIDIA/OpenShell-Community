# Spraay Escrow Skill

Create and manage on-chain escrow contracts with milestone-based fund releases.

## When to Use

Use this skill when the user or agent needs to:

- Hold funds in escrow between two parties
- Release payments based on milestone completion
- Create trustless payment agreements for freelance or contract work
- Automate conditional fund releases

## How It Works

1. **Create**: Deposit tokens into an escrow smart contract with defined milestones
2. **Monitor**: Check escrow status and milestone completion
3. **Release**: Release funds when milestones are verified
4. **Refund**: Return funds if conditions are not met

## Commands

### Create an escrow
```bash
spraay escrow-create '{
  "depositor": "0xYourAddress",
  "beneficiary": "0xFreelancerAddress",
  "token": "USDC",
  "totalAmount": "500.0",
  "chain": "base",
  "milestones": [
    {"description": "Design mockups delivered", "amount": "150.0"},
    {"description": "Frontend implementation", "amount": "200.0"},
    {"description": "Testing and deployment", "amount": "150.0"}
  ]
}'
```

### Check escrow status
```bash
spraay escrow-status <escrow-id>
```

### Release milestone funds
```bash
spraay escrow-release <escrow-id>
```

## Important Notes

- Escrow creation requires sufficient token balance plus the x402 gateway fee
- Milestone releases are sequential by default
- Both parties can view escrow status on-chain
- Escrow contracts are non-custodial — funds are held by the smart contract, not by Spraay

## Error Handling

- HTTP 402: Payment required for gateway fee
- HTTP 409: Escrow already exists or milestone already released
- HTTP 404: Escrow ID not found
