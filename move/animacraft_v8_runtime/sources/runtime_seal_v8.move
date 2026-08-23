/// Typed Runtime/Seal adapters. Every callable path derives semantic Seal
/// keys in Runtime, rereads the exact protected row, and immediately consumes
/// Runtime's private no-ability witness after Seal round-trips it.
module animacraft_v8_runtime::runtime_seal_v8;

use animacraft_v8_core::base_registry_v8::{Self as base, BaseDefinitionRegistryV8};
use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8;
use animacraft_v8_core::treasury_v8::{Self as core_treasury, MakerAccessPassV8};
use animacraft_v8_runtime::runtime_v8::{Self as runtime, MakerLoadoutV8,
    PackAdminCapV8, PackPassV8, PackRegistryV8, PackReleaseV8,
    RuntimeDefinitionRegistryV8, RuntimeOriginalMarkerV8,
    RuntimeBaseEntitlementWitnessV8, RuntimePackEntitlementWitnessV8,
    RuntimePackRegistrationWitnessV8,
    SelectionAccessProofV8};
use animacraft_v8_seal::seal_v8::{Self as seal, BaseDecryptProofV8,
    CiphertextCertificationV8, PackDecryptProofV8, ProtectedAssetSnapshotV8, SealPolicyConfigV8,
    SealRegistryV8};
use std::option::Option;
use std::string::String;

const EInvalidWitness: u64 = 0;

/// Select a protected immutable Base style only after rereading its exact
/// sealed row. Core supplies every style field except certification transport
/// commitments, which Seal verifies rather than trusting.
public fun select_protected_base_style_v8<PaymentCoin>(
    loadout: &mut MakerLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    maker_access: &MakerAccessPassV8,
    seal_registry: &SealRegistryV8,
    seal_policy: &SealPolicyConfigV8,
    expected_loadout_revision: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    swatch_key: Option<String>,
    ciphertext_blob_commitment: vector<u8>,
    certification_commitment: vector<u8>,
    seal_id: vector<u8>,
    ctx: &sui::tx_context::TxContext,
) {
    let style = base::borrow_style_v8(base_registry, part_key, item_key, style_key);
    let snapshot = seal::protected_asset_snapshot_v8(
        seal_registry, seal_policy, root, seal::scope_base_v8(),
        runtime::base_seal_scope_key_v8(),
        *animacraft_v8_core::maker_v8::root_content_commitment_v8(root),
        runtime::style_seal_asset_key_v8(part_key, item_key, style_key),
        *base::style_payload_commitment_v8(style),
        *base::style_asset_blob_id_v8(style), *base::style_asset_sha256_v8(style),
        ciphertext_blob_commitment, certification_commitment, seal_id,
    );
    runtime::select_protected_base_style_after_seal_v8(
        loadout, root, definitions, packs, base_registry, maker_access,
        expected_loadout_revision, part_key, item_key, style_key, swatch_key,
        snapshot_commitment(&snapshot), ctx,
    )
}

public fun prove_protected_base_selection_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    seal_registry: &SealRegistryV8,
    seal_policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    selection_index: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    ciphertext_blob_commitment: vector<u8>,
    certification_commitment: vector<u8>,
    seal_id: vector<u8>,
    ctx: &sui::tx_context::TxContext,
): SelectionAccessProofV8 {
    let style = base::borrow_style_v8(base_registry, part_key, item_key, style_key);
    let snapshot = seal::protected_asset_snapshot_v8(
        seal_registry, seal_policy, root, seal::scope_base_v8(),
        runtime::base_seal_scope_key_v8(),
        *animacraft_v8_core::maker_v8::root_content_commitment_v8(root),
        runtime::style_seal_asset_key_v8(part_key, item_key, style_key),
        *base::style_payload_commitment_v8(style),
        *base::style_asset_blob_id_v8(style), *base::style_asset_sha256_v8(style),
        ciphertext_blob_commitment, certification_commitment, seal_id,
    );
    runtime::prove_protected_base_selection_after_seal_v8(
        loadout, definitions, base_registry, root, maker_access, selection_index,
        snapshot_commitment(&snapshot), ctx,
    )
}

public fun certify_protected_base_entitlement_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    catalog: &ProductReleaseCatalogV8,
    seal_registry: &SealRegistryV8,
    seal_policy: &SealPolicyConfigV8,
    selection_index: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    ciphertext_blob_commitment: vector<u8>,
    certification_commitment: vector<u8>,
    seal_id: vector<u8>,
    ctx: &sui::tx_context::TxContext,
): BaseDecryptProofV8 {
    let style = base::borrow_style_v8(base_registry, part_key, item_key, style_key);
    let scope_key = runtime::base_seal_scope_key_v8();
    let asset_key = runtime::style_seal_asset_key_v8(part_key, item_key, style_key);
    let snapshot = seal::protected_asset_snapshot_v8(
        seal_registry, seal_policy, root, seal::scope_base_v8(), scope_key,
        *animacraft_v8_core::maker_v8::root_content_commitment_v8(root), asset_key,
        *base::style_payload_commitment_v8(style),
        *base::style_asset_blob_id_v8(style), *base::style_asset_sha256_v8(style),
        ciphertext_blob_commitment, certification_commitment, seal_id,
    );
    let witness = runtime::new_base_entitlement_witness_v8(
        loadout, definitions, base_registry, root, maker_access,
        selection_index, snapshot_commitment(&snapshot), ctx);
    let (witness, proof) = seal::certify_base_entitlement_v8<
        PaymentCoin, RuntimeOriginalMarkerV8, RuntimeBaseEntitlementWitnessV8,
    >(
        witness, catalog, root, ctx.sender(),
        core_treasury::maker_access_pass_id_v8(maker_access),
        runtime::maker_access_entitlement_commitment_v8(maker_access),
        *seal::snapshot_scope_key_v8(&snapshot),
        *seal::snapshot_asset_key_v8(&snapshot), *seal::snapshot_seal_id_v8(&snapshot),
    );
    let (_, revision, returned_index, holder, entitlement_id,
        entitlement_commitment, _) = runtime::consume_base_entitlement_witness(witness);
    assert!(revision == runtime::loadout_revision_v8(loadout), EInvalidWitness);
    assert!(returned_index == selection_index && holder == ctx.sender(), EInvalidWitness);
    assert!(entitlement_id == core_treasury::maker_access_pass_id_v8(maker_access),
        EInvalidWitness);
    assert!(entitlement_commitment ==
        runtime::maker_access_entitlement_commitment_v8(maker_access), EInvalidWitness);
    proof
}

/// Register one post-activation protected Pack style through Seal's frozen
/// Runtime role, then bind the Pack row to Seal's complete exact snapshot.
public fun append_protected_pack_style_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>,
    cap: &PackAdminCapV8,
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    seal_registry: &mut SealRegistryV8,
    seal_policy: &SealPolicyConfigV8,
    catalog: &ProductReleaseCatalogV8,
    expected_seal_revision: u64,
    certification: CiphertextCertificationV8,
    sequence: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>,
    ciphertext_blob_commitment: vector<u8>,
    asset_content_commitment: vector<u8>,
    certification_commitment: vector<u8>,
    style_commitment: vector<u8>,
    ctx: &sui::tx_context::TxContext,
) {
    let scope_key = runtime::pack_seal_scope_key_v8(
        *runtime::pack_release_semantic_id_v8(release));
    let asset_key = runtime::style_seal_asset_key_v8(part_key, item_key, style_key);
    let witness = runtime::new_pack_registration_witness_v8(
        release, cap, definitions, sequence, part_key, item_key, style_key,
        asset_content_commitment, ctx);
    let (witness, seal_id) = seal::register_pack_ciphertext_v8<
        PaymentCoin, RuntimeOriginalMarkerV8, RuntimePackRegistrationWitnessV8,
    >(
        witness, seal_registry, root, seal_policy, catalog,
        expected_seal_revision, certification,
    );
    let snapshot = seal::protected_asset_snapshot_v8(
        seal_registry, seal_policy, root, seal::scope_pack_v8(), scope_key,
        *runtime::pack_release_content_commitment_v8(release), asset_key,
        asset_content_commitment, ciphertext_blob_id, ciphertext_sha256,
        ciphertext_blob_commitment, certification_commitment, seal_id,
    );
    let binding = snapshot_commitment(&snapshot);
    runtime::append_certified_pack_style_v8(
        release, cap, definitions, base_registry, witness, layer_track_key,
        color_channel_key, default_swatch_key, ciphertext_blob_id,
        ciphertext_sha256, asset_content_commitment, binding,
        style_commitment, ctx,
    )
}

/// Produce the ordered selection proof for an already-selected protected Pack
/// style only after an exact live Seal-row reread.
public fun prove_protected_pack_selection_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pass: &PackPassV8,
    seal_registry: &SealRegistryV8,
    seal_policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    selection_index: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_content_commitment: vector<u8>,
    ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>,
    ciphertext_blob_commitment: vector<u8>,
    certification_commitment: vector<u8>,
    seal_id: vector<u8>,
    ctx: &sui::tx_context::TxContext,
): SelectionAccessProofV8 {
    let snapshot = seal::protected_asset_snapshot_v8(
        seal_registry, seal_policy, root, seal::scope_pack_v8(),
        runtime::pack_seal_scope_key_v8(*runtime::pack_release_semantic_id_v8(release)),
        *runtime::pack_release_content_commitment_v8(release),
        runtime::style_seal_asset_key_v8(part_key, item_key, style_key),
        asset_content_commitment, ciphertext_blob_id, ciphertext_sha256,
        ciphertext_blob_commitment, certification_commitment, seal_id,
    );
    runtime::prove_protected_pack_selection_after_seal_v8(
        loadout, packs, release, pass, root, maker_access, selection_index,
        snapshot_commitment(&snapshot), ctx,
    )
}

/// Convert Core's typed Maker access plus Runtime's current Pack Pass and
/// selected exact protected row into Seal's transaction-local decrypt proof.
public fun certify_protected_pack_entitlement_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pass: &PackPassV8,
    catalog: &ProductReleaseCatalogV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    seal_registry: &SealRegistryV8,
    seal_policy: &SealPolicyConfigV8,
    selection_index: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_content_commitment: vector<u8>,
    ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>,
    ciphertext_blob_commitment: vector<u8>,
    certification_commitment: vector<u8>,
    seal_id: vector<u8>,
    ctx: &sui::tx_context::TxContext,
): PackDecryptProofV8 {
    core_treasury::assert_maker_access_pass_v8(root, maker_access, ctx.sender());
    let scope_key = runtime::pack_seal_scope_key_v8(
        *runtime::pack_release_semantic_id_v8(release));
    let asset_key = runtime::style_seal_asset_key_v8(part_key, item_key, style_key);
    let snapshot = seal::protected_asset_snapshot_v8(
        seal_registry, seal_policy, root, seal::scope_pack_v8(), scope_key,
        *runtime::pack_release_content_commitment_v8(release), asset_key,
        asset_content_commitment, ciphertext_blob_id, ciphertext_sha256,
        ciphertext_blob_commitment, certification_commitment, seal_id,
    );
    let witness = runtime::new_pack_entitlement_witness_v8(
        loadout, packs, release, pass, root, maker_access, selection_index,
        snapshot_commitment(&snapshot), ctx);
    let (witness, proof) = seal::certify_pack_entitlement_v8<
        PaymentCoin, RuntimeOriginalMarkerV8, RuntimePackEntitlementWitnessV8,
    >(
        witness, catalog, root, ctx.sender(),
        core_treasury::maker_access_pass_id_v8(maker_access),
        runtime::maker_access_entitlement_commitment_v8(maker_access),
        sui::object::id(pass),
        runtime::pack_pass_commitment_v8(pass), sui::object::id(release),
        *runtime::pack_release_content_commitment_v8(release),
        *seal::snapshot_scope_key_v8(&snapshot),
        *seal::snapshot_asset_key_v8(&snapshot),
        *seal::snapshot_seal_id_v8(&snapshot),
    );
    let (_, loadout_revision, returned_index, holder, returned_release_id,
        returned_release_commitment, returned_pass_id, returned_pass_commitment,
        _) = runtime::consume_pack_entitlement_witness(witness);
    assert!(loadout_revision == runtime::loadout_revision_v8(loadout), EInvalidWitness);
    assert!(returned_index == selection_index, EInvalidWitness);
    assert!(holder == ctx.sender(), EInvalidWitness);
    assert!(returned_release_id == sui::object::id(release), EInvalidWitness);
    assert!(returned_release_commitment ==
        *runtime::pack_release_content_commitment_v8(release), EInvalidWitness);
    assert!(returned_pass_id == sui::object::id(pass), EInvalidWitness);
    assert!(returned_pass_commitment == runtime::pack_pass_commitment_v8(pass), EInvalidWitness);
    proof
}

fun snapshot_commitment(snapshot: &ProtectedAssetSnapshotV8): vector<u8> {
    runtime::seal_binding_commitment_v8(
        seal::snapshot_registry_id_v8(snapshot),
        *seal::snapshot_registry_commitment_v8(snapshot),
        seal::snapshot_runtime_revision_v8(snapshot),
        *seal::snapshot_runtime_commitment_v8(snapshot),
        seal::snapshot_policy_config_id_v8(snapshot),
        *seal::snapshot_policy_commitment_v8(snapshot),
        seal::snapshot_root_id_v8(snapshot),
        seal::snapshot_maker_version_v8(snapshot),
        *seal::snapshot_root_content_commitment_v8(snapshot),
        seal::snapshot_scope_kind_v8(snapshot),
        *seal::snapshot_scope_key_v8(snapshot),
        *seal::snapshot_scope_commitment_v8(snapshot),
        *seal::snapshot_asset_key_v8(snapshot),
        *seal::snapshot_asset_content_commitment_v8(snapshot),
        *seal::snapshot_ciphertext_blob_id_v8(snapshot),
        *seal::snapshot_ciphertext_sha256_v8(snapshot),
        *seal::snapshot_ciphertext_blob_commitment_v8(snapshot),
        *seal::snapshot_certification_commitment_v8(snapshot),
        *seal::snapshot_seal_id_v8(snapshot),
    )
}
