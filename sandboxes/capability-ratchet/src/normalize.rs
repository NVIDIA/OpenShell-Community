// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! API format normalization boundary.
//!
//! Converts between Chat Completions (`OpenAI`), Anthropic Messages, and
//! Responses API formats.  All downstream modules operate on the internal
//! Chat Completions message schema.

use std::collections::HashMap;

use serde_json::{Map, Value, json};
use tracing::{debug, warn};

use crate::types::ToolCall;

// ═══════════════════════════════════════════════════════════════════════════
// Format enum (compile-time dispatch, no vtable)
// ═══════════════════════════════════════════════════════════════════════════

/// Supported wire formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageFormat {
    ChatCompletions,
    Anthropic,
    ResponsesApi,
}

impl MessageFormat {
    /// Human-readable name for logging.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::ChatCompletions => "chat_completions",
            Self::Anthropic => "anthropic",
            Self::ResponsesApi => "responses_api",
        }
    }

    /// Convert the request's messages to the internal format.
    pub fn normalize_input(self, data: &Value) -> Vec<Value> {
        match self {
            Self::ChatCompletions => cc_normalize_input(data),
            Self::Anthropic => anthropic_normalize_input(data),
            Self::ResponsesApi => responses_normalize_input(data),
        }
    }

    /// Insert a system-level instruction into the request in-place.
    pub fn inject_hint(self, data: &mut Value, hint_text: &str) {
        match self {
            Self::ChatCompletions => cc_inject_hint(data, hint_text),
            Self::Anthropic => anthropic_inject_hint(data, hint_text),
            Self::ResponsesApi => responses_inject_hint(data, hint_text),
        }
    }

    /// Pull tool calls out of the LLM response.
    pub fn extract_tool_calls(self, response: &Value) -> Vec<ToolCall> {
        match self {
            Self::ChatCompletions => cc_extract_tool_calls(response),
            Self::Anthropic => anthropic_extract_tool_calls(response),
            Self::ResponsesApi => responses_extract_tool_calls(response),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════════════════

/// Resolve the format from an optional `call_type` string or data sniffing.
pub fn resolve(data: &Value, call_type: Option<&str>) -> MessageFormat {
    // 1. Authoritative: use call_type
    if let Some(ct) = call_type {
        match ct {
            "completion" | "acompletion" => return MessageFormat::ChatCompletions,
            "anthropic_messages" => return MessageFormat::Anthropic,
            "responses" | "aresponses" => return MessageFormat::ResponsesApi,
            _ => {
                debug!(call_type = ct, "unknown_call_type_fallback");
            }
        }
    }

    // 2. Fallback: sniff the data dict
    if let Some(messages) = data.get("messages") {
        if let Some(arr) = messages.as_array()
            && has_anthropic_blocks(arr) {
                return MessageFormat::Anthropic;
            }
        return MessageFormat::ChatCompletions;
    }
    MessageFormat::ResponsesApi
}

// ═══════════════════════════════════════════════════════════════════════════
// Convenience free functions
// ═══════════════════════════════════════════════════════════════════════════

/// Normalize request data to internal Chat Completions message format.
pub fn normalize_input(data: &Value, call_type: Option<&str>) -> Vec<Value> {
    resolve(data, call_type).normalize_input(data)
}

/// Extract tool calls from an LLM response (tries all formats).
pub fn extract_tool_calls(response: &Value) -> Vec<ToolCall> {
    // Responses API: output list with function_call items.
    if let Some(output) = response.get("output").and_then(Value::as_array)
        && !output.is_empty() {
            return responses_extract_tool_calls(response);
        }

    // Anthropic: content list with tool_use blocks.
    if let Some(content) = response.get("content").and_then(Value::as_array) {
        for block in content {
            if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                return anthropic_extract_tool_calls(response);
            }
        }
    }

    // Chat Completions: choices[0].message.tool_calls.
    if let Some(choices) = response.get("choices").and_then(Value::as_array)
        && !choices.is_empty() {
            return cc_extract_tool_calls(response);
        }

    Vec::new()
}

/// Inject a UX/security hint into the request.
pub fn inject_hint(data: &mut Value, hint_text: &str, call_type: Option<&str>) {
    resolve(data, call_type).inject_hint(data, hint_text);
}

// ═══════════════════════════════════════════════════════════════════════════
// Chat Completions (OpenAI)
// ═══════════════════════════════════════════════════════════════════════════

fn cc_normalize_input(data: &Value) -> Vec<Value> {
    data.get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn cc_inject_hint(data: &mut Value, hint_text: &str) {
    let messages = data
        .as_object_mut()
        .and_then(|o| {
            o.entry("messages")
                .or_insert_with(|| Value::Array(Vec::new()))
                .as_array_mut()
        });
    if let Some(msgs) = messages {
        msgs.insert(
            0,
            json!({"role": "system", "content": hint_text}),
        );
    }
}

fn cc_extract_tool_calls(response: &Value) -> Vec<ToolCall> {
    let choices = match response.get("choices").and_then(Value::as_array) {
        Some(c) if !c.is_empty() => c,
        _ => return Vec::new(),
    };
    extract_from_chat_choices(choices)
}

// ═══════════════════════════════════════════════════════════════════════════
// Anthropic Messages API
// ═══════════════════════════════════════════════════════════════════════════

fn anthropic_normalize_input(data: &Value) -> Vec<Value> {
    let raw = match data.get("messages").and_then(Value::as_array) {
        Some(msgs) if !msgs.is_empty() => msgs,
        _ => return Vec::new(),
    };

    if !has_anthropic_blocks(raw) {
        return raw.clone();
    }

    convert_anthropic_messages(raw)
}

fn anthropic_inject_hint(data: &mut Value, hint_text: &str) {
    let obj = match data.as_object_mut() {
        Some(o) => o,
        None => return,
    };

    match obj.get("system") {
        None => {
            obj.insert("system".into(), Value::String(hint_text.into()));
        }
        Some(Value::String(existing)) => {
            let combined = format!("{hint_text}\n\n{existing}");
            obj.insert("system".into(), Value::String(combined));
        }
        Some(Value::Array(existing)) => {
            let mut blocks = vec![json!({"type": "text", "text": hint_text})];
            blocks.extend(existing.iter().cloned());
            obj.insert("system".into(), Value::Array(blocks));
        }
        _ => {}
    }
}

fn anthropic_extract_tool_calls(response: &Value) -> Vec<ToolCall> {
    let content = match response.get("content").and_then(Value::as_array) {
        Some(c) => c,
        None => return Vec::new(),
    };

    let mut calls = Vec::new();
    for block in content {
        if block.get("type").and_then(Value::as_str) != Some("tool_use") {
            continue;
        }
        calls.push(ToolCall {
            id: block
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .into(),
            name: block
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .into(),
            arguments: parse_arguments(block.get("input").unwrap_or(&Value::Object(Map::new()))),
        });
    }
    calls
}

fn has_anthropic_blocks(messages: &[Value]) -> bool {
    for msg in messages {
        let content = match msg.get("content").and_then(Value::as_array) {
            Some(c) => c,
            None => continue,
        };
        for block in content {
            if let Some(t) = block.get("type").and_then(Value::as_str)
                && (t == "tool_use" || t == "tool_result") {
                    return true;
                }
        }
    }
    false
}

fn convert_anthropic_messages(messages: &[Value]) -> Vec<Value> {
    let mut result = Vec::new();

    for msg in messages {
        let role = msg
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("user");
        let content = msg.get("content");

        // Plain string / None content — pass through
        let content_arr = if let Some(arr) = content.and_then(Value::as_array) { arr } else {
            let mut out = json!({"role": role, "content": content.cloned().unwrap_or(Value::Null)});
            for field in &["tool_calls", "tool_call_id", "name"] {
                if let Some(val) = msg.get(*field) {
                    out.as_object_mut()
                        .unwrap()
                        .insert((*field).into(), val.clone());
                }
            }
            result.push(out);
            continue;
        };

        // Split content blocks by type
        let mut text_parts: Vec<String> = Vec::new();
        let mut tool_uses: Vec<&Value> = Vec::new();
        let mut tool_results: Vec<&Value> = Vec::new();

        for block in content_arr {
            if !block.is_object() {
                if let Some(s) = block.as_str() {
                    text_parts.push(s.into());
                }
                continue;
            }
            let btype = block
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            match btype {
                "text" => {
                    if let Some(t) = block.get("text").and_then(Value::as_str)
                        && !t.is_empty() {
                            text_parts.push(t.into());
                        }
                }
                "tool_use" => tool_uses.push(block),
                "tool_result" => tool_results.push(block),
                _ => {} // image, document, etc.
            }
        }

        match role {
            "assistant" => {
                if !tool_uses.is_empty() {
                    let tc_list: Vec<Value> = tool_uses
                        .iter()
                        .map(|tu| {
                            let default_input = Value::Object(Map::new());
                            let args = tu.get("input").unwrap_or(&default_input);
                            let args_str = if args.is_object() {
                                serde_json::to_string(args).unwrap_or_default()
                            } else {
                                args.to_string()
                            };
                            json!({
                                "id": tu.get("id").and_then(Value::as_str).unwrap_or_default(),
                                "type": "function",
                                "function": {
                                    "name": tu.get("name").and_then(Value::as_str).unwrap_or_default(),
                                    "arguments": args_str,
                                }
                            })
                        })
                        .collect();

                    let content_val = if text_parts.is_empty() {
                        Value::Null
                    } else {
                        Value::String(text_parts.join("\n"))
                    };
                    result.push(json!({
                        "role": "assistant",
                        "content": content_val,
                        "tool_calls": tc_list,
                    }));
                } else if !text_parts.is_empty() {
                    result.push(json!({"role": "assistant", "content": text_parts.join("\n")}));
                } else {
                    result.push(json!({"role": "assistant", "content": null}));
                }
            }
            "user" => {
                if !tool_results.is_empty() {
                    if !text_parts.is_empty() {
                        result.push(json!({"role": "user", "content": text_parts.join("\n")}));
                    }
                    for tr in &tool_results {
                        let default_content = Value::String(String::new());
                        let tr_content = tr.get("content").unwrap_or(&default_content);
                        let content_str = flatten_content(tr_content);
                        result.push(json!({
                            "role": "tool",
                            "tool_call_id": tr.get("tool_use_id").and_then(Value::as_str).unwrap_or_default(),
                            "content": content_str,
                        }));
                    }
                } else if !text_parts.is_empty() {
                    result.push(json!({"role": "user", "content": text_parts.join("\n")}));
                } else {
                    result.push(json!({"role": "user", "content": ""}));
                }
            }
            _ => {
                // system or other
                let text = if text_parts.is_empty() {
                    String::new()
                } else {
                    text_parts.join("\n")
                };
                result.push(json!({"role": role, "content": text}));
            }
        }
    }

    result
}

// ═══════════════════════════════════════════════════════════════════════════
// Responses API (OpenAI)
// ═══════════════════════════════════════════════════════════════════════════

fn responses_normalize_input(data: &Value) -> Vec<Value> {
    let raw = data.get("input");
    match raw {
        Some(Value::String(s)) => vec![json!({"role": "user", "content": s})],
        Some(Value::Array(items)) => convert_responses_items(items),
        _ => Vec::new(),
    }
}

fn responses_inject_hint(data: &mut Value, hint_text: &str) {
    let obj = match data.as_object_mut() {
        Some(o) => o,
        None => return,
    };
    let existing = obj
        .get("instructions")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let combined = if existing.is_empty() {
        hint_text.to_string()
    } else {
        format!("{hint_text}\n\n{existing}")
    };
    obj.insert("instructions".into(), Value::String(combined));
}

fn responses_extract_tool_calls(response: &Value) -> Vec<ToolCall> {
    let output = match response.get("output").and_then(Value::as_array) {
        Some(o) => o,
        None => return Vec::new(),
    };
    extract_from_responses_output(output)
}

fn convert_responses_items(items: &[Value]) -> Vec<Value> {
    let mut messages = Vec::new();
    let mut call_id_to_name: HashMap<String, String> = HashMap::new();
    let mut pending_tool_calls: Vec<Value> = Vec::new();

    let flush = |pending: &mut Vec<Value>, msgs: &mut Vec<Value>| {
        if !pending.is_empty() {
            msgs.push(json!({"role": "assistant", "tool_calls": pending.clone()}));
            pending.clear();
        }
    };

    for item in items {
        let item_type = item
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();

        match item_type {
            "message" => {
                flush(&mut pending_tool_calls, &mut messages);
                let content = flatten_content(
                    item.get("content").unwrap_or(&Value::String(String::new())),
                );
                let role = item
                    .get("role")
                    .and_then(Value::as_str)
                    .unwrap_or("user");
                messages.push(json!({"role": role, "content": content}));
            }
            "function_call" => {
                let name = item
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let call_id = item
                    .get("call_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let arguments = item
                    .get("arguments")
                    .and_then(Value::as_str)
                    .unwrap_or("{}")
                    .to_string();
                call_id_to_name.insert(call_id.clone(), name.clone());
                pending_tool_calls.push(json!({
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": arguments},
                }));
            }
            "function_call_output" => {
                flush(&mut pending_tool_calls, &mut messages);
                let call_id = item
                    .get("call_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let name = call_id_to_name
                    .get(&call_id)
                    .cloned()
                    .unwrap_or_default();
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": item.get("output").and_then(Value::as_str).unwrap_or_default(),
                }));
            }
            "item_reference" => continue,
            _ => {
                warn!(item_type = item_type, "unknown_responses_item_type");
            }
        }
    }

    flush(&mut pending_tool_calls, &mut messages);
    messages
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════

fn parse_arguments(raw: &Value) -> Map<String, Value> {
    match raw {
        Value::Object(m) => m.clone(),
        Value::String(s) => {
            if let Ok(Value::Object(m)) = serde_json::from_str(s) {
                m
            } else {
                let mut map = Map::new();
                map.insert("_raw".into(), Value::String(s.clone()));
                map
            }
        }
        _ => Map::new(),
    }
}

fn flatten_content(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(arr) => {
            let parts: Vec<String> = arr
                .iter()
                .filter_map(|block| {
                    if let Some(obj) = block.as_object() {
                        obj.get("text")
                            .and_then(Value::as_str)
                            .filter(|t| !t.is_empty())
                            .map(String::from)
                    } else {
                        block.as_str().map(String::from)
                    }
                })
                .collect();
            parts.join("\n")
        }
        _ => content.to_string(),
    }
}

fn extract_from_chat_choices(choices: &[Value]) -> Vec<ToolCall> {
    let first = match choices.first() {
        Some(c) => c,
        None => return Vec::new(),
    };
    let message = first.get("message").unwrap_or(first);
    let raw_calls = match message.get("tool_calls").and_then(Value::as_array) {
        Some(c) if !c.is_empty() => c,
        _ => return Vec::new(),
    };

    raw_calls
        .iter()
        .map(|tc| {
            let func = tc.get("function").unwrap_or(tc);
            ToolCall {
                id: tc
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
                name: func
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
                arguments: parse_arguments(
                    func.get("arguments").unwrap_or(&json!("{}")),
                ),
            }
        })
        .collect()
}

fn extract_from_responses_output(output: &[Value]) -> Vec<ToolCall> {
    output
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("function_call"))
        .map(|item| {
            let id = item
                .get("call_id")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .into();
            ToolCall {
                id,
                name: item
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
                arguments: parse_arguments(
                    item.get("arguments").unwrap_or(&json!("{}")),
                ),
            }
        })
        .collect()
}
