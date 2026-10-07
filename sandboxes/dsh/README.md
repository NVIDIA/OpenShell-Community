# DeepSeek Harness Sandbox

OpenShell sandbox image pre-configured with [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), an open-source, plugin-architected agent harness from DeepSeek AI.

> [!NOTE]
> DeepSeek Harness is in developer preview. Expect compatibility-breaking changes between releases.

## What's Included

- **DeepSeek Harness CLI** (`@deepseek-ai/dsh@0.2.0-rc.2`) — `dsh`, run via its `headless` profile
- Everything from the [base sandbox](../base/README.md)

## Build

```bash
docker build -t openshell-dsh .
```

To build against a specific base image:

```bash
docker build -t openshell-dsh --build-arg BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest .
```

## Usage

### Create a sandbox

```bash
openshell sandbox create --from dsh
```

### Run a one-shot task

`dsh`'s `headless` profile runs a single task from the command line, prints the final answer, and exits — no GUI, no server, no open port. This is the profile to drive from an eval harness or a script:

```bash
dsh --profile headless "run the tests"
```

Pipe a task in instead of passing it as an argument:

```bash
{ echo "Summarize these changes:"; git diff --stat; } | dsh --profile headless
```

Pass `--json` for a newline-delimited JSON event stream (`session`, `status`, `text`, `thinking`, `tool_call`, `tool_result`, `final`) instead of plain text on stdout, and `--session-id <id>` to continue a previous conversation. Exit code 0 means the task completed; 1 means it aborted or errored.

## Configuration

DeepSeek Harness stores profiles, credentials, and the session log under its Harness home, `~/.dsh` by default (override with `$DSH_HOME`). See the [DeepSeek Harness docs](https://deepseek-harness.github.io/deepseek-harness/) for provider and plugin configuration.
