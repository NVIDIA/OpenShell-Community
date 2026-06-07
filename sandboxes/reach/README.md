# Reach Sandbox

AI-native remote server management — no SSH required.

[Reach](https://github.com/agent-0x/reach) replaces SSH with HTTPS + Token for AI agents. One binary on the server, one token to connect. Built-in MCP server for Claude Code, Cursor, and any MCP-compatible AI.

## What's Included

- **reach CLI** (`/usr/local/bin/reach`) — manage remote servers
- **MCP server** — `reach mcp serve` for AI agent integration
- **Network policy** — allows reach-agent connections (port 7100/TLS) and GitHub API

## Quick Start

### 1. Configure servers

Add your reach-agent servers inside the sandbox:

```bash
reach add myserver --host 203.0.113.10 --token <token>
```

### 2. Use with Claude Code

```bash
reach mcp install
# Restart Claude Code — reach tools are now available
```

### 3. Direct CLI usage

```bash
reach exec myserver "uname -a"
reach stats myserver
reach dryrun myserver "rm -rf /opt/old"
```

## Network Policy

The included `policy.yaml` allows:

| Policy | What | Why |
|--------|------|-----|
| `reach-agent` | `*:7100` (TLS passthrough) | Connect to reach agents |
| `reach-github` | `api.github.com`, `github.com` | Bootstrap + release downloads |
| `claude-code` | `api.anthropic.com` + related | Claude Code MCP integration |

**For production:** Replace the wildcard `*:7100` entry with your actual server IPs.

## MCP Tools Available

| Tool | Description |
|------|-------------|
| `reach_bash` | Execute a shell command on a remote server |
| `reach_read` | Read a remote file |
| `reach_write` | Write a file (atomic) |
| `reach_upload` | Upload a local file |
| `reach_stats` | Get structured system stats (CPU, memory, disk, network) |
| `reach_dryrun` | Check command risk before executing |
| `reach_info` | Get system info |
| `reach_list` | List configured servers |

## Links

- [Reach GitHub](https://github.com/agent-0x/reach)
- [Reach Documentation](https://github.com/agent-0x/reach#readme)
