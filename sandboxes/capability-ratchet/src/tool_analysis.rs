// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! Tool call analysis: determine required capabilities and taint.

use std::collections::BTreeSet;
use regex::Regex;
use serde_json::Value;
use tracing::warn;

use crate::bash_ast::BashAstClient;
use crate::bash_unwrap::unwrap_and_extract;
use crate::constants::{
    BASH_TOOL_NAMES, INTERPRETER_COMMANDS, NETWORK_CODE_INDICATORS, NETWORK_COMMANDS,
};
use crate::error::SidecarError;
use crate::policy::Policy;
use crate::reversibility::classify as classify_reversibility;
use crate::sandbox::{is_sandbox_available, sandbox_command_ast};
use crate::types::{Capability, Reversibility, TaintFlag, ToolCall};

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/// The outcome of analyzing a single tool call.
#[derive(Debug, Clone)]
pub struct AnalysisResult {
    pub required_capabilities: BTreeSet<Capability>,
    pub taint: BTreeSet<TaintFlag>,
    pub sandboxed_command: Option<String>,
}

// ---------------------------------------------------------------------------
// URL extraction pattern
// ---------------------------------------------------------------------------

static URL_PATTERN: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
    Regex::new(
        r"(?:https?://[^\s]+|(?:[a-zA-Z0-9-]{1,63}\.){1,10}[a-zA-Z]{2,63}(?:/[^\s]*)?)",
    )
    .unwrap()
});

const MAX_URL_SCAN_LENGTH: usize = 4096;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn extract_urls(words: &[&str]) -> Vec<String> {
    let mut urls = Vec::new();
    for word in words {
        let scan = if word.len() > MAX_URL_SCAN_LENGTH {
            &word[..MAX_URL_SCAN_LENGTH]
        } else {
            word
        };
        for m in URL_PATTERN.find_iter(scan) {
            urls.push(m.as_str().to_string());
        }
    }
    urls
}

fn ast_has_dev_tcp_redirect(ast: &Value) -> bool {
    // Check redirects
    if let Some(redirects) = ast.get("redirects").and_then(Value::as_array) {
        for redir in redirects {
            let target = redir
                .get("file")
                .and_then(|f| {
                    f.as_str()
                        .map(String::from)
                        .or_else(|| f.get("text").and_then(Value::as_str).map(String::from))
                })
                .unwrap_or_default();
            if target.contains("/dev/tcp") || target.contains("/dev/udp") {
                return true;
            }
        }
    }

    // Check words
    if let Some(words) = ast.get("words").and_then(Value::as_array) {
        for word in words {
            let text = if let Some(s) = word.as_str() {
                s.to_string()
            } else {
                word.get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            };
            if text.contains("/dev/tcp") || text.contains("/dev/udp") {
                return true;
            }
        }
    }

    // Recurse into children
    for key in &["left", "right", "body", "condition", "then", "else"] {
        if let Some(child) = ast.get(*key)
            && child.is_object() && ast_has_dev_tcp_redirect(child) {
                return true;
            }
    }

    for key in &["commands", "items"] {
        if let Some(children) = ast.get(*key).and_then(Value::as_array) {
            for child in children {
                if child.is_object() && ast_has_dev_tcp_redirect(child) {
                    return true;
                }
            }
        }
    }

    false
}

fn flatten_ast_words(ast: &Value) -> Vec<String> {
    ast.get("words")
        .and_then(Value::as_array)
        .map(|words| {
            words
                .iter()
                .map(|w| {
                    if let Some(s) = w.as_str() {
                        s.to_string()
                    } else {
                        w.get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string()
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn convert_ast_for_reversibility(ast: &Value) -> Value {
    let node_type = ast
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();

    match node_type {
        "simple" => {
            let words = flatten_ast_words(ast);
            serde_json::json!({
                "type": "simple_command",
                "words": words,
            })
        }
        "pipeline" => {
            let commands = ast
                .get("commands")
                .and_then(Value::as_array)
                .map(|c| c.iter().map(convert_ast_for_reversibility).collect::<Vec<_>>())
                .unwrap_or_default();
            serde_json::json!({
                "type": "pipeline",
                "commands": commands,
            })
        }
        "list" | "and" | "or" => {
            let mut commands = Vec::new();
            if let Some(left) = ast.get("left") {
                commands.push(convert_ast_for_reversibility(left));
            }
            if let Some(right) = ast.get("right") {
                commands.push(convert_ast_for_reversibility(right));
            }
            if commands.is_empty()
                && let Some(cmds) = ast.get("commands").and_then(Value::as_array) {
                    commands.extend(cmds.iter().map(convert_ast_for_reversibility));
                }
            serde_json::json!({
                "type": "command_list",
                "commands": commands,
            })
        }
        _ => ast.clone(),
    }
}

fn subcmd_has_network_code(subcmd: Option<&str>) -> bool {
    match subcmd {
        None => false,
        Some(s) => NETWORK_CODE_INDICATORS.iter().any(|ind| s.contains(ind)),
    }
}

// ---------------------------------------------------------------------------
// Core analysis: bash commands
// ---------------------------------------------------------------------------

async fn analyze_bash_command(
    command: &str,
    policy: &Policy,
    taint: &BTreeSet<TaintFlag>,
    bash_ast: &BashAstClient,
) -> Result<AnalysisResult, SidecarError> {
    let mut capabilities: BTreeSet<Capability> = BTreeSet::new();
    let mut result_taint: BTreeSet<TaintFlag> = BTreeSet::new();
    let mut sandboxed_command: Option<String> = None;
    let mut involves_interpreter = false;

    // Step 1: Parse with bash-ast
    let ast = match bash_ast.parse(command).await {
        Ok(a) => a,
        Err(SidecarError::BashSyntax(_)) => {
            warn!(command = command, "bash_syntax_error");
            capabilities.insert(Capability::ExecArbitrary);
            return Ok(AnalysisResult {
                required_capabilities: capabilities,
                taint: result_taint,
                sandboxed_command: None,
            });
        }
        Err(e) => return Err(SidecarError::BashAstUnavailable(e.to_string())),
    };

    // Step 2: Unwrap bash -c and extract (cmd, subcmd) pairs
    let pairs = match unwrap_and_extract(&ast, bash_ast, 5, 0).await {
        Ok(p) => p,
        Err(e) => return Err(SidecarError::BashAstUnavailable(e.to_string())),
    };

    // Step 3: Analyze each extracted command
    for (cmd, subcmd) in &pairs {
        // 3a. Resolve against policy
        let lookup = policy.resolve(cmd, subcmd.as_deref());
        result_taint.extend(lookup.taint);
        capabilities.extend(lookup.requires);

        // 3b. Variable as command
        if cmd.starts_with('$') {
            capabilities.insert(Capability::ExecArbitrary);
            continue;
        }

        // 3c. Network commands
        if NETWORK_COMMANDS.contains(cmd.as_str()) {
            let mut all_words: Vec<&str> = vec![cmd.as_str()];
            if let Some(sub) = subcmd {
                all_words.push(sub.as_str());
            }
            let urls = extract_urls(&all_words);

            let approved =
                !urls.is_empty() && urls.iter().all(|u| policy.is_endpoint_approved(u));

            if approved {
                capabilities.insert(Capability::NetworkEgressApproved);
            } else {
                capabilities.insert(Capability::NetworkEgress);
            }
            continue;
        }

        // 3d. Interpreter commands
        if INTERPRETER_COMMANDS.contains(cmd.as_str()) {
            involves_interpreter = true;
            capabilities.insert(Capability::ExecArbitrary);

            if subcmd_has_network_code(subcmd.as_deref()) {
                capabilities.insert(Capability::NetworkEgress);
            }
            continue;
        }
    }

    // Step 4: Check reversibility
    let rev_ast = convert_ast_for_reversibility(&ast);
    let (rev, _) = classify_reversibility(&rev_ast);
    if rev == Reversibility::Irreversible {
        capabilities.insert(Capability::ExecIrreversible);
    }

    // Step 5: Check for /dev/tcp and /dev/udp redirects
    if ast_has_dev_tcp_redirect(&ast) {
        capabilities.insert(Capability::NetworkEgress);
    }

    // Step 6: network:egress:approved supersedes network:egress
    if capabilities.contains(&Capability::NetworkEgressApproved) {
        capabilities.remove(&Capability::NetworkEgress);
    }

    // Step 7: Sandboxing logic
    let both_flags = taint.contains(&TaintFlag::HasPrivateData)
        && taint.contains(&TaintFlag::HasUntrustedInput);

    if both_flags
        && capabilities.contains(&Capability::ExecArbitrary)
        && involves_interpreter
        && is_sandbox_available()
    {
        match sandbox_command_ast(&ast, bash_ast).await {
            Ok(cmd) => {
                sandboxed_command = Some(cmd);
                capabilities.remove(&Capability::ExecArbitrary);
            }
            Err(e) => {
                warn!(error = %e, "sandbox_rewrite_failed");
            }
        }
    }

    Ok(AnalysisResult {
        required_capabilities: capabilities,
        taint: result_taint,
        sandboxed_command,
    })
}

// ---------------------------------------------------------------------------
// Core analysis: non-bash tools
// ---------------------------------------------------------------------------

fn analyze_non_bash_tool(tool_call: &ToolCall, policy: &Policy) -> AnalysisResult {
    let subcmd = tool_call
        .arguments
        .get("subcommand")
        .and_then(Value::as_str);
    let lookup = policy.resolve(&tool_call.name, subcmd);

    let mut capabilities: BTreeSet<Capability> = BTreeSet::new();

    if NETWORK_COMMANDS.contains(tool_call.name.as_str()) {
        capabilities.insert(Capability::NetworkEgress);
    }
    if INTERPRETER_COMMANDS.contains(tool_call.name.as_str()) {
        capabilities.insert(Capability::ExecArbitrary);
    }
    capabilities.extend(lookup.requires);

    AnalysisResult {
        required_capabilities: capabilities,
        taint: lookup.taint,
        sandboxed_command: None,
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Analyze a single tool call.
pub async fn analyze_tool_call(
    tool_call: &ToolCall,
    policy: &Policy,
    taint: &BTreeSet<TaintFlag>,
    bash_ast: Option<&BashAstClient>,
) -> Result<AnalysisResult, SidecarError> {
    if BASH_TOOL_NAMES.contains(tool_call.name.as_str()) {
        let command = tool_call
            .arguments
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if command.is_empty() {
            return Ok(AnalysisResult {
                required_capabilities: BTreeSet::new(),
                taint: BTreeSet::new(),
                sandboxed_command: None,
            });
        }
        match bash_ast {
            Some(client) => analyze_bash_command(command, policy, taint, client).await,
            None => Err(SidecarError::BashAstUnavailable(
                "bash-ast client not configured".into(),
            )),
        }
    } else {
        Ok(analyze_non_bash_tool(tool_call, policy))
    }
}
