// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

mod common;

use capability_ratchet_sidecar::taint::detect_taint;
use capability_ratchet_sidecar::types::TaintFlag;
use serde_json::json;

#[tokio::test]
async fn test_no_messages_no_taint() {
    let policy = common::sample_policy();
    let taint = detect_taint(&[], &policy, None).await;
    assert!(taint.is_empty());
}

#[tokio::test]
async fn test_user_messages_no_taint() {
    let policy = common::sample_policy();
    let messages = vec![json!({"role": "user", "content": "hello"})];
    let taint = detect_taint(&messages, &policy, None).await;
    assert!(taint.is_empty());
}

#[tokio::test]
async fn test_tool_result_private_data() {
    let policy = common::sample_policy();
    let messages = vec![
        json!({
            "role": "assistant",
            "tool_calls": [{
                "id": "tc1",
                "type": "function",
                "function": {"name": "outlook-cli", "arguments": "{\"subcommand\": \"read\"}"}
            }]
        }),
        json!({
            "role": "tool",
            "tool_call_id": "tc1",
            "content": "Email content here"
        }),
    ];
    let taint = detect_taint(&messages, &policy, None).await;
    assert!(taint.contains(&TaintFlag::HasPrivateData));
}

#[tokio::test]
async fn test_tool_result_untrusted_input() {
    let policy = common::sample_policy();
    let messages = vec![
        json!({
            "role": "assistant",
            "tool_calls": [{
                "id": "tc2",
                "type": "function",
                "function": {"name": "confluence-cli", "arguments": "{}"}
            }]
        }),
        json!({
            "role": "tool",
            "tool_call_id": "tc2",
            "content": "Wiki page content"
        }),
    ];
    let taint = detect_taint(&messages, &policy, None).await;
    assert!(taint.contains(&TaintFlag::HasUntrustedInput));
}

#[tokio::test]
async fn test_bash_tool_with_known_safe_command() {
    let policy = common::sample_policy();
    let messages = vec![
        json!({
            "role": "assistant",
            "tool_calls": [{
                "id": "tc3",
                "type": "function",
                "function": {"name": "bash", "arguments": "{\"command\": \"ls -la\"}"}
            }]
        }),
        json!({
            "role": "tool",
            "tool_call_id": "tc3",
            "content": "file1.txt"
        }),
    ];
    let taint = detect_taint(&messages, &policy, None).await;
    // ls is known safe -> no taint (using shlex fallback since no bash-ast)
    assert!(taint.is_empty());
}

#[tokio::test]
async fn test_bash_tool_with_unknown_command() {
    let policy = common::sample_policy();
    let messages = vec![
        json!({
            "role": "assistant",
            "tool_calls": [{
                "id": "tc4",
                "type": "function",
                "function": {"name": "bash", "arguments": "{\"command\": \"evil_binary\"}"}
            }]
        }),
        json!({
            "role": "tool",
            "tool_call_id": "tc4",
            "content": "output"
        }),
    ];
    let taint = detect_taint(&messages, &policy, None).await;
    // Unknown command -> both taint flags (fail closed)
    assert!(taint.contains(&TaintFlag::HasPrivateData));
    assert!(taint.contains(&TaintFlag::HasUntrustedInput));
}
