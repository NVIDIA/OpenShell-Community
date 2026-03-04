// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! Sidecar configuration loading from YAML.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::error::SidecarError;

/// Upstream inference backend configuration.
#[derive(Debug, Clone)]
pub struct BackendConfig {
    pub url: String,
    pub api_key: String,
    pub model: Option<String>,
}

/// HTTP server listen configuration.
#[derive(Debug, Clone)]
pub struct ListenConfig {
    pub host: String,
    pub port: u16,
}

impl Default for ListenConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 4001,
        }
    }
}

/// Top-level sidecar configuration.
#[derive(Debug, Clone)]
pub struct SidecarConfig {
    pub backend: BackendConfig,
    pub policy_file: PathBuf,
    pub listen: ListenConfig,
    pub bash_ast_socket: Option<String>,
    pub shadow_mode: bool,
}

// Raw YAML deserialization structs.
#[derive(Deserialize)]
struct RawUpstream {
    url: Option<String>,
    api_key_env: Option<String>,
    model: Option<String>,
}

#[derive(Deserialize)]
struct RawListen {
    host: Option<String>,
    port: Option<u16>,
}

#[derive(Deserialize)]
struct RawConfig {
    upstream: Option<RawUpstream>,
    policy_file: Option<String>,
    listen: Option<RawListen>,
    bash_ast_socket: Option<String>,
    shadow_mode: Option<bool>,
}

impl SidecarConfig {
    /// Load configuration from a YAML file.
    pub fn from_yaml(path: &Path) -> Result<Self, SidecarError> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| SidecarError::Config(format!("cannot read {}: {e}", path.display())))?;
        let raw: RawConfig = serde_yaml::from_str(&content)?;
        Self::from_raw(raw)
    }

    fn from_raw(raw: RawConfig) -> Result<Self, SidecarError> {
        let upstream = raw.upstream.unwrap_or(RawUpstream {
            url: None,
            api_key_env: None,
            model: None,
        });

        let api_key_env = upstream
            .api_key_env
            .as_deref()
            .unwrap_or("API_KEY");
        let api_key = std::env::var(api_key_env).unwrap_or_default();

        let backend = BackendConfig {
            url: upstream
                .url
                .unwrap_or_else(|| "http://localhost:1234/v1".into()),
            api_key,
            model: upstream.model,
        };

        let listen_raw = raw.listen.unwrap_or(RawListen {
            host: None,
            port: None,
        });
        let listen = ListenConfig {
            host: listen_raw.host.unwrap_or_else(|| "127.0.0.1".into()),
            port: listen_raw.port.unwrap_or(4001),
        };

        Ok(Self {
            backend,
            policy_file: PathBuf::from(
                raw.policy_file.unwrap_or_else(|| "/app/policy.yaml".into()),
            ),
            listen,
            bash_ast_socket: raw.bash_ast_socket,
            shadow_mode: raw.shadow_mode.unwrap_or(false),
        })
    }
}
