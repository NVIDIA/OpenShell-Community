# Spraay RTP (Robot Task Protocol) Skill

Hire robots and IoT devices to perform physical tasks using x402 USDC micropayments.

## When to Use

Use this skill when the user or agent needs to:

- Discover available robots or IoT devices on the network
- Commission a physical task (delivery, sensing, manufacturing, etc.)
- Pay for robot services via automated micropayments
- Monitor task execution status and completion

## What is RTP?

The Robot Task Protocol (RTP) is an open standard for AI agents to hire robots via x402 USDC micropayments. It bridges the digital agent world with physical robotics infrastructure.

- **Spec**: https://github.com/plagtech/rtp-spec
- **SDK**: https://github.com/plagtech/rtp-sdk
- **Gateway endpoints**: Category 15 on the Spraay gateway (v3.4.0+)

## Commands

### Discover available devices
```bash
spraay rtp-discover
spraay rtp-discover --category robotics
spraay rtp-discover --category sensing
spraay rtp-discover --category delivery
```

### Hire a robot for a task
```bash
spraay rtp-hire '{
  "deviceId": "device-abc-123",
  "task": "Capture temperature reading at location A",
  "maxBudget": "0.05",
  "chain": "base",
  "callback": "https://your-webhook.com/rtp-result"
}'
```

### Check task status
```bash
spraay rtp-status <task-id>
```

## Task Lifecycle

1. **Discovery**: Agent queries available devices and capabilities
2. **Negotiation**: Agent reviews pricing and selects a device
3. **Hire**: Agent sends x402 micropayment to commission the task
4. **Execution**: Device performs the physical task
5. **Completion**: Device reports results; agent receives callback
6. **Verification**: On-chain proof of task completion

## Supported Device Categories

- `robotics` — Robotic arms, humanoids, manipulators
- `sensing` — Environmental sensors, cameras, LiDAR
- `delivery` — Drones, autonomous vehicles, couriers
- `manufacturing` — 3D printers, CNC, assembly
- `compute` — Edge GPU nodes, inference endpoints

## Important Notes

- RTP tasks are paid upfront via x402 micropayments
- Device availability depends on the RTP network in your region
- Task results are delivered via webhook callback or polling
- All payments are in USDC on Base by default
- This integrates with NVIDIA's Physical AI stack for robotics applications

## Error Handling

- HTTP 402: Payment required for task commissioning
- HTTP 404: Device not found or task ID invalid
- HTTP 408: Task timed out — device did not respond
- HTTP 503: RTP network unavailable
