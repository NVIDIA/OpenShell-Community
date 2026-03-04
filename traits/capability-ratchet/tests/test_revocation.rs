// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

use std::collections::BTreeSet;

use capability_ratchet_sidecar::revocation::get_forbidden;
use capability_ratchet_sidecar::types::{Capability, TaintFlag};

#[test]
fn test_no_taint_nothing_forbidden() {
    let taint = BTreeSet::new();
    let forbidden = get_forbidden(&taint);
    assert!(forbidden.is_empty());
}

#[test]
fn test_private_data_forbids_egress() {
    let taint: BTreeSet<TaintFlag> = [TaintFlag::HasPrivateData].into();
    let forbidden = get_forbidden(&taint);
    assert!(forbidden.contains(&Capability::NetworkEgress));
    assert!(!forbidden.contains(&Capability::ExecIrreversible));
    assert!(!forbidden.contains(&Capability::ExecArbitrary));
}

#[test]
fn test_untrusted_input_forbids_exec_irreversible() {
    let taint: BTreeSet<TaintFlag> = [TaintFlag::HasUntrustedInput].into();
    let forbidden = get_forbidden(&taint);
    assert!(forbidden.contains(&Capability::ExecIrreversible));
    assert!(!forbidden.contains(&Capability::NetworkEgress));
}

#[test]
fn test_both_flags_forbids_egress_arbitrary_irreversible() {
    let taint: BTreeSet<TaintFlag> =
        [TaintFlag::HasPrivateData, TaintFlag::HasUntrustedInput].into();
    let forbidden = get_forbidden(&taint);
    assert!(forbidden.contains(&Capability::NetworkEgress));
    assert!(forbidden.contains(&Capability::ExecArbitrary));
    assert!(forbidden.contains(&Capability::ExecIrreversible));
    // network:egress:approved is NEVER forbidden
    assert!(!forbidden.contains(&Capability::NetworkEgressApproved));
}
