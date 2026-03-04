// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

use capability_ratchet_sidecar::normalize;
use serde_json::json;

#[test]
fn test_resolve_chat_completions_by_key() {
    let data = json!({"messages": [{"role": "user", "content": "hello"}]});
    let fmt = normalize::resolve(&data, None);
    assert_eq!(fmt.name(), "chat_completions");
}

#[test]
fn test_resolve_responses_api_by_key() {
    let data = json!({"input": "hello"});
    let fmt = normalize::resolve(&data, None);
    assert_eq!(fmt.name(), "responses_api");
}

#[test]
fn test_resolve_anthropic_by_blocks() {
    let data = json!({
        "messages": [{
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]
        }]
    });
    let fmt = normalize::resolve(&data, None);
    assert_eq!(fmt.name(), "anthropic");
}

#[test]
fn test_resolve_by_call_type() {
    let data = json!({});
    assert_eq!(
        normalize::resolve(&data, Some("completion")).name(),
        "chat_completions"
    );
    assert_eq!(
        normalize::resolve(&data, Some("anthropic_messages")).name(),
        "anthropic"
    );
    assert_eq!(
        normalize::resolve(&data, Some("responses")).name(),
        "responses_api"
    );
}

#[test]
fn test_normalize_chat_completions() {
    let data = json!({
        "messages": [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi"},
        ]
    });
    let msgs = normalize::normalize_input(&data, None);
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0]["role"], "user");
}

#[test]
fn test_normalize_responses_api_string_input() {
    let data = json!({"input": "hello"});
    let msgs = normalize::normalize_input(&data, Some("responses"));
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0]["role"], "user");
    assert_eq!(msgs[0]["content"], "hello");
}

#[test]
fn test_extract_tool_calls_chat_completions() {
    let response = json!({
        "choices": [{
            "message": {
                "role": "assistant",
                "tool_calls": [{
                    "id": "tc1",
                    "type": "function",
                    "function": {
                        "name": "bash",
                        "arguments": "{\"command\": \"ls\"}"
                    }
                }]
            }
        }]
    });
    let calls = normalize::extract_tool_calls(&response);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, "bash");
    assert_eq!(calls[0].id, "tc1");
}

#[test]
fn test_extract_tool_calls_anthropic() {
    let response = json!({
        "content": [{
            "type": "tool_use",
            "id": "tu1",
            "name": "bash",
            "input": {"command": "ls"}
        }]
    });
    let calls = normalize::extract_tool_calls(&response);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, "bash");
    assert_eq!(calls[0].id, "tu1");
}

#[test]
fn test_extract_tool_calls_responses_api() {
    let response = json!({
        "output": [{
            "type": "function_call",
            "call_id": "fc1",
            "name": "bash",
            "arguments": "{\"command\": \"ls\"}"
        }]
    });
    let calls = normalize::extract_tool_calls(&response);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, "bash");
    assert_eq!(calls[0].id, "fc1");
}

#[test]
fn test_inject_hint_chat_completions() {
    let mut data = json!({"messages": [{"role": "user", "content": "hi"}]});
    normalize::inject_hint(&mut data, "WARNING", None);
    let msgs = data["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0]["role"], "system");
    assert_eq!(msgs[0]["content"], "WARNING");
}

#[test]
fn test_inject_hint_anthropic() {
    let mut data = json!({
        "messages": [{
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]
        }]
    });
    normalize::inject_hint(&mut data, "WARNING", Some("anthropic_messages"));
    assert!(data.get("system").is_some());
}

#[test]
fn test_normalize_anthropic_tool_results() {
    let data = json!({
        "messages": [
            {
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": "tu1", "name": "bash", "input": {"command": "ls"}}
                ]
            },
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "tu1", "content": "file1.txt"}
                ]
            }
        ]
    });
    let msgs = normalize::normalize_input(&data, Some("anthropic_messages"));
    // Should convert to assistant with tool_calls + tool message
    assert!(msgs.len() >= 2);
    // First message should be assistant with tool_calls
    assert_eq!(msgs[0]["role"], "assistant");
    assert!(msgs[0].get("tool_calls").is_some());
    // Second message should be a tool result
    assert_eq!(msgs[1]["role"], "tool");
    assert_eq!(msgs[1]["tool_call_id"], "tu1");
}
