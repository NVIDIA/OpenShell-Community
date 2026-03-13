// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! Async client for bash-ast Unix socket server.
//!
//! Protocol: NDJSON (newline-delimited JSON) over Unix socket.
//!   Request:  `{"method":"parse","script":"echo hello"}\n`
//!   Response: `{"result":{...ast...}}\n`
//!   Error:    `{"error":"message"}\n`

use serde_json::{Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::Mutex;
use tracing::debug;

use crate::error::SidecarError;

const DEFAULT_SOCKET_PATH: &str = "/tmp/bash-ast.sock";

/// Async NDJSON client for the bash-ast Unix socket server.
pub struct BashAstClient {
    socket_path: String,
    inner: Mutex<Option<Connection>>,
}

struct Connection {
    reader: BufReader<tokio::io::ReadHalf<UnixStream>>,
    writer: tokio::io::WriteHalf<UnixStream>,
}

impl BashAstClient {
    /// Create a new client with the given socket path.
    pub fn new(socket_path: Option<&str>) -> Self {
        let path = socket_path
            .map(String::from)
            .or_else(|| std::env::var("BASH_AST_SOCKET").ok())
            .unwrap_or_else(|| DEFAULT_SOCKET_PATH.into());
        Self {
            socket_path: path,
            inner: Mutex::new(None),
        }
    }

    async fn ensure_connected(
        inner: &mut Option<Connection>,
        socket_path: &str,
    ) -> Result<(), SidecarError> {
        if inner.is_none() {
            let stream = UnixStream::connect(socket_path).await.map_err(|e| {
                SidecarError::BashAst(format!("Cannot connect to bash-ast at {socket_path}: {e}"))
            })?;
            let (read_half, write_half) = tokio::io::split(stream);
            *inner = Some(Connection {
                reader: BufReader::new(read_half),
                writer: write_half,
            });
        }
        Ok(())
    }

    async fn send_request(&self, payload: &Value) -> Result<Value, SidecarError> {
        let mut guard = self.inner.lock().await;
        Self::ensure_connected(&mut guard, &self.socket_path).await?;

        let conn = guard.as_mut().unwrap();
        let line = format!("{}\n", serde_json::to_string(payload)?);

        if let Err(e) = conn.writer.write_all(line.as_bytes()).await {
            *guard = None;
            return Err(SidecarError::BashAst(format!("Connection lost: {e}")));
        }
        if let Err(e) = conn.writer.flush().await {
            *guard = None;
            return Err(SidecarError::BashAst(format!("Connection lost: {e}")));
        }

        let mut response_line = String::new();
        let bytes_read = conn
            .reader
            .read_line(&mut response_line)
            .await
            .map_err(|e| {
                *guard = None;
                SidecarError::BashAst(format!("Connection lost: {e}"))
            })?;

        if bytes_read == 0 {
            *guard = None;
            return Err(SidecarError::BashAst("Server closed the connection".into()));
        }

        drop(guard);

        let response: Value = serde_json::from_str(&response_line)
            .map_err(|e| SidecarError::BashAst(format!("Invalid JSON from server: {e}")))?;

        if let Some(err) = response.get("error").and_then(Value::as_str) {
            return Err(SidecarError::BashSyntax(err.into()));
        }

        Ok(response)
    }

    /// Parse a bash script string into an AST.
    ///
    /// # Errors
    ///
    /// Returns `SidecarError` if the connection fails or the server returns an error.
    pub async fn parse(&self, script: &str) -> Result<Value, SidecarError> {
        if script.is_empty() || script.trim().is_empty() {
            return Ok(serde_json::json!({"type": "empty"}));
        }

        let response = self
            .send_request(&serde_json::json!({"method": "parse", "script": script}))
            .await?;

        Ok(response
            .get("result")
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::default())))
    }

    /// Convert an AST back into a bash script string.
    ///
    /// # Errors
    ///
    /// Returns `SidecarError` if the connection fails or the server returns an error.
    pub async fn to_bash(&self, ast: &Value) -> Result<String, SidecarError> {
        let response = self
            .send_request(&serde_json::json!({"method": "to_bash", "ast": ast}))
            .await?;

        Ok(response
            .get("result")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .into())
    }

    /// Ping the server. Returns `true` on success.
    pub async fn ping(&self) -> bool {
        self.send_request(&serde_json::json!({"method": "ping"}))
            .await
            .is_ok()
    }

    /// Close the connection.
    pub async fn close(&self) {
        *self.inner.lock().await = None;
        debug!("bash-ast connection closed");
    }
}
