// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! Upstream backend forwarding.
//!
//! Forwards inference requests to the real backend, buffering the full
//! response for post-call inspection.

use serde_json::Value;

use crate::config::BackendConfig;
use crate::error::SidecarError;

/// Forward an inference request to the real backend.
///
/// When `force_non_streaming` is true, the request is sent with `stream: false`
/// regardless of the original value. This is needed for tainted requests where
/// the sidecar must inspect the full response before returning it.
///
/// # Errors
///
/// Returns `SidecarError` if the HTTP request fails or the backend returns a non-success status.
///
/// # Panics
///
/// Panics if `request_data` is not a JSON object.
pub async fn forward_to_backend(
    request_data: &Value,
    config: &BackendConfig,
    http_client: &reqwest::Client,
    force_non_streaming: bool,
) -> Result<Value, SidecarError> {
    let mut data = request_data.clone();

    // Only force non-streaming when the caller requires full-response analysis
    // (i.e., tainted requests). Non-tainted requests pass through unchanged.
    if force_non_streaming {
        data.as_object_mut()
            .unwrap()
            .insert("stream".into(), Value::Bool(false));
    }

    // Apply model override if configured
    if let Some(ref model) = config.model {
        data.as_object_mut()
            .unwrap()
            .insert("model".into(), Value::String(model.clone()));
    }

    // Build URL — append /chat/completions if not already present
    let mut url = config.url.trim_end_matches('/').to_string();
    if !url.ends_with("/chat/completions") {
        url.push_str("/chat/completions");
    }

    let mut req = http_client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&data);

    if !config.api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", config.api_key));
    }

    let response = req.send().await?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(SidecarError::Config(format!(
            "Backend returned {status}: {body}"
        )));
    }

    let result: Value = response.json().await?;
    Ok(result)
}
