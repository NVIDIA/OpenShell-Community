// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! Policy configuration for Capability Ratchet.
//!
//! Resolution order for a command:
//!   1. `tools["cmd subcmd"]`  → match (taint + requires from config)
//!   2. `tools["cmd"]`         → base tool fallback
//!   3. `knownSafe`            → no taint, no requires
//!   4. unknown                → both taint flags (fail closed)

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;

use serde_json::Value;
use tracing::warn;
use url::Url;

use crate::error::SidecarError;
use crate::known_safe::BUILTIN_KNOWN_SAFE;
use crate::types::{Capability, TaintFlag, ToolLookupResult};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A single tool entry from the policy YAML.
#[derive(Debug, Clone)]
pub struct ToolEntry {
    pub taint: BTreeSet<TaintFlag>,
    pub requires: BTreeSet<Capability>,
}

/// Parsed policy configuration.
#[derive(Debug, Clone)]
pub struct Policy {
    pub version: String,
    pub name: String,
    pub tools: HashMap<String, ToolEntry>,
    pub known_safe: HashSet<String>,
    pub approved_endpoints: Vec<String>,
}

fn all_taint() -> BTreeSet<TaintFlag> {
    [TaintFlag::HasPrivateData, TaintFlag::HasUntrustedInput]
        .into_iter()
        .collect()
}

impl Policy {
    /// 4-step resolution: `tools[cmd subcmd]` → `tools[cmd]` → `known_safe` → unknown.
    pub fn resolve(&self, cmd: &str, subcmd: Option<&str>) -> ToolLookupResult {
        // 1. Try "cmd subcmd" in tools dict
        if let Some(sub) = subcmd {
            let full = format!("{cmd} {sub}");
            if let Some(entry) = self.tools.get(&full) {
                return ToolLookupResult {
                    taint: entry.taint.clone(),
                    source: "tools".into(),
                    requires: entry.requires.clone(),
                };
            }
        }

        // 2. Try "cmd" in tools dict
        if let Some(entry) = self.tools.get(cmd) {
            return ToolLookupResult {
                taint: entry.taint.clone(),
                source: "tools".into(),
                requires: entry.requires.clone(),
            };
        }

        // 3. Try known_safe (both "cmd subcmd" and "cmd")
        if let Some(sub) = subcmd {
            let full = format!("{cmd} {sub}");
            if self.known_safe.contains(&full) {
                return ToolLookupResult {
                    taint: BTreeSet::new(),
                    source: "known_safe".into(),
                    requires: BTreeSet::new(),
                };
            }
        }
        if self.known_safe.contains(cmd) {
            return ToolLookupResult {
                taint: BTreeSet::new(),
                source: "known_safe".into(),
                requires: BTreeSet::new(),
            };
        }

        // 4. Unknown → fail closed
        warn!(cmd = cmd, subcmd = subcmd, "unknown_command");
        ToolLookupResult {
            taint: all_taint(),
            source: "unknown".into(),
            requires: BTreeSet::new(),
        }
    }

    /// Check URL or hostname against approved endpoint patterns.
    pub fn is_endpoint_approved(&self, url_or_host: &str) -> bool {
        let hostname = extract_hostname(url_or_host);
        for pattern in &self.approved_endpoints {
            let pattern_host = extract_hostname(pattern);
            if glob_match::glob_match(&pattern_host, &hostname) {
                return true;
            }
        }
        false
    }

    /// Load a policy from a YAML file.
    ///
    /// # Errors
    ///
    /// Returns `SidecarError` if the file cannot be read or the YAML is invalid.
    pub fn from_yaml(path: &Path) -> Result<Self, SidecarError> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| SidecarError::Config(format!("cannot read {}: {e}", path.display())))?;
        let data: Value = serde_yaml::from_str(&content)?;
        Self::from_value(&data)
    }

    /// Build a Policy from a `serde_json::Value`.
    ///
    /// # Errors
    ///
    /// Returns `SidecarError` if the policy data is invalid.
    pub fn from_value(data: &Value) -> Result<Self, SidecarError> {
        validate_policy(data)?;

        let version = data
            .get("version")
            .and_then(|v| {
                v.as_str()
                    .map(String::from)
                    .or_else(|| v.as_f64().map(|n| n.to_string()))
            })
            .unwrap_or_else(|| "2.0".into());

        let name = data
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("unnamed")
            .to_string();

        // Parse tools
        let mut tools = HashMap::new();
        if let Some(tools_map) = data.get("tools").and_then(Value::as_object) {
            for (key, entry) in tools_map {
                let taint_values = entry
                    .get("taint")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let mut taint = BTreeSet::new();
                for v in &taint_values {
                    if let Some(s) = v.as_str() {
                        let flag: TaintFlag = serde_json::from_value(Value::String(s.into()))
                            .map_err(|e| {
                                SidecarError::PolicyValidation(format!(
                                    "invalid taint '{s}' in tool '{key}': {e}"
                                ))
                            })?;
                        taint.insert(flag);
                    }
                }

                let requires_values = entry
                    .get("requires")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let mut requires = BTreeSet::new();
                for v in &requires_values {
                    if let Some(s) = v.as_str() {
                        let cap: Capability = serde_json::from_value(Value::String(s.into()))
                            .map_err(|e| {
                                SidecarError::PolicyValidation(format!(
                                    "invalid capability '{s}' in tool '{key}': {e}"
                                ))
                            })?;
                        requires.insert(cap);
                    }
                }

                tools.insert(key.clone(), ToolEntry { taint, requires });
            }
        }

        // Union YAML knownSafe with builtins
        let mut known_safe: HashSet<String> = BUILTIN_KNOWN_SAFE
            .iter()
            .map(|s| (*s).to_string())
            .collect();
        if let Some(yaml_safe) = data.get("knownSafe").and_then(Value::as_array) {
            for v in yaml_safe {
                if let Some(s) = v.as_str() {
                    known_safe.insert(s.to_string());
                }
            }
        }

        // Approved endpoints
        let approved_endpoints = data
            .get("approvedEndpoints")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        Ok(Self {
            version,
            name,
            tools,
            known_safe,
            approved_endpoints,
        })
    }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const KNOWN_TOP_LEVEL_KEYS: &[&str] =
    &["version", "name", "tools", "knownSafe", "approvedEndpoints"];

fn validate_policy(data: &Value) -> Result<(), SidecarError> {
    if let Some(obj) = data.as_object() {
        let unknown: Vec<&String> = obj
            .keys()
            .filter(|k| !KNOWN_TOP_LEVEL_KEYS.contains(&k.as_str()))
            .collect();
        if !unknown.is_empty() {
            warn!(keys = ?unknown, "unknown_policy_keys");
        }

        // tools must be a mapping
        if let Some(tools) = obj.get("tools") {
            if !tools.is_object() && !tools.is_null() {
                return Err(SidecarError::PolicyValidation(
                    "'tools' must be a mapping".into(),
                ));
            }
            if let Some(tools_map) = tools.as_object() {
                for (key, entry) in tools_map {
                    if !entry.is_object() {
                        return Err(SidecarError::PolicyValidation(format!(
                            "tool entry '{key}' must be a mapping"
                        )));
                    }
                }
            }
        }

        // knownSafe must be a list
        if let Some(ks) = obj.get("knownSafe")
            && !ks.is_array()
            && !ks.is_null()
        {
            return Err(SidecarError::PolicyValidation(
                "'knownSafe' must be a list".into(),
            ));
        }

        // approvedEndpoints must be a list
        if let Some(ep) = obj.get("approvedEndpoints")
            && !ep.is_array()
            && !ep.is_null()
        {
            return Err(SidecarError::PolicyValidation(
                "'approvedEndpoints' must be a list".into(),
            ));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn extract_hostname(url_or_host: &str) -> String {
    if url_or_host.contains("://") {
        Url::parse(url_or_host)
            .ok()
            .and_then(|u| u.host_str().map(String::from))
            .unwrap_or_else(|| url_or_host.to_string())
    } else {
        url_or_host
            .split('/')
            .next()
            .unwrap_or(url_or_host)
            .to_string()
    }
}
