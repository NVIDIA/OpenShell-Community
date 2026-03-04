// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

mod common;

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use capability_ratchet_sidecar::server::{AppState, create_router};
use http_body_util::BodyExt;
use serde_json::json;
use tower::util::ServiceExt;

fn make_state(backend_url: &str) -> Arc<AppState> {
    let mut config = common::sample_config();
    config.backend.url = backend_url.into();
    let policy = common::sample_policy();
    Arc::new(AppState {
        config,
        policy,
        http_client: reqwest::Client::new(),
        bash_ast: None,
    })
}

#[tokio::test]
async fn test_health_endpoint() {
    let state = make_state("http://localhost:9999");
    let app = create_router(state);

    let req = Request::builder()
        .uri("/health")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "ok");
}

#[tokio::test]
async fn test_invalid_json_returns_400() {
    let state = make_state("http://localhost:9999");
    let app = create_router(state);

    let req = Request::builder()
        .uri("/v1/chat/completions")
        .method("POST")
        .header("content-type", "application/json")
        .body(Body::from("not valid json"))
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_chat_completions_backend_unreachable() {
    // Backend on a port nothing listens on
    let state = make_state("http://127.0.0.1:19999");
    let app = create_router(state);

    let body = json!({
        "model": "test",
        "messages": [{"role": "user", "content": "hello"}]
    });

    let req = Request::builder()
        .uri("/v1/chat/completions")
        .method("POST")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
}
