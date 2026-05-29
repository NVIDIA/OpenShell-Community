---
name: audit-sandbox-policy
description: Reviews a sandbox policy.yaml for common security misconfigurations including missing binaries restrictions, overly broad egress, credential exposure, and filesystem gaps. Use when authoring, reviewing, or hardening an OpenShell sandbox policy.
license: Apache-2.0
compatibility: All OpenShell Community sandboxes (base, openclaw, openclaw-nvidia, and derivatives).
metadata:
  version: "1.0"
---
# Audit Sandbox Policy

Systematically review a sandbox `policy.yaml` file for security misconfigurations, overly permissive rules, and missing hardening. This skill is declarative: it tells the agent **what to check** and **how to report findings**, not how to fix them (fixes depend on the sandbox's purpose).

## When to Apply

- A user asks to "audit", "review", or "harden" a sandbox policy.
- A new `policy.yaml` is being authored or modified in a pull request.
- A user asks whether a sandbox is "secure" or "production-ready".
- The agent is evaluating a sandbox configuration as part of a broader security review.

## Checks Performed

Read the target `policy.yaml` and evaluate every section against the checks below. Group findings by severity.

### Critical

1. **Missing binaries restriction (ref: NemoClaw #272)**
   A `network_policies` entry that lists `endpoints` but has **no `binaries` key** (or an empty list) allows *any* process in the sandbox to use that network path. Every network policy MUST bind to at least one explicit binary path.

2. **Overly broad egress**
   Flag any endpoint entry where:
   - `host` is `"*"`, `"0.0.0.0"`, or a wildcard like `"*.example.com"` (OPA uses exact match, so wildcards may silently fail *or* over-match depending on proxy layer).
   - `port` is missing, `0`, or `"*"` (interpreted as "any port").
   - A `rules` list contains `method: "*"` with `path: "/**"` — this grants unrestricted HTTP access to the host.

3. **Credential exposure in policy YAML**
   Scan the file for patterns that look like embedded secrets: API keys, tokens, passwords, or `Bearer` strings in any field. Credentials belong in environment variables or mounted secrets, never in policy files checked into version control.

4. **Missing filesystem restrictions on sensitive directories**
   If `filesystem_policy` is present, verify that none of the following are listed under `read_write` (they should be `read_only` or omitted):
   - `/etc` (contains system configuration, passwd, shadow)
   - `/usr` (system binaries — writable means an attacker can replace them)
   - `/proc` (writable proc is a container-escape vector)
   - `/app` (application code should be immutable at runtime)

### Warning

5. **POST-capable endpoints without binary restriction**
   An endpoint that allows `method: POST` (or `method: "*"`) can exfiltrate data. If such an endpoint exists, the policy MUST have a `binaries` list. Flag if `binaries` is missing or if the bound binary is overly broad (e.g., `/bin/bash`).

6. **Messaging / notification service in base policy**
   Services like Slack webhooks, email relays (SMTP endpoints), or messaging APIs (e.g., `hooks.slack.com`, `smtp.gmail.com`) should not appear in the **base** sandbox policy. They should be in a preset or a domain-specific sandbox so that opting in is explicit.

7. **Missing TLS termination**
   Any endpoint on port 443 should have `tls: terminate` set so the proxy can inspect traffic. Flag endpoints on 443 that are missing the `tls` field. Endpoints on non-443 ports without TLS are informational (may be internal services).

8. **Broad binary paths**
   Binaries like `/usr/bin/python3`, `/usr/bin/curl`, or `/bin/bash` are general-purpose interpreters/tools. Prefer pinning to the specific agent binary (e.g., `/app/.venv/bin/my_agent`) or using a scoped glob (e.g., `/sandbox/.venv/bin/python`). Flag general-purpose binaries bound to sensitive endpoints (inference APIs, write-capable REST endpoints).

### Informational

9. **Preset count and attack surface**
   Count the number of top-level keys under `network_policies`. More policies means a larger network attack surface. Report the count and note if it exceeds 10 (a reasonable threshold for review).

10. **Dynamic vs. static policy split**
    Note whether the policy uses any `rules` blocks (L7 / dynamic per-request evaluation) versus only static `(host, port, binary)` tuples. Policies with L7 rules are more flexible but harder to reason about; policies that are purely static are easier to audit.

## Output Format

Present findings as a structured report:

```
## Sandbox Policy Audit: <filename or sandbox name>

### Critical
- [ ] **<Check name>**: <description of finding, quoting the offending YAML key/value>

### Warning
- [ ] **<Check name>**: <description of finding>

### Informational
- **<Check name>**: <observation>

### Summary
- Total policies: <N>
- L7 (rules-based) policies: <N>
- Static (host/port/binary only) policies: <N>
- Findings: <N critical>, <N warning>, <N informational>
```

Use `- [x]` for checks that pass (no finding) and `- [ ]` for checks that have findings. If a severity tier has no findings, still include the heading with a note: "No findings."

## Example

**Input:** User provides or points to `sandboxes/openclaw-nvidia/policy.yaml`.

**Output:**

```
## Sandbox Policy Audit: openclaw-nvidia/policy.yaml

### Critical
- [x] **Missing binaries restriction**: All network policies have explicit binaries lists.
- [ ] **Overly broad egress**: Policy `nvidia` binds `/bin/bash` to `integrate.api.nvidia.com` — bash is a general-purpose shell and should not be a sanctioned binary for API access.
- [x] **Credential exposure**: No embedded secrets found.
- [x] **Filesystem restrictions**: Sensitive directories (/etc, /usr, /proc) are read-only.

### Warning
- [ ] **POST-capable endpoints without binary restriction**: Policy `github_rest_api` allows POST via commented-out rules but active rules are read-only (GET/HEAD/OPTIONS). No action needed unless write rules are uncommented.
- [x] **Messaging service in base policy**: No messaging services found.
- [ ] **Missing TLS termination**: Endpoints for `statsig.anthropic.com`, `sentry.io` on port 443 are missing `tls: terminate`.
- [ ] **Broad binary paths**: `/usr/bin/python3` and `/usr/bin/python3.12` are bound to `integrate.api.nvidia.com` in the `nvidia` policy.

### Informational
- **Preset count**: 8 network policies defined. Within normal range.
- **Dynamic vs. static split**: 2 policies use L7 rules (github, github_rest_api); 6 are static.

### Summary
- Total policies: 8
- L7 (rules-based) policies: 2
- Static policies: 6
- Findings: 1 critical, 2 warning, 2 informational
```

## Gotchas

- **OPA host matching is exact.** Wildcards in `host` fields (e.g., `*.example.com`) do *not* work with OPA's default equality check. A wildcard host is almost certainly a misconfiguration rather than an intentional broad allowance.
- **Commented-out rules still matter.** Auditors should flag commented-out write rules (like `git-receive-pack` or GraphQL POST) because a future uncomment is one line away from granting write access.
- **Binary SHA256 is enforced elsewhere.** The policy YAML lists binary paths, but integrity (trust-on-first-use SHA256) is enforced in the Rust proxy layer. This audit checks the *policy declaration*, not runtime integrity.
- **Presets inherit base policy.** If auditing a derived sandbox (e.g., `openclaw-nvidia`), also audit `sandboxes/base/policy.yaml` — the derived sandbox may inherit or overlay the base policy.

## References

- [NemoClaw #272](https://github.com/NVIDIA/NemoClaw/issues/272) — Missing binaries restriction finding
- [NemoClaw #118](https://github.com/NVIDIA/NemoClaw/issues/118) — Policy hardening discussion
- [OpenShell policy.yaml format](https://github.com/NVIDIA/OpenShell-Community/blob/main/sandboxes/base/policy.yaml)
- [CONTRIBUTING.md](https://github.com/NVIDIA/OpenShell-Community/blob/main/CONTRIBUTING.md)
