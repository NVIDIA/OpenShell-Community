// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! Taint detection from conversation messages.
//!
//! Taint is determined by which tools were invoked, not by inspecting content.

use std::collections::{BTreeSet, HashMap};

use serde_json::Value;
use tracing::debug;

use crate::bash_ast::BashAstClient;
use crate::bash_unwrap::unwrap_and_extract;
use crate::constants::BASH_TOOL_NAMES;
use crate::policy::Policy;
use crate::types::TaintFlag;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse_arguments(raw: &Value) -> serde_json::Map<String, Value> {
    match raw {
        Value::Object(m) => m.clone(),
        Value::String(s) => match serde_json::from_str(s) {
            Ok(Value::Object(m)) => m,
            _ => serde_json::Map::new(),
        },
        _ => serde_json::Map::new(),
    }
}

fn build_tool_call_map(
    messages: &[Value],
) -> HashMap<String, (String, serde_json::Map<String, Value>)> {
    let mut call_map = HashMap::new();
    for msg in messages {
        if msg.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let tool_calls = match msg.get("tool_calls").and_then(Value::as_array) {
            Some(tc) => tc,
            None => continue,
        };
        for tc in tool_calls {
            let call_id = tc
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let func = tc.get("function").unwrap_or(tc);
            let name = func
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let args = parse_arguments(func.get("arguments").unwrap_or(&Value::Null));
            if !call_id.is_empty() {
                call_map.insert(call_id, (name, args));
            }
        }
    }
    call_map
}

fn shlex_fallback(command: &str) -> Vec<(String, Option<String>)> {
    match shell_words::split(command) {
        Ok(tokens) if tokens.is_empty() => Vec::new(),
        Ok(tokens) => {
            let cmd = tokens[0].clone();
            let subcmd = tokens[1..]
                .iter()
                .find(|t| !t.starts_with('-'))
                .cloned();
            vec![(cmd, subcmd)]
        }
        Err(_) => {
            let first = command.split_whitespace().next().unwrap_or("").to_string();
            vec![(first, None)]
        }
    }
}

async fn resolve_bash_command(
    command: &str,
    policy: &Policy,
    bash_ast: Option<&BashAstClient>,
) -> BTreeSet<TaintFlag> {
    let mut taint = BTreeSet::new();

    let pairs = if let Some(client) = bash_ast {
        if let Ok(ast) = client.parse(command).await { if let Ok(p) = unwrap_and_extract(&ast, client, 5, 0).await { p } else {
            debug!(command = command, "bash_unwrap_fallback");
            shlex_fallback(command)
        } } else {
            debug!(command = command, "bash_ast_fallback");
            shlex_fallback(command)
        }
    } else {
        shlex_fallback(command)
    };

    for (cmd, subcmd) in &pairs {
        if cmd.is_empty() {
            continue;
        }
        let result = policy.resolve(cmd, subcmd.as_deref());
        taint.extend(result.taint);
    }

    taint
}

fn resolve_non_bash_tool(
    tool_name: &str,
    arguments: &serde_json::Map<String, Value>,
    policy: &Policy,
) -> BTreeSet<TaintFlag> {
    let subcmd = arguments
        .get("subcommand")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let result = policy.resolve(tool_name, subcmd);
    result.taint
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Detect taint flags from a list of normalized messages.
pub async fn detect_taint(
    messages: &[Value],
    policy: &Policy,
    bash_ast: Option<&BashAstClient>,
) -> BTreeSet<TaintFlag> {
    if messages.is_empty() {
        return BTreeSet::new();
    }

    let call_map = build_tool_call_map(messages);
    let mut taint = BTreeSet::new();

    for msg in messages {
        if msg.get("role").and_then(Value::as_str) != Some("tool") {
            continue;
        }

        let call_id = msg
            .get("tool_call_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();

        let (tool_name, arguments) = if call_id.is_empty() {
            let name = msg
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            (name, serde_json::Map::new())
        } else if let Some((name, args)) = call_map.get(&call_id) {
            (name.clone(), args.clone())
        } else {
            let name = msg
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            (name, serde_json::Map::new())
        };

        if tool_name.is_empty() {
            continue;
        }

        if BASH_TOOL_NAMES.contains(tool_name.as_str()) {
            let command = arguments
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !command.trim().is_empty() {
                let flags = resolve_bash_command(command, policy, bash_ast).await;
                taint.extend(flags);
            }
            continue;
        }

        let flags = resolve_non_bash_tool(&tool_name, &arguments, policy);
        taint.extend(flags);
    }

    taint
}
