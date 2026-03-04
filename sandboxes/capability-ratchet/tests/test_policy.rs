// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

mod common;

use capability_ratchet_sidecar::types::TaintFlag;

#[test]
fn test_resolve_tool_with_subcmd() {
    let policy = common::sample_policy();
    let result = policy.resolve("outlook-cli", Some("read"));
    assert_eq!(result.source, "tools");
    assert!(result.taint.contains(&TaintFlag::HasPrivateData));
}

#[test]
fn test_resolve_tool_base_fallback() {
    let policy = common::sample_policy();
    let result = policy.resolve("outlook-cli", Some("unknown-subcmd"));
    assert_eq!(result.source, "tools");
    assert!(result.taint.contains(&TaintFlag::HasPrivateData));
}

#[test]
fn test_resolve_known_safe() {
    let policy = common::sample_policy();
    let result = policy.resolve("ls", None);
    assert_eq!(result.source, "known_safe");
    assert!(result.taint.is_empty());
}

#[test]
fn test_resolve_unknown_fails_closed() {
    let policy = common::sample_policy();
    let result = policy.resolve("totally_unknown_binary", None);
    assert_eq!(result.source, "unknown");
    assert!(result.taint.contains(&TaintFlag::HasPrivateData));
    assert!(result.taint.contains(&TaintFlag::HasUntrustedInput));
}

#[test]
fn test_endpoint_approved_exact() {
    let policy = common::sample_policy();
    assert!(policy.is_endpoint_approved("api.github.com"));
    assert!(policy.is_endpoint_approved("https://api.github.com/v1/repos"));
}

#[test]
fn test_endpoint_approved_wildcard() {
    let policy = common::sample_policy();
    assert!(policy.is_endpoint_approved("internal.nvidia.com"));
    assert!(policy.is_endpoint_approved("https://build.nvidia.com/api"));
}

#[test]
fn test_endpoint_not_approved() {
    let policy = common::sample_policy();
    assert!(!policy.is_endpoint_approved("evil.com"));
    assert!(!policy.is_endpoint_approved("https://attacker.io/exfil"));
}

#[test]
fn test_policy_validation_error_tools_not_mapping() {
    let data = serde_json::json!({"tools": "not-a-map"});
    let result = capability_ratchet_sidecar::policy::Policy::from_value(&data);
    assert!(result.is_err());
}
