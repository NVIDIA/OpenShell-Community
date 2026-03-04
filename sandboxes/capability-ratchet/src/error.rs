// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! Unified error type for the capability ratchet sidecar.

/// All errors the sidecar can produce.
#[derive(Debug, thiserror::Error)]
pub enum SidecarError {
    #[error("config error: {0}")]
    Config(String),

    #[error("policy validation error: {0}")]
    PolicyValidation(String),

    #[error("bash-ast error: {0}")]
    BashAst(String),

    #[error("bash syntax error: {0}")]
    BashSyntax(String),

    #[error("bash-ast unavailable: {0}")]
    BashAstUnavailable(String),

    #[error("proxy error: {0}")]
    Proxy(#[from] reqwest::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("yaml error: {0}")]
    Yaml(#[from] serde_yaml::Error),
}
