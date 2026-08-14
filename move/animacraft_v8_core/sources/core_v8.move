/// Companion-independent constructor for the exact Core object pair. It does
/// not create, import, or claim readiness for any future companion package.
module animacraft_v8_core::core_v8;

use animacraft_v8_core::base_registry_v8::{
    Self as base,
    BaseDefinitionCommitmentsV8,
    BaseDefinitionCountsV8,
    BaseDefinitionRegistryV8,
};
use animacraft_v8_core::maker_v8::{
    Self as maker,
    EconomicsSnapshotV8,
    MakerAdminCapV8,
    MakerRootV8,
    RightsSnapshotV8,
};
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use std::option::Option;
use std::string::String;
use sui::clock::Clock;

const VERSION: u64 = 8;

public fun version_v8(): u64 { VERSION }

/// Allocates one DRAFT Root, its exact AdminCap, and the immutable base
/// definition registry. The caller may create companion objects in the same
/// transaction before sharing the Core objects.
public fun new_maker_draft_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    maker_key: String,
    maker_version: String,
    previous_root_id: Option<ID>,
    previous_version_commitment: Option<vector<u8>>,
    renderer_commitment: vector<u8>,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    expected_base_counts: BaseDefinitionCountsV8,
    expected_base_commitments: BaseDefinitionCommitmentsV8,
    expected_pack_admission_policy_commitment: vector<u8>,
    economics: EconomicsSnapshotV8,
    rights: RightsSnapshotV8,
    clock: &Clock,
    ctx: &mut TxContext,
): (
    MakerRootV8<PaymentCoin>,
    BaseDefinitionRegistryV8,
    MakerAdminCapV8,
) {
    let expected_base_definition_count = base::total_count_v8(&expected_base_counts);
    let expected_base_registry_commitment =
        *base::aggregate_commitment_v8(&expected_base_commitments);
    let (mut root, admin) = maker::new_maker_draft_v8<PaymentCoin>(
        config,
        expected_base_definition_count,
        expected_base_registry_commitment,
        expected_pack_admission_policy_commitment,
        maker_key,
        maker_version,
        previous_root_id,
        previous_version_commitment,
        renderer_commitment,
        manifest_blob_id,
        manifest_sha256,
        content_commitment,
        economics,
        rights,
        clock,
        ctx,
    );
    let registry = base::new_base_definition_registry_v8(
        &root,
        &admin,
        expected_base_counts,
        expected_base_commitments,
        ctx,
    );
    maker::finalize_base_registry_binding_v8(
        &mut root,
        &admin,
        base::registry_id_v8(&registry),
    );
    (root, registry, admin)
}

public fun share_maker_draft_v8<PaymentCoin>(
    root: MakerRootV8<PaymentCoin>,
    registry: BaseDefinitionRegistryV8,
    admin: MakerAdminCapV8,
    ctx: &TxContext,
) {
    base::assert_draft_registry_identity_v8(&registry, &root, &admin);
    base::share_base_definition_registry_v8(registry);
    maker::share_maker_root_and_admin_v8(root, admin, ctx);
}

/// Complete Core-only readiness. It intentionally cannot change lifecycle.
public fun assert_activation_scaffold_ready_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    registry: &BaseDefinitionRegistryV8,
): (ID, vector<u8>, u64) {
    maker::assert_activation_scaffold_ready_v8(root);
    base::assert_activation_ready_v8(registry, root)
}
