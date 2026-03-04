// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! CLI entry point for the capability ratchet sidecar.

use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use tracing::info;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt::format::FmtSpan;

use capability_ratchet_sidecar::bash_ast::BashAstClient;
use capability_ratchet_sidecar::config::SidecarConfig;
use capability_ratchet_sidecar::policy::Policy;
use capability_ratchet_sidecar::server::{AppState, create_router};

#[derive(Parser)]
#[command(
    name = "capability-ratchet-sidecar",
    about = "Capability Ratchet sidecar for OpenShell sandboxes"
)]
struct Cli {
    /// Path to sidecar config YAML
    #[arg(
        long,
        default_value = "/app/ratchet-config.yaml",
        env = "RATCHET_CONFIG"
    )]
    config: PathBuf,
}

#[tokio::main]
async fn main() {
    // Initialize tracing (JSON output to stderr)
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .json()
        .with_span_events(FmtSpan::NONE)
        .with_target(true)
        .init();

    let cli = Cli::parse();

    if !cli.config.exists() {
        eprintln!("Error: config file not found: {}", cli.config.display());
        std::process::exit(1);
    }

    let config = match SidecarConfig::from_yaml(&cli.config) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error loading config: {e}");
            std::process::exit(1);
        }
    };

    if !config.policy_file.exists() {
        eprintln!(
            "Error: policy file not found: {}",
            config.policy_file.display()
        );
        std::process::exit(1);
    }

    let policy = match Policy::from_yaml(&config.policy_file) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Error loading policy: {e}");
            std::process::exit(1);
        }
    };

    // Set bash-ast socket path if configured
    if let Some(ref socket) = config.bash_ast_socket {
        // SAFETY: This runs at startup before spawning threads, so no data race.
        unsafe { std::env::set_var("BASH_AST_SOCKET", socket) };
    }

    // Create bash-ast client if socket is configured
    let bash_ast = config
        .bash_ast_socket
        .as_deref()
        .map(|s| BashAstClient::new(Some(s)));

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .expect("failed to create HTTP client");

    let addr = format!("{}:{}", config.listen.host, config.listen.port);

    info!(
        upstream = config.backend.url,
        policy_file = %config.policy_file.display(),
        shadow_mode = config.shadow_mode,
        "sidecar_initialized",
    );

    let state = Arc::new(AppState {
        config,
        policy,
        http_client,
        bash_ast,
    });

    let app = create_router(state);

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| {
            eprintln!("Error binding to {addr}: {e}");
            std::process::exit(1);
        });

    info!(addr = addr, "listening");
    axum::serve(listener, app).await.unwrap_or_else(|e| {
        eprintln!("Server error: {e}");
        std::process::exit(1);
    });
}
