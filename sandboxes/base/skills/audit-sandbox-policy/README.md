# audit-sandbox-policy

A security review skill for OpenShell sandbox `policy.yaml` files. It instructs the agent to systematically check for common misconfigurations and report findings grouped by severity (Critical, Warning, Informational).

## Usage

Ask the agent to audit a policy file:

```
Review sandboxes/openclaw-nvidia/policy.yaml for security issues.
```

```
Audit the base sandbox policy and tell me if any network policies are missing binaries restrictions.
```

```
Is this sandbox policy production-ready? Check sandboxes/base/policy.yaml.
```

## What It Checks

| Severity | Check | Example |
|----------|-------|---------|
| Critical | Missing binaries restriction | A `network_policies` entry with endpoints but no `binaries` key |
| Critical | Overly broad egress | Wildcard hosts, unrestricted ports, `method: "*"` with `path: "/**"` |
| Critical | Credential exposure | API keys or tokens embedded in the YAML |
| Critical | Sensitive dirs writable | `/etc`, `/usr`, or `/proc` under `read_write` |
| Warning | POST without binary binding | Write-capable endpoints missing a `binaries` list |
| Warning | Messaging in base policy | Slack webhooks or SMTP in the base sandbox |
| Warning | Missing TLS termination | Port 443 endpoints without `tls: terminate` |
| Warning | Broad binary paths | `/usr/bin/python3` or `/bin/bash` bound to sensitive endpoints |
| Info | Preset count | Number of network policies (flags if >10) |
| Info | Dynamic vs. static split | Ratio of L7 rules-based policies to static tuples |

## Output

The skill produces a structured Markdown report with checkboxes for each finding and a summary table. See `SKILL.md` for the full output format and a worked example.

## License

Apache-2.0
