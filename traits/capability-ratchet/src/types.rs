// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! Shared type definitions for the Capability Ratchet guardrail.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/// Describes how the conversation context has been tainted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum TaintFlag {
    #[serde(rename = "has-private-data")]
    HasPrivateData,
    #[serde(rename = "has-untrusted-input")]
    HasUntrustedInput,
}

impl TaintFlag {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::HasPrivateData => "has-private-data",
            Self::HasUntrustedInput => "has-untrusted-input",
        }
    }
}

impl std::fmt::Display for TaintFlag {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Capabilities that a tool invocation may require.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Capability {
    #[serde(rename = "network:egress")]
    NetworkEgress,
    #[serde(rename = "network:egress:approved")]
    NetworkEgressApproved,
    #[serde(rename = "exec:arbitrary")]
    ExecArbitrary,
    #[serde(rename = "exec:irreversible")]
    ExecIrreversible,
}

impl Capability {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NetworkEgress => "network:egress",
            Self::NetworkEgressApproved => "network:egress:approved",
            Self::ExecArbitrary => "exec:arbitrary",
            Self::ExecIrreversible => "exec:irreversible",
        }
    }
}

impl std::fmt::Display for Capability {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Whether an operation can be undone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Reversibility {
    Reversible,
    Irreversible,
    Unknown,
}

impl Reversibility {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Reversible => "reversible",
            Self::Irreversible => "irreversible",
            Self::Unknown => "unknown",
        }
    }
}

impl std::fmt::Display for Reversibility {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

/// Normalized tool call, agnostic of LLM request format.
#[derive(Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Map<String, serde_json::Value>,
}

/// Result of resolving a command against the policy.
#[derive(Debug, Clone)]
pub struct ToolLookupResult {
    pub taint: BTreeSet<TaintFlag>,
    pub source: String,
    pub requires: BTreeSet<Capability>,
}

/// Minimal taint state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationTaint {
    pub taint: BTreeSet<TaintFlag>,
    pub ts: i64,
}
