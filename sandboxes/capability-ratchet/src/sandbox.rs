// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! OS-level sandbox for network-denied interpreter execution.
//!
//! When both taint flags are set and a tool call involves an interpreter,
//! instead of blocking outright, we wrap the command in a network-denied sandbox.
//!
//! Linux:  `unshare --net`
//! macOS:  `sandbox-exec -p '(version 1)(allow default)(deny network*)'`

use serde_json::{Value, json};

use crate::bash_ast::BashAstClient;
use crate::error::SidecarError;

/// macOS sandbox profile string.
const MACOS_SANDBOX_PROFILE: &str = "(version 1)(allow default)(deny network*)";

/// AST word flag for single-quoted strings.
const SINGLEQUOTE_FLAG: u64 = 2;

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

const fn get_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unsupported"
    }
}

/// Check if OS sandbox tool is available.
pub fn is_sandbox_available() -> bool {
    match get_platform() {
        "darwin" => which("sandbox-exec"),
        "linux" => which("unshare"),
        _ => false,
    }
}

fn which(cmd: &str) -> bool {
    std::process::Command::new("which")
        .arg(cmd)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

// ---------------------------------------------------------------------------
// AST word helpers
// ---------------------------------------------------------------------------

fn make_word(text: &str, flags: Option<u64>) -> Value {
    let mut word = json!({"text": text});
    if let Some(f) = flags {
        word.as_object_mut()
            .unwrap()
            .insert("flags".into(), json!(f));
    }
    word
}

fn make_sandbox_words() -> Result<Vec<Value>, SidecarError> {
    match get_platform() {
        "darwin" => Ok(vec![
            make_word("sandbox-exec", None),
            make_word("-p", None),
            make_word(MACOS_SANDBOX_PROFILE, Some(SINGLEQUOTE_FLAG)),
        ]),
        "linux" => Ok(vec![
            make_word("unshare", None),
            make_word("--net", None),
        ]),
        p => Err(SidecarError::Config(format!(
            "No sandbox available for platform: {p}"
        ))),
    }
}

// ---------------------------------------------------------------------------
// AST rewriting
// ---------------------------------------------------------------------------

/// Rewrite AST to wrap in network sandbox, return bash string.
pub async fn sandbox_command_ast(
    ast: &Value,
    client: &BashAstClient,
) -> Result<String, SidecarError> {
    let node_type = ast
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if node_type == "simple" {
        sandbox_simple(ast, client).await
    } else {
        sandbox_complex(ast, client).await
    }
}

async fn sandbox_simple(ast: &Value, client: &BashAstClient) -> Result<String, SidecarError> {
    let sandbox_words = make_sandbox_words()?;
    let original_words = ast
        .get("words")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut combined = sandbox_words;
    combined.extend(original_words);

    let mut wrapped = ast.clone();
    wrapped
        .as_object_mut()
        .unwrap()
        .insert("words".into(), Value::Array(combined));

    client.to_bash(&wrapped).await
}

async fn sandbox_complex(ast: &Value, client: &BashAstClient) -> Result<String, SidecarError> {
    let original_bash = client.to_bash(ast).await?;

    let mut sandbox_words = make_sandbox_words()?;
    let bash_c_words = vec![
        make_word("bash", None),
        make_word("-c", None),
        make_word(&original_bash, Some(SINGLEQUOTE_FLAG)),
    ];
    sandbox_words.extend(bash_c_words);

    let wrapper_ast = json!({
        "type": "simple",
        "words": sandbox_words,
    });

    client.to_bash(&wrapper_ast).await
}
