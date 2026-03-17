#!/usr/bin/env bash

# pi-agent-start — Launch pi coding agent inside an OpenShell sandbox.
#
# Usage:
#   openshell sandbox create --from pi-agent -- pi-agent-start
#
# Pass API keys via environment variables:
#   openshell sandbox create --from pi-agent -- env ANTHROPIC_API_KEY=sk-ant-... pi-agent-start
set -euo pipefail

echo ""
echo "Pi coding agent is ready."
echo "  Version: $(pi --version 2>/dev/null || echo 'unknown')"
echo ""

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    echo "  Provider: Anthropic (key from environment)"
elif [ -n "${OPENAI_API_KEY:-}" ]; then
    echo "  Provider: OpenAI (key from environment)"
elif [ -n "${GOOGLE_API_KEY:-}" ]; then
    echo "  Provider: Google (key from environment)"
else
    echo "  No API key detected. Use /login inside pi or set an API key env var."
fi

echo ""
echo "Starting pi..."
echo ""

exec pi "$@"
