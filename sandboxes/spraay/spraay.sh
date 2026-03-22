#!/usr/bin/env bash
# spraay — CLI wrapper for the Spraay x402 gateway
# Usage: spraay <command> [options]
#
# This script provides a thin wrapper around the Spraay gateway API,
# designed for use by AI agents inside an OpenShell sandbox.

set -euo pipefail

GATEWAY="${SPRAAY_GATEWAY_URL:-https://gateway.spraay.app}"
CHAIN="${SPRAAY_CHAIN:-base}"

# ── Helpers ──────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
spraay — AI Agent Crypto Payment CLI (x402 Protocol)

USAGE
  spraay <command> [options]

COMMANDS
  health              Check gateway status
  info                Show gateway info and supported chains
  routes              List all available routes and pricing
  chains              List supported blockchains

  batch-send          Send tokens to multiple recipients
  escrow-create       Create an escrow contract
  escrow-release      Release escrow funds
  escrow-status       Check escrow status

  swap                Execute a token swap
  price               Get token price
  balance             Check wallet balance

  rtp-discover        Discover available robots/devices
  rtp-hire            Hire a robot for a task
  rtp-status          Check task status

  payroll-run         Execute a payroll batch
  payroll-schedule    Schedule recurring payroll

  raw <method> <path> Make a raw gateway request

ENVIRONMENT
  SPRAAY_GATEWAY_URL   Gateway URL (default: https://gateway.spraay.app)
  SPRAAY_PAYMENT_ADDRESS  Your wallet address for x402 payments
  SPRAAY_CHAIN         Default chain (default: base)

EXAMPLES
  spraay health
  spraay routes
  spraay balance --address 0x1234... --chain base
  spraay batch-send --recipients '[{"address":"0x...","amount":"1.0"}]' --token USDC
  spraay rtp-discover --category robotics
EOF
}

gateway_get() {
  local path="$1"
  shift
  curl -sf -H "Content-Type: application/json" "${GATEWAY}${path}" "$@"
}

gateway_post() {
  local path="$1"
  local data="$2"
  shift 2
  curl -sf -X POST \
    -H "Content-Type: application/json" \
    -d "${data}" \
    "${GATEWAY}${path}" "$@"
}

# ── Commands ─────────────────────────────────────────────────────────────────

cmd_health() {
  gateway_get "/health" | jq .
}

cmd_info() {
  gateway_get "/v1/info" | jq .
}

cmd_routes() {
  gateway_get "/v1/routes" | jq .
}

cmd_chains() {
  gateway_get "/v1/chains" | jq .
}

cmd_balance() {
  local address="${SPRAAY_PAYMENT_ADDRESS:-}"
  local chain="${CHAIN}"
  local token="USDC"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --address) address="$2"; shift 2 ;;
      --chain) chain="$2"; shift 2 ;;
      --token) token="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  if [[ -z "$address" ]]; then
    echo "Error: --address required or set SPRAAY_PAYMENT_ADDRESS" >&2
    exit 1
  fi

  gateway_get "/v1/balance?address=${address}&chain=${chain}&token=${token}" | jq .
}

cmd_price() {
  local token=""
  local chain="${CHAIN}"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --token) token="$2"; shift 2 ;;
      --chain) chain="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  if [[ -z "$token" ]]; then
    echo "Error: --token required" >&2
    exit 1
  fi

  gateway_get "/v1/price?token=${token}&chain=${chain}" | jq .
}

cmd_batch_send() {
  local recipients=""
  local token="USDC"
  local chain="${CHAIN}"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --recipients) recipients="$2"; shift 2 ;;
      --token) token="$2"; shift 2 ;;
      --chain) chain="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  if [[ -z "$recipients" ]]; then
    echo "Error: --recipients required (JSON array)" >&2
    exit 1
  fi

  local payload
  payload=$(jq -n \
    --argjson recipients "${recipients}" \
    --arg token "${token}" \
    --arg chain "${chain}" \
    '{recipients: $recipients, token: $token, chain: $chain}')

  gateway_post "/v1/batch-send" "${payload}" | jq .
}

cmd_escrow_create() {
  local data="$1"
  gateway_post "/v1/escrow/create" "${data}" | jq .
}

cmd_escrow_release() {
  local escrow_id="$1"
  gateway_post "/v1/escrow/release" "{\"escrowId\": \"${escrow_id}\"}" | jq .
}

cmd_escrow_status() {
  local escrow_id="$1"
  gateway_get "/v1/escrow/status?escrowId=${escrow_id}" | jq .
}

cmd_swap() {
  local from_token=""
  local to_token=""
  local amount=""
  local chain="${CHAIN}"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --from) from_token="$2"; shift 2 ;;
      --to) to_token="$2"; shift 2 ;;
      --amount) amount="$2"; shift 2 ;;
      --chain) chain="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  local payload
  payload=$(jq -n \
    --arg from "${from_token}" \
    --arg to "${to_token}" \
    --arg amount "${amount}" \
    --arg chain "${chain}" \
    '{fromToken: $from, toToken: $to, amount: $amount, chain: $chain}')

  gateway_post "/v1/swap" "${payload}" | jq .
}

cmd_rtp_discover() {
  local category=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --category) category="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  if [[ -n "$category" ]]; then
    gateway_get "/v1/rtp/discover?category=${category}" | jq .
  else
    gateway_get "/v1/rtp/discover" | jq .
  fi
}

cmd_rtp_hire() {
  local data="$1"
  gateway_post "/v1/rtp/hire" "${data}" | jq .
}

cmd_rtp_status() {
  local task_id="$1"
  gateway_get "/v1/rtp/status?taskId=${task_id}" | jq .
}

cmd_payroll_run() {
  local data="$1"
  gateway_post "/v1/payroll/run" "${data}" | jq .
}

cmd_payroll_schedule() {
  local data="$1"
  gateway_post "/v1/payroll/schedule" "${data}" | jq .
}

cmd_raw() {
  local method="${1:-GET}"
  local path="${2:-/}"
  local data="${3:-}"

  if [[ "$method" == "POST" && -n "$data" ]]; then
    gateway_post "${path}" "${data}" | jq .
  else
    gateway_get "${path}" | jq .
  fi
}

# ── Router ───────────────────────────────────────────────────────────────────

case "${1:-help}" in
  health)           shift; cmd_health "$@" ;;
  info)             shift; cmd_info "$@" ;;
  routes)           shift; cmd_routes "$@" ;;
  chains)           shift; cmd_chains "$@" ;;
  balance)          shift; cmd_balance "$@" ;;
  price)            shift; cmd_price "$@" ;;
  batch-send)       shift; cmd_batch_send "$@" ;;
  escrow-create)    shift; cmd_escrow_create "$@" ;;
  escrow-release)   shift; cmd_escrow_release "$@" ;;
  escrow-status)    shift; cmd_escrow_status "$@" ;;
  swap)             shift; cmd_swap "$@" ;;
  rtp-discover)     shift; cmd_rtp_discover "$@" ;;
  rtp-hire)         shift; cmd_rtp_hire "$@" ;;
  rtp-status)       shift; cmd_rtp_status "$@" ;;
  payroll-run)      shift; cmd_payroll_run "$@" ;;
  payroll-schedule) shift; cmd_payroll_schedule "$@" ;;
  raw)              shift; cmd_raw "$@" ;;
  help|--help|-h)   usage ;;
  *)                echo "Unknown command: $1" >&2; usage; exit 1 ;;
esac
