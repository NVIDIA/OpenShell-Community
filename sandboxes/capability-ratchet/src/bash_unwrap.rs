// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! Recursive `bash -c` unwrapping and subcommand extraction.
//!
//! When a command is `bash -c "..."`, we parse the inner script and analyze
//! the actual commands, not just "bash".

use std::collections::HashSet;
use std::path::Path;

use futures::future::BoxFuture;
use serde_json::Value;
use tracing::warn;

use crate::bash_ast::BashAstClient;
use crate::constants::SHELLS;
use crate::error::SidecarError;

// ---------------------------------------------------------------------------
// xargs flags that consume a following argument
// ---------------------------------------------------------------------------

static XARGS_FLAGS_WITH_ARG: std::sync::LazyLock<HashSet<&str>> = std::sync::LazyLock::new(|| {
    ["-I", "-J", "-L", "-n", "-P", "-R", "-S", "-s", "-d", "-E"]
        .into_iter()
        .collect()
});

// ---------------------------------------------------------------------------
// Quote stripping
// ---------------------------------------------------------------------------

fn strip_quotes(s: &str) -> &str {
    if s.len() >= 2 {
        let bytes = s.as_bytes();
        if (bytes[0] == b'"' || bytes[0] == b'\'') && bytes[0] == bytes[s.len() - 1] {
            return &s[1..s.len() - 1];
        }
    }
    s
}

// ---------------------------------------------------------------------------
// Word text extraction
// ---------------------------------------------------------------------------

fn word_text(word: &Value) -> String {
    // bash-ast canonical field
    if let Some(w) = word.get("word").and_then(Value::as_str)
        && !w.is_empty() {
            return strip_quotes(w).to_string();
        }
    if let Some(t) = word.get("text").and_then(Value::as_str)
        && !t.is_empty() {
            return strip_quotes(t).to_string();
        }
    // Parts-based word
    if let Some(parts) = word.get("parts").and_then(Value::as_array) {
        for part in parts {
            if let Some(t) = part.get("type").and_then(Value::as_str)
                && (t == "variable" || t == "parameter_expansion") {
                    return "$VARIABLE".into();
                }
        }
        return parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("");
    }
    String::new()
}

// ---------------------------------------------------------------------------
// Subcommand extraction
// ---------------------------------------------------------------------------

/// Extract `(command, subcommand)` from AST words.
pub fn extract_subcommand(words: &[Value]) -> (String, Option<String>) {
    if words.is_empty() {
        return (String::new(), None);
    }

    let first_word = word_text(&words[0]);

    // Variable command
    if first_word.starts_with('$') {
        return ("$VARIABLE".into(), None);
    }

    // Strip path: /usr/bin/git -> git
    let cmd = Path::new(&first_word)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&first_word)
        .to_string();

    // Look for first non-flag argument after the command
    for word in &words[1..] {
        let text = word_text(word);
        if !text.starts_with('-') {
            return (cmd, Some(text));
        }
    }

    (cmd, None)
}

// ---------------------------------------------------------------------------
// -c flag detection
// ---------------------------------------------------------------------------

fn find_dash_c_script(words: &[Value]) -> Option<String> {
    for (i, word) in words.iter().enumerate() {
        let text = word_text(word);

        // Exact -c flag
        if text == "-c" {
            return words.get(i + 1).map(word_text);
        }

        // Combined flags like -ic, -lc, etc.
        if text.starts_with('-')
            && !text.starts_with("--")
            && text.len() > 2
            && text.ends_with('c')
        {
            return words.get(i + 1).map(word_text);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// xargs inner command extraction
// ---------------------------------------------------------------------------

fn extract_xargs_command(words: &[Value]) -> Vec<Value> {
    let mut i = 0;
    while i < words.len() {
        let text = word_text(&words[i]);

        if XARGS_FLAGS_WITH_ARG.contains(text.as_str()) {
            i += 2;
            continue;
        }
        if text.starts_with('-') {
            i += 1;
            continue;
        }
        return words[i..].to_vec();
    }
    Vec::new()
}

// ---------------------------------------------------------------------------
// Recursive unwrap
// ---------------------------------------------------------------------------

/// Recursively unwrap `bash -c` and extract all (cmd, subcmd) pairs.
pub fn unwrap_and_extract<'a>(
    ast: &'a Value,
    client: &'a BashAstClient,
    max_depth: usize,
    depth: usize,
) -> BoxFuture<'a, Result<Vec<(String, Option<String>)>, SidecarError>> {
    Box::pin(async move {
        if depth >= max_depth {
            warn!(depth = depth, "bash_unwrap_max_depth");
            return Ok(Vec::new());
        }

        let node_type = ast
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();

        match node_type {
            "simple" => handle_simple(ast, client, max_depth, depth).await,
            "pipeline" => {
                let commands = ast
                    .get("commands")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                handle_list_node(&commands, client, max_depth, depth).await
            }
            "list" | "and" | "or" => {
                let mut results = Vec::new();
                if let Some(left) = ast.get("left") {
                    results.extend(unwrap_and_extract(left, client, max_depth, depth).await?);
                }
                if let Some(right) = ast.get("right") {
                    results.extend(unwrap_and_extract(right, client, max_depth, depth).await?);
                }
                // Some AST formats use "commands" for lists
                let left = ast.get("left");
                let right = ast.get("right");
                if left.is_none() && right.is_none() {
                    let commands = ast
                        .get("commands")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    if !commands.is_empty() {
                        results
                            .extend(handle_list_node(&commands, client, max_depth, depth).await?);
                    }
                }
                Ok(results)
            }
            "subshell" | "group" => {
                if let Some(body) = ast.get("body") {
                    return unwrap_and_extract(body, client, max_depth, depth).await;
                }
                let commands = ast
                    .get("commands")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                handle_list_node(&commands, client, max_depth, depth).await
            }
            "for" | "while" | "until" => {
                if let Some(body) = ast.get("body") {
                    return unwrap_and_extract(body, client, max_depth, depth).await;
                }
                Ok(Vec::new())
            }
            "if" => handle_if(ast, client, max_depth, depth).await,
            "case" => handle_case(ast, client, max_depth, depth).await,
            "empty" => Ok(Vec::new()),
            _ => {
                // Unknown type: try to extract words if present
                if let Some(words) = ast.get("words").and_then(Value::as_array) {
                    Ok(vec![extract_subcommand(words)])
                } else {
                    Ok(Vec::new())
                }
            }
        }
    })
}

async fn handle_simple(
    ast: &Value,
    client: &BashAstClient,
    max_depth: usize,
    depth: usize,
) -> Result<Vec<(String, Option<String>)>, SidecarError> {
    let words = match ast.get("words").and_then(Value::as_array) {
        Some(w) if !w.is_empty() => w,
        _ => return Ok(Vec::new()),
    };

    let cmd_text = word_text(&words[0]);
    let base_cmd = Path::new(&cmd_text)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&cmd_text)
        .to_string();

    // Check if this is a shell with -c
    if SHELLS.contains(base_cmd.as_str())
        && let Some(script) = find_dash_c_script(words) {
            let inner_ast = client.parse(&script).await?;
            return unwrap_and_extract(&inner_ast, client, max_depth, depth + 1).await;
        }

    // eval: re-parse concatenated arguments as shell code
    if base_cmd == "eval" {
        let script: String = words[1..]
            .iter()
            .map(word_text)
            .collect::<Vec<_>>()
            .join(" ");
        if !script.is_empty() {
            let inner_ast = client.parse(&script).await?;
            return unwrap_and_extract(&inner_ast, client, max_depth, depth + 1).await;
        }
    }

    // xargs: extract the inner command after xargs's own flags
    if base_cmd == "xargs" {
        let inner = extract_xargs_command(&words[1..]);
        if !inner.is_empty() {
            return Ok(vec![extract_subcommand(&inner)]);
        }
    }

    // Not a wrapper: extract directly
    Ok(vec![extract_subcommand(words)])
}

async fn handle_list_node(
    commands: &[Value],
    client: &BashAstClient,
    max_depth: usize,
    depth: usize,
) -> Result<Vec<(String, Option<String>)>, SidecarError> {
    let mut results = Vec::new();
    for cmd in commands {
        results.extend(unwrap_and_extract(cmd, client, max_depth, depth).await?);
    }
    Ok(results)
}

async fn handle_if(
    ast: &Value,
    client: &BashAstClient,
    max_depth: usize,
    depth: usize,
) -> Result<Vec<(String, Option<String>)>, SidecarError> {
    let mut results = Vec::new();

    if let Some(condition) = ast.get("condition") {
        results.extend(unwrap_and_extract(condition, client, max_depth, depth).await?);
    }
    let then_body = ast.get("then").or_else(|| ast.get("body"));
    if let Some(body) = then_body {
        results.extend(unwrap_and_extract(body, client, max_depth, depth).await?);
    }
    if let Some(else_body) = ast.get("else") {
        results.extend(unwrap_and_extract(else_body, client, max_depth, depth).await?);
    }

    Ok(results)
}

async fn handle_case(
    ast: &Value,
    client: &BashAstClient,
    max_depth: usize,
    depth: usize,
) -> Result<Vec<(String, Option<String>)>, SidecarError> {
    let mut results = Vec::new();

    let items = ast
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for item in &items {
        if let Some(body) = item.get("body") {
            results.extend(unwrap_and_extract(body, client, max_depth, depth).await?);
        }
    }

    Ok(results)
}
