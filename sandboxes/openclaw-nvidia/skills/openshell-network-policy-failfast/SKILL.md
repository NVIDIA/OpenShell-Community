---
name: openshell-network-policy-failfast
description: Stops retrying the same tool call, execution, internet search, or network connection when it fails due to OpenShell sandbox network policy blocking. Use when running in the openclaw-nvidia sandbox (OpenShell) and any network-dependent operation fails with connection refused, timeout, or policy denial.
license: Apache-2.0
compatibility: OpenShell Community sandboxes (e.g. openclaw-nvidia); applies when the agent runs inside a sandbox with restrictive network_policies.
metadata:
  version: "1.0"
---
# OpenShell Network Policy Fail-Fast

When running inside the **openclaw-nvidia** sandbox (or any OpenShell sandbox), network access is restricted by `network_policies`. Tool calls, shell commands that use the network, internet searches, and outbound connections can be **blocked** by policy. This skill instructs the agent to **stop retrying the same operation** when a failure is due to policy blocking and to respond clearly to the user instead.

## When to Apply

- The agent is operating in the **openclaw-nvidia** (or OpenShell) sandbox context.
- A **tool call**, **command execution**, **web search**, or **network request** fails with:
  - Connection refused, connection reset, or timeout to an external host
  - Explicit policy/denial or “blocked” in logs or error message
  - Errors indicating the request was not allowed (e.g. sandbox/network policy)
- The user has not explicitly asked to “retry” or “try again” with the same operation.

## Output Format

When a network-related failure is attributed to OpenShell policy blocking:

**Summary:** One sentence stating that the operation was blocked by sandbox network policy and will not be retried.

**Details:**
- **What failed:** &lt;tool/command/search/URL or operation name&gt;
- **Reason:** Blocked by OpenShell sandbox network policy (no retry of same operation).
- **Suggestion:** &lt;alternatives: use allowed endpoints, suggest user run outside sandbox, or point to policy docs&gt;

## Rules

1. **Do not retry** the same tool call, execution, internet search, or network connection once it has failed due to blocking network policies. One failure under policy is sufficient to treat the operation as disallowed.
2. **Identify policy-related failures** from errors such as connection refused, timeout to external hosts, or messages that indicate sandbox/network policy denial. Do not assume every network error is policy-related; only apply this behavior when the context (OpenShell/openclaw-nvidia sandbox) and error pattern fit.
3. **Report clearly** to the user that the operation was blocked and will not be retried, and offer alternatives (e.g. use an allowed service, run the task outside the sandbox, or check policy configuration).
4. **Prefer allowed endpoints** when possible (e.g. use REST APIs or hosts that are listed in the sandbox’s `network_policies` instead of retrying a blocked host).
5. **Do not loop** on the same URL, command, or tool; stop after the first policy-related failure for that operation.

## Example

**Input (scenario):** User asks to “fetch the latest news from example.com.” The agent runs a tool (e.g. `curl` or a web search) and receives connection refused or a policy denial.

**Output:**

**Summary:** The request to fetch content from example.com was blocked by the OpenShell sandbox network policy and will not be retried.

**Details:**
- **What failed:** Tool/request to example.com (e.g. `curl` or web search).
- **Reason:** Blocked by OpenShell sandbox network policy (no retry of same operation).
- **Suggestion:** Use an allowed endpoint if available, or run this request outside the sandbox. You can review allowed hosts in the sandbox’s `policy.yaml` (e.g. `network_policies`).

## Gotchas

- **Not every failure is policy:** Timeouts or refusals can be due to the host being down or firewalled elsewhere. Apply this skill when the environment is an OpenShell sandbox and the error is consistent with policy blocking (e.g. only certain hosts work).
- **Same operation, different params:** “Do not retry the same operation” means the same tool call/URL/command. Trying a different allowed host or a different tool is acceptable and encouraged.
- **User says “retry”:** If the user explicitly asks to retry, acknowledge the policy block and explain that retrying the same request will likely fail again; suggest alternatives rather than blindly retrying.

For more on OpenShell sandbox policies, see the repository’s [policy.yaml](https://github.com/NVIDIA/OpenShell-Community/blob/main/sandboxes/openclaw-nvidia/policy.yaml) and [CONTRIBUTING.md](https://github.com/NVIDIA/OpenShell-Community/blob/main/CONTRIBUTING.md).
