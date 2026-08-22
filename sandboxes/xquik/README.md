# Xquik Twitter scraper sandbox

This image adds the public [Xquik Twitter scraper Skill](https://github.com/Xquik-dev/x-twitter-scraper) to the OpenShell base sandbox. The Skill covers bounded Twitter search, user lookup, timelines, follower data, and API setup.

Xquik is an independent third-party service. Not affiliated with X Corp. "Twitter" and "X" are trademarks of X Corp.

## What is included

- Xquik X Twitter Scraper Skill version 2.6.7
- The complete public Skill reference library
- A read-only OpenShell provider profile
- Every tool from the [base sandbox](../base/README.md)

The image fetches commit [`5f2a6d1`](https://github.com/Xquik-dev/x-twitter-scraper/commit/5f2a6d1251dbf9bc5a1211a085d6cac2f2f689af). The Dockerfile verifies the full commit before copying the Skill and its MIT license.

## Configure the provider

Export a valid Xquik API key on the host. Do not store it in this repository.

```bash
export XQUIK_API_KEY="xq_replace_me"
```

Download the reviewed provider profile:

```bash
curl -fsSLo xquik-read-only.yaml \
  https://raw.githubusercontent.com/NVIDIA/OpenShell-Community/main/sandboxes/xquik/provider-profile.yaml
```

Enable provider policy composition. Then lint and import the profile:

```bash
openshell settings set --global --key providers_v2_enabled --value true --yes
openshell provider profile lint -f xquik-read-only.yaml
openshell provider profile import -f xquik-read-only.yaml
```

Create the provider from the host environment. The bare key form keeps the value out of the command line.

```bash
openshell provider create \
  --name xquik \
  --type xquik-read-only \
  --credential XQUIK_API_KEY
```

## Start the sandbox

Launch Claude Code with the provider attached:

```bash
openshell sandbox create --from xquik --provider xquik -- claude
```

The same Skill is available to Codex, OpenCode, and GitHub Copilot in the base image.

## Read-only boundary

The provider permits `GET`, `HEAD`, and `OPTIONS` requests to these locations:

- `https://xquik.com/api/v1/**`
- `https://xquik.com/openapi.json`
- `https://docs.xquik.com/**`

OpenShell injects `XQUIK_API_KEY` as a placeholder. The proxy resolves it only for the profile endpoints.

The profile blocks API writes and remote MCP calls. It does not enable extraction jobs, monitors, webhooks, or account actions. Those operations use write methods or MCP calls and need a separate reviewed policy.

The network policy cannot distinguish public and private `GET` requests. Follow the Skill's approval rule before any private read.

## Verify access

Inside the sandbox, check the authenticated read path without starting a job:

```bash
curl --fail --silent --show-error \
  --header "x-api-key: ${XQUIK_API_KEY}" \
  https://xquik.com/api/v1/credits
```

The sandbox receives a placeholder, not the stored API key. OpenShell replaces it at the approved endpoint.

## Build locally

Build against the published base image:

```bash
docker build \
  --build-arg BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest \
  -t openshell-xquik \
  sandboxes/xquik
```

To update the Skill, change `XQUIK_SKILL_COMMIT` only after reviewing the public diff and license.
