// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! Capability Ratchet sidecar for `NemoClaw` sandboxes.

pub mod bash_ast;
pub mod bash_unwrap;
pub mod config;
pub mod constants;
pub mod error;
pub mod known_safe;
pub mod normalize;
pub mod policy;
pub mod proxy;
pub mod revocation;
pub mod reversibility;
pub mod sandbox;
pub mod server;
pub mod taint;
pub mod tool_analysis;
pub mod types;
