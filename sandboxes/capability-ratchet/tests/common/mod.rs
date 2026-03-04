// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! Shared test helpers.

use capability_ratchet_sidecar::config::{BackendConfig, ListenConfig, SidecarConfig};
use capability_ratchet_sidecar::policy::Policy;
use serde_json::json;
use std::path::PathBuf;

/// Create a sample policy for testing.
pub fn sample_policy() -> Policy {
    let data = json!({
        "version": "2.0",
        "name": "test-policy",
        "tools": {
            "outlook-cli": {"taint": ["has-private-data"]},
            "outlook-cli read": {"taint": ["has-private-data"]},
            "confluence-cli": {"taint": ["has-untrusted-input"]},
            "curl": {"requires": ["network:egress"]},
            "wget": {"requires": ["network:egress"]},
            "curl api.github.com": {"requires": ["network:egress:approved"]},
        },
        "approvedEndpoints": [
            "api.github.com",
            "*.nvidia.com",
        ],
        "knownSafe": [
            "outlook-cli",
            "confluence-cli",
        ],
    });
    Policy::from_value(&data).unwrap()
}

/// Create a sample sidecar config for testing.
pub fn sample_config() -> SidecarConfig {
    SidecarConfig {
        backend: BackendConfig {
            url: "http://localhost:9999/v1".into(),
            api_key: "test-key".into(),
            model: None,
        },
        policy_file: PathBuf::from("/tmp/test-policy.yaml"),
        listen: ListenConfig::default(),
        bash_ast_socket: None,
        shadow_mode: false,
    }
}
