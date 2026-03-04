// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

//! Fixed revocation matrix: taint flags → forbidden capabilities.
//!
//! Neither flag               → nothing forbidden
//! has-private-data only      → `network:egress`
//! has-untrusted-input only   → `exec:irreversible`
//! both (lethal trifecta)     → `network:egress`, `exec:arbitrary`, `exec:irreversible`
//!
//! `network:egress:approved` is NEVER forbidden.

use std::collections::BTreeSet;

use crate::types::{Capability, TaintFlag};

/// Return the set of capabilities forbidden for the given taint flags.
pub fn get_forbidden(taint: &BTreeSet<TaintFlag>) -> BTreeSet<Capability> {
    let has_private = taint.contains(&TaintFlag::HasPrivateData);
    let has_untrusted = taint.contains(&TaintFlag::HasUntrustedInput);

    match (has_private, has_untrusted) {
        (false, false) => BTreeSet::new(),
        (true, false) => std::iter::once(Capability::NetworkEgress).collect(),
        (false, true) => std::iter::once(Capability::ExecIrreversible).collect(),
        (true, true) => [
            Capability::NetworkEgress,
            Capability::ExecArbitrary,
            Capability::ExecIrreversible,
        ]
        .into_iter()
        .collect(),
    }
}
