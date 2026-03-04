// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

use std::io::Write;

use capability_ratchet_sidecar::config::SidecarConfig;

#[test]
fn test_load_config_from_yaml() {
    let yaml = r"
upstream:
  url: https://api.anthropic.com/v1
  api_key_env: TEST_API_KEY
policy_file: /app/policy.yaml
listen:
  host: 0.0.0.0
  port: 5000
bash_ast_socket: /tmp/bash-ast.sock
shadow_mode: true
";
    let mut tmp = tempfile::NamedTempFile::new().unwrap();
    tmp.write_all(yaml.as_bytes()).unwrap();

    let config = SidecarConfig::from_yaml(tmp.path()).unwrap();
    assert_eq!(config.backend.url, "https://api.anthropic.com/v1");
    assert_eq!(config.listen.host, "0.0.0.0");
    assert_eq!(config.listen.port, 5000);
    assert_eq!(
        config.bash_ast_socket.as_deref(),
        Some("/tmp/bash-ast.sock")
    );
    assert!(config.shadow_mode);
}

#[test]
fn test_config_defaults() {
    let yaml = "{}";
    let mut tmp = tempfile::NamedTempFile::new().unwrap();
    tmp.write_all(yaml.as_bytes()).unwrap();

    let config = SidecarConfig::from_yaml(tmp.path()).unwrap();
    assert_eq!(config.backend.url, "http://localhost:1234/v1");
    assert_eq!(config.listen.host, "127.0.0.1");
    assert_eq!(config.listen.port, 4001);
    assert!(config.bash_ast_socket.is_none());
    assert!(!config.shadow_mode);
}
