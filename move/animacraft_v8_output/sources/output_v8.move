/// Fresh unified Maker v8 Complete, protected-output, and Canonical Soul flow.
module animacraft_v8_output::output_v8;

use animacraft_v8_core::activation_v8::{Self as activation, OutputReadinessV8};
use animacraft_v8_core::maker_v8::{Self as maker, MakerAdminCapV8, MakerRootV8};
use animacraft_v8_core::package_binding_v8::{
    Self as binding,
    MarketRoleV8,
    OutputRoleV8,
    PhysicalRoleV8,
    PackageCallCapV8,
    ProductReleaseCatalogV8,
};
use animacraft_v8_core::protocol_config_v8::{
    Self as protocol,
    ProtocolConfigV8,
    ProtocolTreasuryV8,
};
use animacraft_v8_core::treasury_v8::{
    Self as core_treasury,
    MakerTreasuryV8,
};
use animacraft_v8_runtime::runtime_binding_v8::{
    Self as runtime_binding,
    RuntimePackageConfigV8,
};
use animacraft_v8_runtime::runtime_v8::{
    Self as runtime,
    MakerLoadoutV8,
    PackPassV8,
    PackRegistryV8,
    PackReleaseV8,
    PackTreasuryV8,
    RuntimeLoadoutAuthorizationV8,
    RuntimePhysicalSelectionWitnessV8,
    UsedPackV8,
};
use animacraft_v8_seal::seal_v8::{
    Self as seal,
    CompleteDecryptProofV8,
    SealPolicyConfigV8,
    SealRegistryV8,
};
use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::{Self as string, String};
use sui::coin::{Self as coin, Coin};
use sui::event;
use sui::table::{Self as table, Table};
use sui::transfer::{Self as transfer, Receiving};

#[test_only]
use animacraft_v8_core::base_registry_v8::{
    Self as base,
};
#[test_only]
use animacraft_v8_core::core_v8 as core;
#[test_only]
use std::type_name;
#[test_only]
use sui::sui::SUI;
#[test_only]
use sui::test_scenario::{Self as test_scenario, Scenario};

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;
const MAX_ALLOWLIST_COUNT: u64 = 64;
const MAX_OUTPUT_POLICY_COUNT: u64 = 256;
const MAX_SEMANTIC_KEY_BYTES: u64 = 128;
const MAX_BLOB_ID_BYTES: u64 = 512;
const BPS_DENOMINATOR: u128 = 10_000;

const POLICY_ALL_ADMITTED: u8 = 0;
const POLICY_ALLOWLIST: u8 = 1;

const EInvalidConfig: u64 = 0;
const EInvalidBinding: u64 = 1;
const EInvalidPolicy: u64 = 2;
const EInvalidKey: u64 = 3;
const EInvalidCommitment: u64 = 4;
const EInvalidLifecycle: u64 = 5;
const EWrongHolder: u64 = 6;
const ECompleteBlocked: u64 = 7;
const EWrongPayment: u64 = 8;
const EPackMismatch: u64 = 9;
const EInvalidProof: u64 = 10;
const EDuplicate: u64 = 11;
const EInvalidSequence: u64 = 12;
const ERegistrySealed: u64 = 13;
const ERegistryNotSealed: u64 = 14;
const EWrongReceiving: u64 = 15;
const ESelfPurchase: u64 = 16;
const EOwnershipEpochMismatch: u64 = 17;

public struct OutputOriginalMarkerV8 has drop {}
public struct OutputCallableMarkerV8 has drop {}

/// Shared config privately nests Core's unique Output call capability.
public struct OutputPackageConfigV8 has key {
    id: UID,
    version: u64,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    output_call_cap: PackageCallCapV8<OutputRoleV8>,
}

public struct WalletKeyV8 has copy, drop, store { holder: address }

public struct MaterializationKeyV8 has copy, drop, store {
    soul_id: ID,
    materialization_key: String,
}

public struct OutputPolicyKeyV8 has copy, drop, store { output_key: String }

/// One immutable author-defined `complete.outputs[]` row.
public struct OutputPolicyRowV8 has copy, drop, store {
    sequence: u64,
    output_key: String,
    protected_output: bool,
    complete_scope_key: String,
    renderer_schema_commitment: vector<u8>,
    allowed_pack_policy: u8,
    allowed_semantic_pack_ids: vector<String>,
    row_commitment: vector<u8>,
}

/// DRAFT author rows become immutable when sealed. Runtime counters and
/// finished artifacts are separate from the frozen row table.
public struct OutputRegistryV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    renderer_commitment: vector<u8>,
    soul_registry_id: ID,
    expected_output_count: u64,
    observed_output_count: u64,
    expected_policy_commitment: vector<u8>,
    rolling_policy_commitment: vector<u8>,
    sealed: bool,
    policy_rows: Table<OutputPolicyKeyV8, OutputPolicyRowV8>,
    policy_keys: vector<OutputPolicyKeyV8>,
    total_complete_count: u64,
    complete_by_wallet: Table<WalletKeyV8, u64>,
    wallet_keys: vector<WalletKeyV8>,
    output_count: u64,
    outputs: Table<ID, OutputRecordV8>,
    output_keys: vector<ID>,
    materialization_count: u64,
    materializations: Table<MaterializationKeyV8, vector<u8>>,
    materialization_keys: vector<MaterializationKeyV8>,
}

/// Canonical Soul identity registry is a distinct live object and TypeOrigin.
public struct SoulRegistryV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    output_registry_id: ID,
    soul_count: u64,
    souls: Table<ID, SoulRecordV8>,
    soul_keys: vector<ID>,
}

public struct BaseCompleteLineV8 has copy, drop, store {
    ordinal: u64,
    base_gross_atomic: u64,
    base_protocol_atomic: u64,
    maker_atomic: u64,
    fixed_protocol_atomic: u64,
    total_atomic: u64,
}

public struct PackPaymentLineV8 has copy, drop, store {
    release_id: ID,
    semantic_pack_id: String,
    release_content_commitment: vector<u8>,
    ordinal: u64,
    gross_atomic: u64,
    protocol_atomic: u64,
    pack_atomic: u64,
}

public struct DerivedPackBindingV8 has copy, drop, store {
    release_id: ID,
    semantic_pack_id: String,
    release_content_commitment: vector<u8>,
    pricing_commitment: vector<u8>,
}

public struct OutputRecordV8 has copy, drop, store {
    output_id: ID,
    receipt_id: ID,
    soul_id: ID,
    output_key: String,
    output_policy_commitment: vector<u8>,
    holder: address,
    recipe_commitment: vector<u8>,
    render_commitment: vector<u8>,
    output_commitment: vector<u8>,
    receipt_commitment: vector<u8>,
    protected: bool,
    seal_id: Option<vector<u8>>,
}

public struct SoulRecordV8 has copy, drop, store {
    soul_id: ID,
    output_id: ID,
    receipt_id: ID,
    holder: address,
    ownership_epoch: u64,
    soul_commitment: vector<u8>,
}

/// No abilities: counters and payments cannot persist unless finish consumes
/// the exact Runtime authorization and the Soul path consumes its successor.
public struct CompleteSessionV8 {
    output_registry_id: ID,
    soul_registry_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    output_key: String,
    holder: address,
    loadout_id: ID,
    loadout_revision: u64,
    loadout_commitment: vector<u8>,
    authorization: RuntimeLoadoutAuthorizationV8,
    base_line: BaseCompleteLineV8,
    pack_lines: vector<PackPaymentLineV8>,
    total_paid_atomic: u128,
}

/// Finished Complete artifacts are key-only. There is no generic transfer ABI.
public struct CompleteOutputV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    output_registry_id: ID,
    output_key: String,
    original_holder: address,
    holder: address,
    loadout_id: ID,
    loadout_revision: u64,
    loadout_commitment: vector<u8>,
    output_policy_commitment: vector<u8>,
    renderer_schema_commitment: vector<u8>,
    recipe_commitment: vector<u8>,
    render_commitment: vector<u8>,
    render_blob_id: String,
    render_sha256: vector<u8>,
    render_blob_commitment: vector<u8>,
    output_commitment: vector<u8>,
    protected: bool,
    scope_key: String,
    asset_key: String,
    seal_id: Option<vector<u8>>,
    protection_binding_commitment: vector<u8>,
}

public struct CompleteReceiptV8 has key {
    id: UID,
    version: u64,
    output_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    output_key: String,
    original_holder: address,
    holder: address,
    loadout_id: ID,
    loadout_revision: u64,
    loadout_commitment: vector<u8>,
    output_policy_commitment: vector<u8>,
    renderer_schema_commitment: vector<u8>,
    economics_commitment: vector<u8>,
    recipe_commitment: vector<u8>,
    render_commitment: vector<u8>,
    output_commitment: vector<u8>,
    base_line: BaseCompleteLineV8,
    pack_lines: vector<PackPaymentLineV8>,
    total_paid_atomic: u128,
    receipt_commitment: vector<u8>,
    protected: bool,
    seal_id: Option<vector<u8>>,
}

/// Exists only between Output finish and exact Release+Seal registration.
public struct ProtectedCompletePendingV8 {
    output: CompleteOutputV8,
    receipt: CompleteReceiptV8,
}

/// Same-PTB, one-use authorization. It owns both finished artifacts.
public struct SoulMintAuthorizationV8 {
    output: CompleteOutputV8,
    receipt: CompleteReceiptV8,
    authorization_commitment: vector<u8>,
}

/// Canonical Soul is key-only and has no ordinary holder-transfer function.
public struct CanonicalSoulV8 has key {
    id: UID,
    version: u64,
    soul_registry_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    output_key: String,
    output_policy_commitment: vector<u8>,
    holder: address,
    ownership_epoch: u64,
    output_id: ID,
    receipt_id: ID,
    recipe_commitment: vector<u8>,
    render_commitment: vector<u8>,
    output_commitment: vector<u8>,
    receipt_commitment: vector<u8>,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
    soul_commitment: vector<u8>,
}

/// Persisted listing data derived only from the three live bundle objects.
/// It is deliberately copyable data, never authority: every release hook also
/// requires the private Market call cap, the exact Listing UID, three live
/// `Receiving<T>` values, and the current registry records.
public struct SoulMarketCustodyBindingV8 has copy, drop, store {
    listing_id: ID,
    output_registry_id: ID,
    soul_registry_id: ID,
    market_registry_id: ID,
    market_treasury_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    output_id: ID,
    receipt_id: ID,
    soul_id: ID,
    output_commitment: vector<u8>,
    receipt_commitment: vector<u8>,
    soul_commitment: vector<u8>,
    seller: address,
    expected_soul_ownership_epoch: u64,
}

/// Same-PTB custody receipt. No copy/drop/store/key means Market must consume
/// it immediately into its listing after Output has transferred all three
/// key-without-store objects to that exact Listing UID address.
public struct SoulMarketCustodyTicketV8 {
    binding: SoulMarketCustodyBindingV8,
}

/// Same-PTB authorization for one exact current selection and one live
/// Complete receipt/Soul pair. It deliberately has no abilities.
public struct PhysicalMaterializationWitnessV8 {
    output_registry_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    holder: address,
    output_key: String,
    output_policy_commitment: vector<u8>,
    output_id: ID,
    receipt_id: ID,
    soul_id: ID,
    soul_ownership_epoch: u64,
    recipe_commitment: vector<u8>,
    render_commitment: vector<u8>,
    output_commitment: vector<u8>,
    receipt_commitment: vector<u8>,
    soul_commitment: vector<u8>,
    loadout_id: ID,
    loadout_revision: u64,
    loadout_commitment: vector<u8>,
    selection_index: u64,
    selection_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    source_class: u8,
    source_definition_id: ID,
    source_semantic_id: String,
    source_content_commitment: vector<u8>,
    source_epoch: u64,
    pricing_commitment: vector<u8>,
    asset_content_commitment: vector<u8>,
    materialization_key: String,
    witness_commitment: vector<u8>,
}

public struct PhysicalCompleteBindingV8 has copy, drop, store {
    output_registry_id: ID, root_id: ID, maker_version: u64,
    root_content_commitment: vector<u8>,
    holder: address, output_key: String, output_policy_commitment: vector<u8>,
    output_id: ID, receipt_id: ID, soul_id: ID, soul_ownership_epoch: u64,
    recipe_commitment: vector<u8>, render_commitment: vector<u8>,
    output_commitment: vector<u8>, receipt_commitment: vector<u8>,
    soul_commitment: vector<u8>,
}

public struct PhysicalSelectionBindingV8 has copy, drop, store {
    loadout_id: ID, loadout_revision: u64, loadout_commitment: vector<u8>,
    selection_index: u64, selection_commitment: vector<u8>, source_class: u8,
    part_key: String, item_key: String, style_key: String,
    layer_track_key: String,
    source_definition_id: ID, source_semantic_id: String,
    source_content_commitment: vector<u8>, source_epoch: u64,
    pricing_commitment: vector<u8>, asset_content_commitment: vector<u8>,
}

public struct OutputPolicyRowCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_id: ID, maker_version: u64,
    root_content_commitment: vector<u8>, renderer_commitment: vector<u8>,
    economics_commitment: vector<u8>, sequence: u64, output_key: String,
    protected_output: bool, complete_scope_key: String, allowed_pack_policy: u8,
    allowed_semantic_pack_ids: vector<String>, renderer_schema_commitment: vector<u8>,
}

public struct OutputRegistryEmptyCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_id: ID, maker_version: u64,
    root_content_commitment: vector<u8>, renderer_commitment: vector<u8>,
}

public struct OutputRegistryAdvanceCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_id: ID, maker_version: u64,
    root_content_commitment: vector<u8>, sequence: u64,
    prior_commitment: vector<u8>, row_commitment: vector<u8>,
}

public struct OutputReadinessCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_id: ID,
    output_registry_id: ID, soul_registry_id: ID,
    expected_output_count: u64, observed_output_count: u64,
    output_policy_commitment: vector<u8>,
}

public struct RecipeCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_id: ID, maker_version: u64,
    root_content_commitment: vector<u8>, renderer_commitment: vector<u8>,
    output_key: String, renderer_schema_commitment: vector<u8>,
    output_policy_commitment: vector<u8>, loadout_id: ID,
    loadout_revision: u64, loadout_commitment: vector<u8>, selection_count: u64,
    ordered_selection_commitments: vector<vector<u8>>,
    ordered_pricing_commitments: vector<vector<u8>>,
    used_packs: vector<UsedPackV8>,
}

public struct RenderCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, recipe_commitment: vector<u8>,
    renderer_commitment: vector<u8>, renderer_schema_commitment: vector<u8>,
    render_blob_id: String,
    render_sha256: vector<u8>, render_blob_commitment: vector<u8>,
    protected: bool, scope_key: String, asset_key: String,
}

public struct CompleteOutputCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_id: ID, maker_version: u64,
    root_content_commitment: vector<u8>, output_registry_id: ID,
    output_key: String, original_holder: address, loadout_id: ID,
    loadout_revision: u64,
    loadout_commitment: vector<u8>, output_policy_commitment: vector<u8>,
    recipe_commitment: vector<u8>, render_commitment: vector<u8>,
    protected: bool, scope_key: String, asset_key: String,
}

public struct CompleteReceiptCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_id: ID, maker_version: u64,
    root_content_commitment: vector<u8>, original_holder: address,
    output_key: String,
    loadout_id: ID, loadout_revision: u64, loadout_commitment: vector<u8>,
    output_policy_commitment: vector<u8>, renderer_schema_commitment: vector<u8>,
    economics_commitment: vector<u8>, recipe_commitment: vector<u8>,
    render_commitment: vector<u8>, output_commitment: vector<u8>,
    base_line: BaseCompleteLineV8, pack_lines: vector<PackPaymentLineV8>,
    total_paid_atomic: u128, protected: bool,
}

public struct ProtectionBindingCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, output_id: ID, receipt_id: ID,
    output_commitment: vector<u8>, receipt_commitment: vector<u8>,
    scope_key: String, asset_key: String, seal_id: vector<u8>,
}

public struct SoulAuthorizationCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, output_id: ID, receipt_id: ID,
    holder: address, output_commitment: vector<u8>,
    receipt_commitment: vector<u8>, protection_binding_commitment: vector<u8>,
}

public struct SoulCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, soul_registry_id: ID,
    root_id: ID, maker_version: u64, root_content_commitment: vector<u8>,
    output_key: String, output_policy_commitment: vector<u8>,
    holder: address, ownership_epoch: u64, output_id: ID, receipt_id: ID,
    recipe_commitment: vector<u8>, render_commitment: vector<u8>,
    output_commitment: vector<u8>, receipt_commitment: vector<u8>,
    soul_creator_royalty_bps: u16, maker_source_royalty_bps: u16,
}

public struct PhysicalWitnessCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, output_registry_id: ID,
    complete: PhysicalCompleteBindingV8,
    selection: PhysicalSelectionBindingV8,
    materialization_key: String,
}

public struct CanonicalSoulCreatedV8 has copy, drop {
    soul_id: ID, root_id: ID, output_id: ID, receipt_id: ID,
    holder: address, soul_commitment: vector<u8>,
}

public fun version_v8(): u64 { VERSION }
public fun allowed_all_admitted_v8(): u8 { POLICY_ALL_ADMITTED }
public fun allowed_allowlist_v8(): u8 { POLICY_ALLOWLIST }

public fun new_output_package_config_v8(
    catalog: &ProductReleaseCatalogV8,
    output_call_cap: PackageCallCapV8<OutputRoleV8>,
    ctx: &mut TxContext,
): OutputPackageConfigV8 {
    binding::assert_output_call_cap_v8(catalog, &output_call_cap);
    binding::assert_type_origins_v8<OutputOriginalMarkerV8, OutputCallableMarkerV8>(
        binding::output_binding_v8(binding::catalog_binding_v8(catalog)));
    OutputPackageConfigV8 {
        id: object::new(ctx), version: VERSION,
        catalog_id: binding::catalog_id_v8(catalog),
        product_binding_commitment:
            *binding::product_binding_commitment_v8(binding::catalog_binding_v8(catalog)),
        output_call_cap,
    }
}

public fun share_output_package_config_v8(config: OutputPackageConfigV8) {
    transfer::share_object(config)
}

public fun new_output_registries_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    expected_output_count: u64,
    expected_policy_commitment: vector<u8>,
    ctx: &mut TxContext,
): (OutputRegistryV8, SoulRegistryV8) {
    maker::assert_draft_admin_v8(root, admin);
    assert!(expected_output_count <= MAX_OUTPUT_POLICY_COUNT, EInvalidConfig);
    assert_hash(&expected_policy_commitment);
    let root_id = maker::root_id_v8(root);
    let maker_version = maker::root_maker_version_v8(root);
    let root_content_commitment = *maker::root_content_commitment_v8(root);
    let renderer_commitment = *maker::root_renderer_commitment_v8(root);
    let rolling_policy_commitment = empty_output_registry_commitment_v8(root);
    if (expected_output_count == 0) {
        assert!(expected_policy_commitment == rolling_policy_commitment,
            EInvalidCommitment);
    };
    let output_uid = object::new(ctx);
    let output_registry_id = output_uid.to_inner();
    let soul_uid = object::new(ctx);
    let soul_registry_id = soul_uid.to_inner();
    let output = OutputRegistryV8 {
        id: output_uid, version: VERSION, root_id, maker_version,
        root_content_commitment, renderer_commitment, soul_registry_id,
        expected_output_count, observed_output_count: 0,
        expected_policy_commitment, rolling_policy_commitment, sealed: false,
        policy_rows: table::new(ctx), policy_keys: vector[],
        total_complete_count: 0,
        complete_by_wallet: table::new(ctx), wallet_keys: vector[],
        output_count: 0, outputs: table::new(ctx), output_keys: vector[],
        materialization_count: 0, materializations: table::new(ctx),
        materialization_keys: vector[],
    };
    let souls = SoulRegistryV8 {
        id: soul_uid, version: VERSION, root_id, maker_version,
        root_content_commitment, output_registry_id, soul_count: 0,
        souls: table::new(ctx), soul_keys: vector[],
    };
    (output, souls)
}

public fun empty_output_registry_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&OutputRegistryEmptyCommitmentInputV8 {
        domain: b"animacraft-v8/output/registry-empty", version: VERSION,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        renderer_commitment: *maker::root_renderer_commitment_v8(root),
    }))
}

public fun derive_output_policy_row_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    sequence: u64,
    output_key: String,
    protected_output: bool,
    complete_scope_key: String,
    renderer_schema_commitment: vector<u8>,
    allowed_pack_policy: u8,
    allowed_semantic_pack_ids: vector<String>,
): vector<u8> {
    assert_semantic_key(&output_key);
    assert_scope_policy(protected_output, &complete_scope_key);
    assert_hash(&renderer_schema_commitment);
    validate_allowed_pack_policy(allowed_pack_policy, &allowed_semantic_pack_ids);
    let economics = maker::root_economics_v8(root);
    hash::sha2_256(bcs::to_bytes(&OutputPolicyRowCommitmentInputV8 {
        domain: b"animacraft-v8/output/policy-row", version: VERSION,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        renderer_commitment: *maker::root_renderer_commitment_v8(root),
        economics_commitment: *maker::economics_commitment_v8(&economics),
        sequence, output_key, protected_output, complete_scope_key,
        allowed_pack_policy, allowed_semantic_pack_ids,
        renderer_schema_commitment,
    }))
}

public fun advance_output_registry_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    sequence: u64,
    prior_commitment: vector<u8>,
    row_commitment: vector<u8>,
): vector<u8> {
    assert_hash(&prior_commitment);
    assert_hash(&row_commitment);
    hash::sha2_256(bcs::to_bytes(&OutputRegistryAdvanceCommitmentInputV8 {
        domain: b"animacraft-v8/output/registry-row", version: VERSION,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        sequence, prior_commitment, row_commitment,
    }))
}

public fun append_output_policy_v8<PaymentCoin>(
    registry: &mut OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    output_key: String,
    protected_output: bool,
    complete_scope_key: String,
    renderer_schema_commitment: vector<u8>,
    allowed_pack_policy: u8,
    allowed_semantic_pack_ids: vector<String>,
    row_commitment: vector<u8>,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_identity(registry, root);
    let expected_row = derive_output_policy_row_commitment_v8(
        root, sequence, output_key, protected_output, complete_scope_key,
        renderer_schema_commitment, allowed_pack_policy,
        allowed_semantic_pack_ids);
    assert_row_commitment(&row_commitment, &expected_row);
    let next = advance_output_registry_commitment_v8(
        root, sequence, registry.rolling_policy_commitment, row_commitment);
    append_policy_row(
        registry, sequence, output_key, protected_output, complete_scope_key,
        renderer_schema_commitment, allowed_pack_policy,
        allowed_semantic_pack_ids, row_commitment, next);
}

public fun seal_output_registry_v8<PaymentCoin>(
    registry: &mut OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_identity(registry, root);
    seal_policy_rows(registry)
}

public fun share_output_registries_v8(
    output: OutputRegistryV8,
    souls: SoulRegistryV8,
) {
    assert!(output.soul_registry_id == object::id(&souls), EInvalidBinding);
    assert!(souls.output_registry_id == object::id(&output), EInvalidBinding);
    transfer::share_object(output);
    transfer::share_object(souls);
}

public fun certify_output_activation_readiness_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &OutputPackageConfigV8,
    output: &OutputRegistryV8,
    souls: &SoulRegistryV8,
): OutputReadinessV8 {
    assert_config(catalog, config);
    assert_registry_pair(root, output, souls);
    maker::assert_draft_v8(root);
    assert_registry_ready(output, souls);
    let companion_commitment = hash::sha2_256(bcs::to_bytes(
        &OutputReadinessCommitmentInputV8 {
            domain: b"animacraft-v8/output/readiness", version: VERSION,
            root_id: output.root_id, output_registry_id: object::id(output),
            soul_registry_id: object::id(souls),
            expected_output_count: output.expected_output_count,
            observed_output_count: output.observed_output_count,
            output_policy_commitment: output.rolling_policy_commitment,
        }));
    activation::certify_output_readiness_v8<
        PaymentCoin,
        OutputOriginalMarkerV8,
        OutputCallableMarkerV8,
        OutputRegistryV8,
        SoulRegistryV8,
    >(root, catalog, &config.output_call_cap, output, souls, companion_commitment)
}

public fun quote_base_complete_v8<PaymentCoin>(
    output: &OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    output_key: String,
    holder: address,
): BaseCompleteLineV8 {
    assert!(holder != @0x0, EWrongHolder);
    assert_registry_root(output, root);
    assert!(output.sealed, ERegistryNotSealed);
    let _ = borrow_policy(output, output_key);
    let economics = maker::root_economics_v8(root);
    let key = WalletKeyV8 { holder };
    let ordinal = if (output.complete_by_wallet.contains(key)) {
        *output.complete_by_wallet.borrow(key)
    } else { 0 };
    assert_total_cap(output.total_complete_count,
        maker::economics_complete_total_cap_v8(&economics));
    let base_gross_atomic = complete_price_for_ordinal(
        maker::economics_complete_mode_v8(&economics),
        maker::economics_complete_price_atomic_v8(&economics),
        maker::economics_complete_free_quota_per_wallet_v8(&economics),
        ordinal,
    );
    let base_protocol_atomic = protocol_share(
        base_gross_atomic,
        maker::economics_primary_content_fee_bps_v8(&economics),
    );
    let maker_atomic = base_gross_atomic - base_protocol_atomic;
    let fixed_protocol_atomic = maker::economics_fixed_complete_fee_atomic_v8(&economics);
    BaseCompleteLineV8 {
        ordinal, base_gross_atomic, base_protocol_atomic, maker_atomic,
        fixed_protocol_atomic,
        total_atomic: base_gross_atomic + fixed_protocol_atomic,
    }
}

/// Mutates the Output-owned base counter and settles base plus the distinct
/// fixed Complete fee. The no-ability session forces exact Runtime finish.
public fun begin_complete_v8<PaymentCoin>(
    output: &mut OutputRegistryV8,
    output_key: String,
    root: &MakerRootV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    maker_treasury: &mut MakerTreasuryV8<PaymentCoin>,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    authorization: RuntimeLoadoutAuthorizationV8,
    loadout: &MakerLoadoutV8,
    ctx: &mut TxContext,
): CompleteSessionV8 {
    assert_active_output_registry(output, root);
    let holder = ctx.sender();
    let base_line = quote_base_complete_v8(output, root, output_key, holder);
    mutate_base_counter(output, holder, base_line.ordinal);
    settle_base_payment(
        root, config, maker_treasury, protocol_treasury, payment, base_line, ctx);
    CompleteSessionV8 {
        output_registry_id: object::id(output),
        soul_registry_id: output.soul_registry_id,
        root_id: output.root_id,
        maker_version: output.maker_version,
        root_content_commitment: output.root_content_commitment,
        output_key,
        holder,
        loadout_id: runtime::loadout_id_v8(loadout),
        loadout_revision: runtime::loadout_revision_v8(loadout),
        loadout_commitment: *runtime::loadout_commitment_v8(loadout),
        authorization,
        base_line,
        pack_lines: vector[],
        total_paid_atomic: base_line.total_atomic as u128,
    }
}

/// Fresh Core request is created and consumed before Runtime mutates the Pack
/// Complete counter. Runtime then atomically settles the exact paid line.
public fun append_paid_pack_complete_v8<PaymentCoin>(
    session: &mut CompleteSessionV8,
    output_config: &OutputPackageConfigV8,
    output: &OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    runtime_config: &RuntimePackageConfigV8,
    release: &mut PackReleaseV8<PaymentCoin>,
    packs: &PackRegistryV8,
    pass: &PackPassV8,
    loadout: &MakerLoadoutV8,
    pack_treasury: &mut PackTreasuryV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    ctx: &mut TxContext,
) {
    assert_session_live(session, output, root, loadout, ctx);
    assert_config(catalog, output_config);
    let gross_atomic = coin::value(&payment);
    assert!(gross_atomic > 0, EWrongPayment);
    let request = activation::new_output_runtime_request_v8<
        PaymentCoin, OutputOriginalMarkerV8, OutputCallableMarkerV8,
        OutputRegistryV8,
    >(root, catalog, &output_config.output_call_cap, output, ctx);
    let line = runtime_binding::authorize_pack_complete_from_output_v8(
        request, root, catalog, runtime_config, output, release, packs, pass,
        &session.authorization, loadout, ctx);
    let (release_id, ordinal) = runtime::settle_paid_pack_complete_line_v8(
        line, release, pack_treasury, root, protocol_config,
        protocol_treasury, payment, ctx);
    append_pack_payment_line(session, release, release_id, ordinal, gross_atomic, root);
}

public fun append_free_pack_complete_v8<PaymentCoin>(
    session: &mut CompleteSessionV8,
    output_config: &OutputPackageConfigV8,
    output: &OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    runtime_config: &RuntimePackageConfigV8,
    release: &mut PackReleaseV8<PaymentCoin>,
    packs: &PackRegistryV8,
    pass: &PackPassV8,
    loadout: &MakerLoadoutV8,
    ctx: &mut TxContext,
) {
    assert_session_live(session, output, root, loadout, ctx);
    assert_config(catalog, output_config);
    let request = activation::new_output_runtime_request_v8<
        PaymentCoin, OutputOriginalMarkerV8, OutputCallableMarkerV8,
        OutputRegistryV8,
    >(root, catalog, &output_config.output_call_cap, output, ctx);
    let line = runtime_binding::authorize_pack_complete_from_output_v8(
        request, root, catalog, runtime_config, output, release, packs, pass,
        &session.authorization, loadout, ctx);
    let (release_id, ordinal) = runtime::consume_free_pack_complete_line_v8(
        line, release, root, ctx);
    append_pack_payment_line(session, release, release_id, ordinal, 0, root);
}

/// A Release-owned no-ability witness certifies unprotected render transport.
/// Output returns it unchanged so only Release can consume its private value.
public fun finish_unprotected_complete_v8<
    PaymentCoin,
    ReleaseOriginalMarker,
    ReleaseRenderWitness,
>(
    witness: ReleaseRenderWitness,
    session: CompleteSessionV8,
    output: &OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    loadout: &MakerLoadoutV8,
    render_blob_id: String,
    render_sha256: vector<u8>,
    render_blob_commitment: vector<u8>,
    ctx: &mut TxContext,
): (ReleaseRenderWitness, SoulMintAuthorizationV8) {
    binding::assert_type_origins_v8<ReleaseOriginalMarker, ReleaseRenderWitness>(
        binding::release_binding_v8(binding::catalog_binding_v8(catalog)));
    assert!(binding::catalog_id_v8(catalog)
        == maker::root_product_release_catalog_id_v8(root), EInvalidBinding);
    assert!(!borrow_policy(output, session.output_key).protected_output,
        EInvalidPolicy);
    let (mut complete_output, receipt) = finish_complete(
        session, output, root, loadout, render_blob_id, render_sha256,
        render_blob_commitment, false, string::utf8(vector[]),
        string::utf8(vector[]), ctx);
    complete_output.protection_binding_commitment = vector[];
    let authorization_commitment = derive_soul_authorization_commitment(
        &complete_output, &receipt);
    (witness, SoulMintAuthorizationV8 {
        output: complete_output, receipt, authorization_commitment,
    })
}

public fun finish_protected_complete_v8<PaymentCoin>(
    session: CompleteSessionV8,
    output: &OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    loadout: &MakerLoadoutV8,
    ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>,
    ciphertext_blob_commitment: vector<u8>,
    scope_key: String,
    asset_key: String,
    ctx: &mut TxContext,
): ProtectedCompletePendingV8 {
    let policy = borrow_policy(output, session.output_key);
    assert!(policy.protected_output, EInvalidPolicy);
    assert!(scope_key == policy.complete_scope_key, EInvalidPolicy);
    let (complete_output, receipt) = finish_complete(
        session, output, root, loadout, ciphertext_blob_id,
        ciphertext_sha256, ciphertext_blob_commitment, true,
        scope_key, asset_key, ctx);
    ProtectedCompletePendingV8 { output: complete_output, receipt }
}

/// Seal returns only fields taken from its consumed proof. Every field is
/// exact-matched to the private pending objects before authorization exists.
public fun finalize_protected_complete_v8<PaymentCoin>(
    pending: ProtectedCompletePendingV8,
    id: vector<u8>,
    seal_registry: &SealRegistryV8,
    seal_policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>,
    proof: CompleteDecryptProofV8,
    ctx: &TxContext,
): SoulMintAuthorizationV8 {
    let ProtectedCompletePendingV8 { mut output, mut receipt } = pending;
    assert_exact_holder(output.holder, ctx.sender());
    assert_exact_holder(receipt.holder, ctx.sender());
    assert_complete_root(&output, root);
    let (receipt_id, output_id, recipe_commitment, render_commitment,
        output_commitment, receipt_commitment, scope_key, asset_key, seal_id) =
        seal::consume_complete_decrypt_proof_v8(
            id, seal_registry, seal_policy, root, proof, ctx);
    assert_protected_proof_fields(
        &output, &receipt, receipt_id, output_id, &recipe_commitment,
        &render_commitment, &output_commitment, &receipt_commitment,
        &scope_key, &asset_key, &seal_id);
    assert!(seal_id == id, EInvalidProof);
    let protection_binding_commitment = hash::sha2_256(bcs::to_bytes(
        &ProtectionBindingCommitmentInputV8 {
            domain: b"animacraft-v8/output/protection", version: VERSION,
            output_id, receipt_id, output_commitment, receipt_commitment,
            scope_key, asset_key, seal_id,
        }));
    output.seal_id = option::some(seal_id);
    output.protection_binding_commitment = protection_binding_commitment;
    receipt.seal_id = option::some(seal_id);
    let authorization_commitment = derive_soul_authorization_commitment(
        &output, &receipt);
    SoulMintAuthorizationV8 { output, receipt, authorization_commitment }
}

/// Sole consumer of SoulMintAuthorizationV8. It creates and internally
/// transfers key-only artifacts to the exact transaction holder.
public fun mint_canonical_soul_v8<PaymentCoin>(
    authorization: SoulMintAuthorizationV8,
    output_registry: &mut OutputRegistryV8,
    soul_registry: &mut SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    ctx: &mut TxContext,
) {
    assert_active_registry_pair(output_registry, soul_registry, root);
    let SoulMintAuthorizationV8 {
        output, receipt, authorization_commitment,
    } = authorization;
    assert_exact_holder(output.holder, ctx.sender());
    assert_exact_holder(receipt.holder, ctx.sender());
    assert_complete_root(&output, root);
    assert!(receipt.output_id == object::id(&output), EInvalidBinding);
    assert!(receipt.output_key == output.output_key, EInvalidBinding);
    assert!(receipt.loadout_id == output.loadout_id
        && receipt.loadout_revision == output.loadout_revision
        && receipt.loadout_commitment == output.loadout_commitment,
        EInvalidBinding);
    assert!(receipt.output_policy_commitment == output.output_policy_commitment
        && receipt.renderer_schema_commitment == output.renderer_schema_commitment,
        EInvalidBinding);
    assert!(authorization_commitment
        == derive_soul_authorization_commitment(&output, &receipt), EInvalidProof);
    if (output.protected) {
        assert!(output.seal_id.is_some() && receipt.seal_id.is_some(), EInvalidProof);
        assert!(!output.protection_binding_commitment.is_empty(), EInvalidProof);
        assert!(output.seal_id == receipt.seal_id, EInvalidProof);
    } else {
        assert!(output.seal_id.is_none() && receipt.seal_id.is_none(), EInvalidProof);
        assert!(output.protection_binding_commitment.is_empty(), EInvalidProof);
    };
    let rights = maker::root_rights_v8(root);
    let soul_uid = object::new(ctx);
    let soul_id = soul_uid.to_inner();
    let soul_creator_royalty_bps = maker::rights_soul_creator_royalty_bps_v8(&rights);
    let maker_source_royalty_bps = maker::rights_maker_source_royalty_bps_v8(&rights);
    let soul_commitment = hash::sha2_256(bcs::to_bytes(&SoulCommitmentInputV8 {
        domain: b"animacraft-v8/output/canonical-soul", version: VERSION,
        soul_registry_id: object::id(soul_registry), root_id: output.root_id,
        maker_version: output.maker_version,
        root_content_commitment: output.root_content_commitment,
        output_key: output.output_key,
        output_policy_commitment: output.output_policy_commitment,
        holder: output.holder, ownership_epoch: 0,
        output_id: object::id(&output), receipt_id: object::id(&receipt),
        recipe_commitment: output.recipe_commitment,
        render_commitment: output.render_commitment,
        output_commitment: output.output_commitment,
        receipt_commitment: receipt.receipt_commitment,
        soul_creator_royalty_bps, maker_source_royalty_bps,
    }));
    let soul = CanonicalSoulV8 {
        id: soul_uid, version: VERSION,
        soul_registry_id: object::id(soul_registry), root_id: output.root_id,
        maker_version: output.maker_version,
        root_content_commitment: output.root_content_commitment,
        output_key: output.output_key,
        output_policy_commitment: output.output_policy_commitment,
        holder: output.holder, ownership_epoch: 0,
        output_id: object::id(&output), receipt_id: object::id(&receipt),
        recipe_commitment: output.recipe_commitment,
        render_commitment: output.render_commitment,
        output_commitment: output.output_commitment,
        receipt_commitment: receipt.receipt_commitment,
        soul_creator_royalty_bps, maker_source_royalty_bps, soul_commitment,
    };
    record_finished_output(output_registry, &output, &receipt, soul_id);
    record_soul(soul_registry, &soul);
    event::emit(CanonicalSoulCreatedV8 {
        soul_id, root_id: output.root_id, output_id: object::id(&output),
        receipt_id: object::id(&receipt), holder: output.holder, soul_commitment,
    });
    let holder = output.holder;
    transfer::transfer(output, holder);
    transfer::transfer(receipt, holder);
    transfer::transfer(soul, holder);
}

/// Atomically moves the exact Complete Output/Receipt/Canonical Soul bundle
/// under one Market Listing UID. Logical holder, Soul epoch, and every
/// commitment remain unchanged while the objects are in custody.
public fun custody_soul_bundle_for_market_v8<
    PaymentCoin,
    MarketOriginalMarker,
    MarketCallableMarker,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    output: CompleteOutputV8,
    receipt: CompleteReceiptV8,
    soul: CanonicalSoulV8,
    listing: &mut UID,
    output_registry: &OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
    ctx: &TxContext,
): SoulMarketCustodyTicketV8 {
    assert_active_soul_market_boundary<
        PaymentCoin,
        MarketOriginalMarker,
        MarketCallableMarker,
        MarketRegistry,
        MarketTreasury,
    >(
        output_registry, soul_registry, root, protocol_config, catalog,
        market_registry, market_treasury, market_call_cap,
    );
    let seller = ctx.sender();
    assert_live_soul_bundle(
        &output, &receipt, &soul, output_registry, soul_registry, root,
        seller, soul.ownership_epoch,
    );
    let custody = SoulMarketCustodyBindingV8 {
        listing_id: listing.to_inner(),
        output_registry_id: object::id(output_registry),
        soul_registry_id: object::id(soul_registry),
        market_registry_id: object::id(market_registry),
        market_treasury_id: object::id(market_treasury),
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        output_id: object::id(&output),
        receipt_id: object::id(&receipt),
        soul_id: object::id(&soul),
        output_commitment: output.output_commitment,
        receipt_commitment: receipt.receipt_commitment,
        soul_commitment: soul.soul_commitment,
        seller,
        expected_soul_ownership_epoch: soul.ownership_epoch,
    };
    let listing_address = listing.to_address();
    transfer::transfer(output, listing_address);
    transfer::transfer(receipt, listing_address);
    transfer::transfer(soul, listing_address);
    SoulMarketCustodyTicketV8 { binding: custody }
}

/// Market consumes the same-PTB ticket into persistable listing data. The
/// returned binding is not authority and is safe to retain as a tombstone.
public fun consume_soul_market_custody_ticket_v8<
    PaymentCoin,
    MarketOriginalMarker,
    MarketCallableMarker,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    ticket: SoulMarketCustodyTicketV8,
    listing: &UID,
    output_registry: &OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
): SoulMarketCustodyBindingV8 {
    assert_soul_market_boundary<
        PaymentCoin,
        MarketOriginalMarker,
        MarketCallableMarker,
        MarketRegistry,
        MarketTreasury,
    >(
        output_registry, soul_registry, root, catalog, market_registry,
        market_treasury, market_call_cap,
    );
    assert_soul_market_custody_header(
        &ticket.binding, listing, output_registry, soul_registry, root,
        market_registry, market_treasury,
    );
    let SoulMarketCustodyTicketV8 { binding } = ticket;
    binding
}

/// Cancel/recover escape hatch. It deliberately performs no ACTIVE or current
/// protocol-config assertion, so a PAUSED/ARCHIVED Root or disabled/drifted
/// protocol cannot strand custody. The stored seller comes from Output-minted
/// custody data and must still equal all three logical holders.
public fun return_soul_bundle_from_market_v8<
    PaymentCoin,
    MarketOriginalMarker,
    MarketCallableMarker,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    output_receiving: Receiving<CompleteOutputV8>,
    receipt_receiving: Receiving<CompleteReceiptV8>,
    soul_receiving: Receiving<CanonicalSoulV8>,
    listing: &mut UID,
    custody: &SoulMarketCustodyBindingV8,
    output_registry: &OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
) {
    assert_soul_market_boundary<
        PaymentCoin,
        MarketOriginalMarker,
        MarketCallableMarker,
        MarketRegistry,
        MarketTreasury,
    >(
        output_registry, soul_registry, root, catalog, market_registry,
        market_treasury, market_call_cap,
    );
    assert_soul_market_custody_header(
        custody, listing, output_registry, soul_registry, root,
        market_registry, market_treasury,
    );
    let (output, receipt, soul) = receive_soul_market_bundle(
        listing, custody, output_receiving, receipt_receiving, soul_receiving,
    );
    assert_live_soul_bundle(
        &output, &receipt, &soul, output_registry, soul_registry, root,
        custody.seller, custody.expected_soul_ownership_epoch,
    );
    assert_soul_market_custody_bundle(custody, &output, &receipt, &soul);
    transfer::transfer(output, custody.seller);
    transfer::transfer(receipt, custody.seller);
    transfer::transfer(soul, custody.seller);
}

/// Successful sale is the sole ownership mutation path. All three objects are
/// received and checked before one atomic holder/registry update. Output and
/// Receipt content commitments and the protection binding remain immutable;
/// only Soul's ownership commitment changes at epoch N+1.
public fun purchase_soul_bundle_from_market_v8<
    PaymentCoin,
    MarketOriginalMarker,
    MarketCallableMarker,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    output_receiving: Receiving<CompleteOutputV8>,
    receipt_receiving: Receiving<CompleteReceiptV8>,
    soul_receiving: Receiving<CanonicalSoulV8>,
    listing: &mut UID,
    custody: &SoulMarketCustodyBindingV8,
    output_registry: &mut OutputRegistryV8,
    soul_registry: &mut SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
    buyer: address,
) {
    assert_active_soul_market_boundary<
        PaymentCoin,
        MarketOriginalMarker,
        MarketCallableMarker,
        MarketRegistry,
        MarketTreasury,
    >(
        output_registry, soul_registry, root, protocol_config, catalog,
        market_registry, market_treasury, market_call_cap,
    );
    assert_soul_market_custody_header(
        custody, listing, output_registry, soul_registry, root,
        market_registry, market_treasury,
    );
    purchase_received_soul_bundle(
        output_receiving, receipt_receiving, soul_receiving, listing, custody,
        output_registry, soul_registry, root, buyer,
    );
}

fun purchase_received_soul_bundle<PaymentCoin>(
    output_receiving: Receiving<CompleteOutputV8>,
    receipt_receiving: Receiving<CompleteReceiptV8>,
    soul_receiving: Receiving<CanonicalSoulV8>,
    listing: &mut UID,
    custody: &SoulMarketCustodyBindingV8,
    output_registry: &mut OutputRegistryV8,
    soul_registry: &mut SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    buyer: address,
) {
    assert!(buyer != @0x0 && buyer != custody.seller, ESelfPurchase);
    let (mut output, mut receipt, mut soul) = receive_soul_market_bundle(
        listing, custody, output_receiving, receipt_receiving, soul_receiving,
    );
    assert_live_soul_bundle(
        &output, &receipt, &soul, output_registry, soul_registry, root,
        custody.seller, custody.expected_soul_ownership_epoch,
    );
    assert_soul_market_custody_bundle(custody, &output, &receipt, &soul);
    let next_epoch = custody.expected_soul_ownership_epoch + 1;
    output.holder = buyer;
    receipt.holder = buyer;
    soul.holder = buyer;
    soul.ownership_epoch = next_epoch;
    soul.soul_commitment = derive_current_soul_commitment(&soul);
    let output_record = output_registry.outputs.borrow_mut(custody.output_id);
    output_record.holder = buyer;
    let soul_record = soul_registry.souls.borrow_mut(custody.soul_id);
    soul_record.holder = buyer;
    soul_record.ownership_epoch = next_epoch;
    soul_record.soul_commitment = soul.soul_commitment;
    transfer::transfer(output, buyer);
    transfer::transfer(receipt, buyer);
    transfer::transfer(soul, buyer);
}

/// Reserves a unique Soul-scoped materialization key and consumes Runtime's
/// exact current-selection witness. The no-ability result must be consumed in
/// this PTB by the exact Physical package.
public fun new_physical_materialization_witness_v8<PaymentCoin>(
    output_registry: &mut OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    receipt: &CompleteReceiptV8,
    soul: &CanonicalSoulV8,
    root: &MakerRootV8<PaymentCoin>,
    loadout: &MakerLoadoutV8,
    selection_witness: RuntimePhysicalSelectionWitnessV8,
    materialization_key: String,
    ctx: &TxContext,
): PhysicalMaterializationWitnessV8 {
    assert_active_registry_pair(output_registry, soul_registry, root);
    assert_semantic_key(&materialization_key);
    let holder = ctx.sender();
    assert_exact_holder(receipt.holder, holder);
    assert_exact_holder(soul.holder, holder);
    assert!(receipt.root_id == maker::root_id_v8(root)
        && soul.root_id == maker::root_id_v8(root), EInvalidBinding);
    assert!(receipt.maker_version == maker::root_maker_version_v8(root)
        && soul.maker_version == maker::root_maker_version_v8(root),
        EInvalidBinding);
    assert!(&receipt.root_content_commitment
        == maker::root_content_commitment_v8(root), EInvalidBinding);
    assert!(receipt.root_content_commitment == soul.root_content_commitment,
        EInvalidBinding);
    assert!(soul.soul_registry_id == object::id(soul_registry), EInvalidBinding);
    let receipt_id = object::id(receipt);
    let soul_id = object::id(soul);
    assert!(soul.receipt_id == receipt_id && soul.output_id == receipt.output_id,
        EInvalidBinding);
    assert!(soul.output_key == receipt.output_key
        && soul.output_policy_commitment == receipt.output_policy_commitment,
        EInvalidBinding);
    assert!(soul.recipe_commitment == receipt.recipe_commitment
        && soul.render_commitment == receipt.render_commitment
        && soul.output_commitment == receipt.output_commitment
        && soul.receipt_commitment == receipt.receipt_commitment,
        EInvalidBinding);
    let policy = borrow_policy(output_registry, receipt.output_key);
    assert!(policy.row_commitment == receipt.output_policy_commitment,
        EInvalidBinding);
    let output_record = output_registry.outputs.borrow(receipt.output_id);
    assert!(output_record.receipt_id == receipt_id
        && output_record.soul_id == soul_id
        && output_record.holder == holder
        && output_record.output_key == receipt.output_key
        && output_record.output_policy_commitment == receipt.output_policy_commitment
        && output_record.recipe_commitment == receipt.recipe_commitment
        && output_record.render_commitment == receipt.render_commitment
        && output_record.output_commitment == receipt.output_commitment
        && output_record.receipt_commitment == receipt.receipt_commitment,
        EInvalidBinding);
    let soul_record = soul_registry.souls.borrow(soul_id);
    assert!(soul_record.output_id == receipt.output_id
        && soul_record.receipt_id == receipt_id
        && soul_record.holder == holder
        && soul_record.ownership_epoch == soul.ownership_epoch
        && soul_record.soul_commitment == soul.soul_commitment,
        EInvalidBinding);
    let (loadout_id, selection_root_id, selection_root_version,
        selection_root_content, selection_holder, loadout_revision,
        loadout_commitment, selection_index, selection_commitment,
        part_key, item_key, style_key, layer_track_key,
        source_class, source_definition_id, source_semantic_id,
        source_content_commitment, source_epoch, pricing_commitment,
        asset_content_commitment) = runtime::consume_physical_selection_witness_v8(
            selection_witness, loadout, ctx);
    assert!(selection_root_id == receipt.root_id
        && selection_root_version == receipt.maker_version
        && selection_root_content == receipt.root_content_commitment,
        EInvalidProof);
    assert!(selection_holder == holder, EWrongHolder);
    assert!(loadout_id == receipt.loadout_id
        && loadout_revision == receipt.loadout_revision
        && loadout_commitment == receipt.loadout_commitment,
        EInvalidProof);
    let complete = PhysicalCompleteBindingV8 {
        output_registry_id: object::id(output_registry),
        root_id: receipt.root_id, maker_version: receipt.maker_version,
        root_content_commitment: receipt.root_content_commitment, holder,
        output_key: receipt.output_key,
        output_policy_commitment: receipt.output_policy_commitment,
        output_id: receipt.output_id, receipt_id, soul_id,
        soul_ownership_epoch: soul.ownership_epoch,
        recipe_commitment: receipt.recipe_commitment,
        render_commitment: receipt.render_commitment,
        output_commitment: receipt.output_commitment,
        receipt_commitment: receipt.receipt_commitment,
        soul_commitment: soul.soul_commitment,
    };
    let selection = PhysicalSelectionBindingV8 {
        loadout_id, loadout_revision, loadout_commitment, selection_index,
        selection_commitment, part_key, item_key, style_key, layer_track_key,
        source_class, source_definition_id,
        source_semantic_id, source_content_commitment, source_epoch,
        pricing_commitment, asset_content_commitment,
    };
    let witness_commitment = derive_physical_witness_commitment(
        object::id(output_registry), complete, selection, materialization_key);
    let key = MaterializationKeyV8 { soul_id, materialization_key };
    reserve_materialization(output_registry, key, witness_commitment);
    PhysicalMaterializationWitnessV8 {
        output_registry_id: object::id(output_registry),
        root_id: complete.root_id, maker_version: complete.maker_version,
        root_content_commitment: complete.root_content_commitment,
        holder, output_key: complete.output_key,
        output_policy_commitment: complete.output_policy_commitment,
        output_id: complete.output_id, receipt_id, soul_id,
        soul_ownership_epoch: complete.soul_ownership_epoch,
        recipe_commitment: complete.recipe_commitment,
        render_commitment: complete.render_commitment,
        output_commitment: complete.output_commitment,
        receipt_commitment: complete.receipt_commitment,
        soul_commitment: complete.soul_commitment,
        loadout_id, loadout_revision, loadout_commitment, selection_index,
        selection_commitment, part_key, item_key, style_key, layer_track_key,
        source_class, source_definition_id,
        source_semantic_id: selection.source_semantic_id,
        source_content_commitment, source_epoch, pricing_commitment,
        asset_content_commitment, materialization_key,
        witness_commitment,
    }
}

/// Only the exact Physical package, borrowing its Core-issued call cap, can
/// consume the materialization witness.
public fun consume_physical_materialization_witness_v8<
    PhysicalOriginalMarker,
    PhysicalCallableMarker,
>(
    witness: PhysicalMaterializationWitnessV8,
    catalog: &ProductReleaseCatalogV8,
    physical_call_cap: &PackageCallCapV8<PhysicalRoleV8>,
): (PhysicalCompleteBindingV8, PhysicalSelectionBindingV8, String, vector<u8>) {
    binding::assert_physical_call_cap_v8(catalog, physical_call_cap);
    binding::assert_type_origins_v8<PhysicalOriginalMarker, PhysicalCallableMarker>(
        binding::physical_binding_v8(binding::catalog_binding_v8(catalog)));
    let PhysicalMaterializationWitnessV8 {
        output_registry_id, root_id, maker_version, root_content_commitment,
        holder, output_key, output_policy_commitment, output_id, receipt_id,
        soul_id, soul_ownership_epoch, recipe_commitment, render_commitment,
        output_commitment, receipt_commitment, soul_commitment, loadout_id,
        loadout_revision, loadout_commitment, selection_index,
        selection_commitment, part_key, item_key, style_key, layer_track_key,
        source_class, source_definition_id,
        source_semantic_id, source_content_commitment, source_epoch,
        pricing_commitment, asset_content_commitment, materialization_key,
        witness_commitment,
    } = witness;
    let complete = PhysicalCompleteBindingV8 {
        output_registry_id, root_id, maker_version, root_content_commitment,
        holder, output_key, output_policy_commitment, output_id, receipt_id,
        soul_id, soul_ownership_epoch, recipe_commitment, render_commitment,
        output_commitment, receipt_commitment, soul_commitment,
    };
    let selection = PhysicalSelectionBindingV8 {
        loadout_id, loadout_revision, loadout_commitment, selection_index,
        selection_commitment, part_key, item_key, style_key, layer_track_key,
        source_class, source_definition_id,
        source_semantic_id, source_content_commitment, source_epoch,
        pricing_commitment, asset_content_commitment,
    };
    let expected = derive_physical_witness_commitment(
        output_registry_id, complete, selection, materialization_key);
    assert!(witness_commitment == expected, EInvalidProof);
    (complete, selection, materialization_key, witness_commitment)
}

fun derive_physical_witness_commitment(
    output_registry_id: ID,
    complete: PhysicalCompleteBindingV8,
    selection: PhysicalSelectionBindingV8,
    materialization_key: String,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&PhysicalWitnessCommitmentInputV8 {
        domain: b"animacraft-v8/output/physical-materialization",
        version: VERSION, output_registry_id, complete, selection,
        materialization_key,
    }))
}

fun reserve_materialization(
    registry: &mut OutputRegistryV8,
    key: MaterializationKeyV8,
    witness_commitment: vector<u8>,
) {
    assert_hash(&witness_commitment);
    assert!(!registry.materializations.contains(key), EDuplicate);
    registry.materializations.add(key, witness_commitment);
    registry.materialization_keys.push_back(key);
    registry.materialization_count = registry.materialization_count + 1;
}

fun finish_complete<PaymentCoin>(
    session: CompleteSessionV8,
    output_registry: &OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    loadout: &MakerLoadoutV8,
    render_blob_id: String,
    render_sha256: vector<u8>,
    render_blob_commitment: vector<u8>,
    protected: bool,
    scope_key: String,
    asset_key: String,
    ctx: &mut TxContext,
): (CompleteOutputV8, CompleteReceiptV8) {
    assert_active_output_registry(output_registry, root);
    assert_render_input(&render_blob_id, &render_sha256, &render_blob_commitment,
        protected, &scope_key, &asset_key);
    let CompleteSessionV8 {
        output_registry_id, soul_registry_id, root_id, maker_version,
        root_content_commitment, output_key, holder,
        loadout_id: session_loadout_id,
        loadout_revision: session_loadout_revision,
        loadout_commitment: session_loadout_commitment,
        authorization, base_line, pack_lines, total_paid_atomic,
    } = session;
    assert_exact_holder(holder, ctx.sender());
    assert!(output_registry_id == object::id(output_registry), EInvalidBinding);
    assert!(soul_registry_id == output_registry.soul_registry_id, EInvalidBinding);
    let policy = borrow_policy(output_registry, output_key);
    assert!(policy.protected_output == protected, EInvalidPolicy);
    if (protected) assert!(policy.complete_scope_key == scope_key, EInvalidPolicy);
    let (loadout_id, authorization_root_id, authorization_root_version,
        authorization_root_content, loadout_revision, loadout_commitment,
        selection_count, ordered_selection_commitments,
        ordered_pricing_commitments, used_packs) =
        runtime::consume_loadout_authorization_v8(authorization, loadout);
    assert!(root_id == authorization_root_id && root_id == maker::root_id_v8(root), EInvalidProof);
    assert!(maker_version == authorization_root_version
        && maker_version == maker::root_maker_version_v8(root), EInvalidProof);
    assert!(root_content_commitment == authorization_root_content
        && &root_content_commitment == maker::root_content_commitment_v8(root), EInvalidProof);
    assert!(session_loadout_id == loadout_id, EInvalidProof);
    assert!(session_loadout_revision == loadout_revision, EInvalidProof);
    assert!(session_loadout_commitment == loadout_commitment, EInvalidProof);
    assert_exact_pack_lines(policy, &pack_lines, &used_packs);
    let recipe_commitment = hash::sha2_256(bcs::to_bytes(&RecipeCommitmentInputV8 {
        domain: b"animacraft-v8/output/recipe", version: VERSION,
        root_id, maker_version, root_content_commitment,
        renderer_commitment: output_registry.renderer_commitment,
        output_key, renderer_schema_commitment: policy.renderer_schema_commitment,
        output_policy_commitment: policy.row_commitment,
        loadout_id, loadout_revision, loadout_commitment, selection_count,
        ordered_selection_commitments, ordered_pricing_commitments, used_packs,
    }));
    let render_commitment = hash::sha2_256(bcs::to_bytes(&RenderCommitmentInputV8 {
        domain: b"animacraft-v8/output/render", version: VERSION,
        recipe_commitment, renderer_commitment: output_registry.renderer_commitment,
        renderer_schema_commitment: policy.renderer_schema_commitment,
        render_blob_id, render_sha256, render_blob_commitment,
        protected, scope_key, asset_key,
    }));
    let output_commitment = hash::sha2_256(bcs::to_bytes(
        &CompleteOutputCommitmentInputV8 {
            domain: b"animacraft-v8/output/complete", version: VERSION,
            root_id, maker_version, root_content_commitment,
            output_registry_id, output_key, original_holder: holder,
            loadout_id, loadout_revision,
            loadout_commitment, output_policy_commitment:
                policy.row_commitment,
            recipe_commitment, render_commitment, protected, scope_key, asset_key,
        }));
    let economics = maker::root_economics_v8(root);
    let receipt_commitment = hash::sha2_256(bcs::to_bytes(
        &CompleteReceiptCommitmentInputV8 {
            domain: b"animacraft-v8/output/receipt", version: VERSION,
            root_id, maker_version, root_content_commitment,
            original_holder: holder, output_key,
            loadout_id, loadout_revision, loadout_commitment,
            output_policy_commitment: policy.row_commitment,
            renderer_schema_commitment: policy.renderer_schema_commitment,
            economics_commitment: *maker::economics_commitment_v8(&economics),
            recipe_commitment, render_commitment, output_commitment,
            base_line, pack_lines, total_paid_atomic, protected,
        }));
    let output_uid = object::new(ctx);
    let output_id = output_uid.to_inner();
    let receipt_uid = object::new(ctx);
    let complete_output = CompleteOutputV8 {
        id: output_uid, version: VERSION, root_id, maker_version,
        root_content_commitment, output_registry_id, output_key,
        original_holder: holder, holder, loadout_id,
        loadout_revision, loadout_commitment,
        output_policy_commitment: policy.row_commitment,
        renderer_schema_commitment: policy.renderer_schema_commitment,
        recipe_commitment, render_commitment, render_blob_id,
        render_sha256, render_blob_commitment, output_commitment, protected,
        scope_key, asset_key, seal_id: option::none(),
        protection_binding_commitment: vector[],
    };
    let receipt = CompleteReceiptV8 {
        id: receipt_uid, version: VERSION, output_id, root_id, maker_version,
        root_content_commitment, output_key, original_holder: holder, holder,
        loadout_id, loadout_revision, loadout_commitment,
        output_policy_commitment: policy.row_commitment,
        renderer_schema_commitment: policy.renderer_schema_commitment,
        economics_commitment: *maker::economics_commitment_v8(&economics),
        recipe_commitment, render_commitment, output_commitment,
        base_line, pack_lines, total_paid_atomic, receipt_commitment,
        protected, seal_id: option::none(),
    };
    (complete_output, receipt)
}

fun settle_base_payment<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    maker_treasury: &mut MakerTreasuryV8<PaymentCoin>,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    mut payment: Coin<PaymentCoin>,
    line: BaseCompleteLineV8,
    ctx: &mut TxContext,
) {
    maker::assert_current_protocol_config_v8(root, config);
    core_treasury::assert_maker_treasury_v8(root, maker_treasury);
    assert!(coin::value(&payment) == line.total_atomic, EWrongPayment);
    if (line.fixed_protocol_atomic > 0) {
        let fixed = coin::split(&mut payment, line.fixed_protocol_atomic, ctx);
        protocol::deposit_protocol_revenue_v8(config, protocol_treasury, fixed);
    };
    if (line.base_protocol_atomic > 0) {
        let protocol_line = coin::split(&mut payment, line.base_protocol_atomic, ctx);
        protocol::deposit_protocol_revenue_v8(config, protocol_treasury, protocol_line);
    };
    assert!(coin::value(&payment) == line.maker_atomic, EWrongPayment);
    if (line.maker_atomic > 0) {
        core_treasury::deposit_maker_revenue_v8(root, maker_treasury, config, payment);
    } else {
        coin::destroy_zero(payment);
    }
}

fun append_pack_payment_line<PaymentCoin>(
    session: &mut CompleteSessionV8,
    release: &PackReleaseV8<PaymentCoin>,
    release_id: ID,
    ordinal: u64,
    gross_atomic: u64,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(release_id == runtime::pack_release_id_v8(release), EPackMismatch);
    let economics = maker::root_economics_v8(root);
    let protocol_atomic = protocol_share(
        gross_atomic, maker::economics_primary_content_fee_bps_v8(&economics));
    let pack_atomic = gross_atomic - protocol_atomic;
    session.pack_lines.push_back(PackPaymentLineV8 {
        release_id,
        semantic_pack_id: *runtime::pack_release_semantic_id_v8(release),
        release_content_commitment:
            *runtime::pack_release_content_commitment_v8(release),
        ordinal, gross_atomic, protocol_atomic, pack_atomic,
    });
    session.total_paid_atomic = session.total_paid_atomic + (gross_atomic as u128);
}

fun assert_exact_pack_lines(
    policy: &OutputPolicyRowV8,
    lines: &vector<PackPaymentLineV8>,
    used_packs: &vector<UsedPackV8>,
) {
    let mut derived = vector[];
    let mut index = 0;
    while (index < used_packs.length()) {
        let used = used_packs.borrow(index);
        derived.push_back(DerivedPackBindingV8 {
            release_id: runtime::used_pack_release_id_v8(used),
            semantic_pack_id: *runtime::used_pack_semantic_id_v8(used),
            release_content_commitment:
                *runtime::used_pack_content_commitment_v8(used),
            pricing_commitment: *runtime::used_pack_pricing_commitment_v8(used),
        });
        index = index + 1;
    };
    assert_exact_pack_bindings(policy, lines, &derived)
}

fun assert_exact_pack_bindings(
    policy: &OutputPolicyRowV8,
    lines: &vector<PackPaymentLineV8>,
    derived: &vector<DerivedPackBindingV8>,
) {
    assert!(lines.length() == derived.length(), EPackMismatch);
    let mut index = 0;
    while (index < derived.length()) {
        let line = lines.borrow(index);
        let used = derived.borrow(index);
        assert!(line.release_id == used.release_id, EPackMismatch);
        assert!(line.semantic_pack_id == used.semantic_pack_id, EPackMismatch);
        assert!(line.release_content_commitment
            == used.release_content_commitment, EPackMismatch);
        assert_hash(&used.pricing_commitment);
        assert_allowed_semantic(policy, &line.semantic_pack_id);
        index = index + 1;
    }
}

fun assert_allowed_semantic(policy: &OutputPolicyRowV8, semantic_id: &String) {
    if (policy.allowed_pack_policy == POLICY_ALL_ADMITTED) return;
    let mut index = 0;
    while (index < policy.allowed_semantic_pack_ids.length()) {
        if (policy.allowed_semantic_pack_ids.borrow(index) == semantic_id) return;
        index = index + 1;
    };
    abort EInvalidPolicy
}

fun mutate_base_counter(output: &mut OutputRegistryV8, holder: address, ordinal: u64) {
    let key = WalletKeyV8 { holder };
    if (output.complete_by_wallet.contains(key)) {
        assert!(*output.complete_by_wallet.borrow(key) == ordinal, EInvalidBinding);
        *output.complete_by_wallet.borrow_mut(key) = ordinal + 1;
    } else {
        assert!(ordinal == 0, EInvalidBinding);
        output.complete_by_wallet.add(key, 1);
        output.wallet_keys.push_back(key);
    };
    output.total_complete_count = output.total_complete_count + 1;
}

fun complete_price_for_ordinal(mode: u8, price: u64, quota: u64, ordinal: u64): u64 {
    if (mode == maker::complete_unlimited_free_v8()) return 0;
    if (mode == maker::complete_free_quota_then_paid_v8()) {
        return if (ordinal < quota) 0 else price
    };
    if (mode == maker::complete_paid_every_time_v8()) return price;
    assert!(mode == maker::complete_free_quota_then_block_v8(), EInvalidPolicy);
    assert!(ordinal < quota, ECompleteBlocked);
    0
}

fun assert_total_cap(current: u64, total_cap: u64) {
    if (total_cap != 0) assert!(current < total_cap, ECompleteBlocked)
}

fun protocol_share(gross: u64, bps: u16): u64 {
    if (gross == 0 || bps == 0) return 0;
    let value = (((gross as u128) * (bps as u128)) / BPS_DENOMINATOR) as u64;
    assert!(value > 0, EWrongPayment);
    value
}

fun validate_allowed_pack_policy(kind: u8, values: &vector<String>) {
    assert!(kind == POLICY_ALL_ADMITTED || kind == POLICY_ALLOWLIST, EInvalidPolicy);
    assert!(values.length() <= MAX_ALLOWLIST_COUNT, EInvalidPolicy);
    if (kind == POLICY_ALL_ADMITTED) {
        assert!(values.is_empty(), EInvalidPolicy);
        return
    };
    assert!(!values.is_empty(), EInvalidPolicy);
    let mut index = 0;
    let mut previous = vector[];
    while (index < values.length()) {
        let bytes = string::as_bytes(values.borrow(index));
        assert!(bytes.length() > 0 && bytes.length() <= MAX_SEMANTIC_KEY_BYTES, EInvalidKey);
        if (index > 0) assert!(lexicographically_less(&previous, bytes), EInvalidPolicy);
        previous = *bytes;
        index = index + 1;
    }
}

fun assert_scope_policy(protected_output: bool, scope_key: &String) {
    if (protected_output) {
        assert_semantic_key(scope_key)
    } else {
        assert!(string::as_bytes(scope_key).is_empty(), EInvalidPolicy)
    }
}

fun append_policy_row(
    registry: &mut OutputRegistryV8,
    sequence: u64,
    output_key: String,
    protected_output: bool,
    complete_scope_key: String,
    renderer_schema_commitment: vector<u8>,
    allowed_pack_policy: u8,
    allowed_semantic_pack_ids: vector<String>,
    row_commitment: vector<u8>,
    next_commitment: vector<u8>,
) {
    assert!(!registry.sealed, ERegistrySealed);
    assert!(sequence == registry.observed_output_count, EInvalidSequence);
    assert!(sequence < registry.expected_output_count, EInvalidConfig);
    assert_semantic_key(&output_key);
    assert_scope_policy(protected_output, &complete_scope_key);
    assert_hash(&renderer_schema_commitment);
    assert_hash(&row_commitment);
    assert_hash(&next_commitment);
    validate_allowed_pack_policy(allowed_pack_policy, &allowed_semantic_pack_ids);
    let key = OutputPolicyKeyV8 { output_key };
    assert!(!registry.policy_rows.contains(key), EDuplicate);
    registry.policy_rows.add(key, OutputPolicyRowV8 {
        sequence, output_key, protected_output, complete_scope_key,
        renderer_schema_commitment, allowed_pack_policy,
        allowed_semantic_pack_ids, row_commitment,
    });
    registry.policy_keys.push_back(key);
    registry.observed_output_count = registry.observed_output_count + 1;
    registry.rolling_policy_commitment = next_commitment;
}

fun assert_row_commitment(actual: &vector<u8>, expected: &vector<u8>) {
    assert!(actual == expected, EInvalidCommitment)
}

fun seal_policy_rows(registry: &mut OutputRegistryV8) {
    assert!(!registry.sealed, ERegistrySealed);
    assert!(registry.observed_output_count == registry.expected_output_count,
        EInvalidConfig);
    assert!(registry.policy_keys.length() == registry.expected_output_count,
        EInvalidConfig);
    assert!(registry.rolling_policy_commitment
        == registry.expected_policy_commitment, EInvalidCommitment);
    registry.sealed = true;
}

fun borrow_policy(registry: &OutputRegistryV8, output_key: String): &OutputPolicyRowV8 {
    let key = OutputPolicyKeyV8 { output_key };
    assert!(registry.policy_rows.contains(key), EInvalidKey);
    registry.policy_rows.borrow(key)
}

fun lexicographically_less(left: &vector<u8>, right: &vector<u8>): bool {
    let mut index = 0;
    let shorter = if (left.length() < right.length()) left.length() else right.length();
    while (index < shorter) {
        if (left[index] < right[index]) return true;
        if (left[index] > right[index]) return false;
        index = index + 1;
    };
    left.length() < right.length()
}

fun assert_render_input(
    blob_id: &String,
    sha256: &vector<u8>,
    blob_commitment: &vector<u8>,
    protected: bool,
    scope_key: &String,
    asset_key: &String,
) {
    let blob_length = string::as_bytes(blob_id).length();
    assert!(blob_length > 0 && blob_length <= MAX_BLOB_ID_BYTES, EInvalidKey);
    assert_hash(sha256);
    assert_hash(blob_commitment);
    if (protected) {
        let scope_length = string::as_bytes(scope_key).length();
        let asset_length = string::as_bytes(asset_key).length();
        assert!(scope_length > 0 && scope_length <= MAX_SEMANTIC_KEY_BYTES, EInvalidKey);
        assert!(asset_length > 0 && asset_length <= MAX_SEMANTIC_KEY_BYTES, EInvalidKey);
    } else {
        assert!(string::as_bytes(scope_key).is_empty(), EInvalidPolicy);
        assert!(string::as_bytes(asset_key).is_empty(), EInvalidPolicy);
    }
}

fun assert_semantic_key(value: &String) {
    let length = string::as_bytes(value).length();
    assert!(length > 0 && length <= MAX_SEMANTIC_KEY_BYTES, EInvalidKey)
}

fun assert_hash(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
    let mut any = false;
    let mut index = 0;
    while (index < HASH_LENGTH) {
        if (value[index] != 0) any = true;
        index = index + 1;
    };
    assert!(any, EInvalidCommitment)
}

fun derive_current_output_commitment(output: &CompleteOutputV8): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&CompleteOutputCommitmentInputV8 {
        domain: b"animacraft-v8/output/complete", version: VERSION,
        root_id: output.root_id, maker_version: output.maker_version,
        root_content_commitment: output.root_content_commitment,
        output_registry_id: output.output_registry_id,
        output_key: output.output_key,
        original_holder: output.original_holder,
        loadout_id: output.loadout_id,
        loadout_revision: output.loadout_revision,
        loadout_commitment: output.loadout_commitment,
        output_policy_commitment: output.output_policy_commitment,
        recipe_commitment: output.recipe_commitment,
        render_commitment: output.render_commitment,
        protected: output.protected,
        scope_key: output.scope_key,
        asset_key: output.asset_key,
    }))
}

fun derive_current_receipt_commitment(receipt: &CompleteReceiptV8): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&CompleteReceiptCommitmentInputV8 {
        domain: b"animacraft-v8/output/receipt", version: VERSION,
        root_id: receipt.root_id, maker_version: receipt.maker_version,
        root_content_commitment: receipt.root_content_commitment,
        original_holder: receipt.original_holder,
        output_key: receipt.output_key,
        loadout_id: receipt.loadout_id,
        loadout_revision: receipt.loadout_revision,
        loadout_commitment: receipt.loadout_commitment,
        output_policy_commitment: receipt.output_policy_commitment,
        renderer_schema_commitment: receipt.renderer_schema_commitment,
        economics_commitment: receipt.economics_commitment,
        recipe_commitment: receipt.recipe_commitment,
        render_commitment: receipt.render_commitment,
        output_commitment: receipt.output_commitment,
        base_line: receipt.base_line,
        pack_lines: receipt.pack_lines,
        total_paid_atomic: receipt.total_paid_atomic,
        protected: receipt.protected,
    }))
}

fun derive_current_soul_commitment(soul: &CanonicalSoulV8): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&SoulCommitmentInputV8 {
        domain: b"animacraft-v8/output/canonical-soul", version: VERSION,
        soul_registry_id: soul.soul_registry_id,
        root_id: soul.root_id,
        maker_version: soul.maker_version,
        root_content_commitment: soul.root_content_commitment,
        output_key: soul.output_key,
        output_policy_commitment: soul.output_policy_commitment,
        holder: soul.holder,
        ownership_epoch: soul.ownership_epoch,
        output_id: soul.output_id,
        receipt_id: soul.receipt_id,
        recipe_commitment: soul.recipe_commitment,
        render_commitment: soul.render_commitment,
        output_commitment: soul.output_commitment,
        receipt_commitment: soul.receipt_commitment,
        soul_creator_royalty_bps: soul.soul_creator_royalty_bps,
        maker_source_royalty_bps: soul.maker_source_royalty_bps,
    }))
}

fun assert_protection_binding(
    output: &CompleteOutputV8,
    receipt: &CompleteReceiptV8,
) {
    assert!(output.protected == receipt.protected, EInvalidBinding);
    if (output.protected) {
        assert!(output.seal_id.is_some() && receipt.seal_id.is_some(),
            EInvalidBinding);
        assert!(output.seal_id == receipt.seal_id, EInvalidBinding);
        let seal_id = *output.seal_id.borrow();
        let expected = hash::sha2_256(bcs::to_bytes(
            &ProtectionBindingCommitmentInputV8 {
                domain: b"animacraft-v8/output/protection", version: VERSION,
                output_id: object::id(output),
                receipt_id: object::id(receipt),
                output_commitment: output.output_commitment,
                receipt_commitment: receipt.receipt_commitment,
                scope_key: output.scope_key,
                asset_key: output.asset_key,
                seal_id,
            },
        ));
        assert!(output.protection_binding_commitment == expected,
            EInvalidCommitment);
    } else {
        assert!(output.seal_id.is_none() && receipt.seal_id.is_none(),
            EInvalidBinding);
        assert!(output.protection_binding_commitment.is_empty(),
            EInvalidCommitment);
    }
}

fun assert_live_soul_bundle<PaymentCoin>(
    output: &CompleteOutputV8,
    receipt: &CompleteReceiptV8,
    soul: &CanonicalSoulV8,
    output_registry: &OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    expected_holder: address,
    expected_epoch: u64,
) {
    assert_registry_pair(root, output_registry, soul_registry);
    assert!(output.version == VERSION && receipt.version == VERSION
        && soul.version == VERSION, EInvalidBinding);
    assert_exact_holder(output.holder, expected_holder);
    assert_exact_holder(receipt.holder, expected_holder);
    assert_exact_holder(soul.holder, expected_holder);
    assert!(output.original_holder != @0x0
        && output.original_holder == receipt.original_holder, EInvalidBinding);
    assert!(soul.ownership_epoch == expected_epoch, EOwnershipEpochMismatch);
    maker::assert_root_identity_v8(
        root, output.root_id, output.maker_version,
        &output.root_content_commitment,
    );
    assert!(receipt.root_id == output.root_id && soul.root_id == output.root_id,
        EInvalidBinding);
    assert!(receipt.maker_version == output.maker_version
        && soul.maker_version == output.maker_version, EInvalidBinding);
    assert!(receipt.root_content_commitment == output.root_content_commitment
        && soul.root_content_commitment == output.root_content_commitment,
        EInvalidBinding);
    assert!(output.output_registry_id == object::id(output_registry),
        EInvalidBinding);
    assert!(soul.soul_registry_id == object::id(soul_registry),
        EInvalidBinding);
    let output_id = object::id(output);
    let receipt_id = object::id(receipt);
    let soul_id = object::id(soul);
    assert!(receipt.output_id == output_id, EInvalidBinding);
    assert!(soul.output_id == output_id && soul.receipt_id == receipt_id,
        EInvalidBinding);
    assert!(receipt.output_key == output.output_key
        && soul.output_key == output.output_key, EInvalidBinding);
    assert!(receipt.loadout_id == output.loadout_id
        && receipt.loadout_revision == output.loadout_revision
        && receipt.loadout_commitment == output.loadout_commitment,
        EInvalidBinding);
    assert!(receipt.output_policy_commitment == output.output_policy_commitment
        && soul.output_policy_commitment == output.output_policy_commitment,
        EInvalidBinding);
    assert!(receipt.renderer_schema_commitment
        == output.renderer_schema_commitment, EInvalidBinding);
    assert!(receipt.recipe_commitment == output.recipe_commitment
        && soul.recipe_commitment == output.recipe_commitment,
        EInvalidBinding);
    assert!(receipt.render_commitment == output.render_commitment
        && soul.render_commitment == output.render_commitment,
        EInvalidBinding);
    assert!(receipt.output_commitment == output.output_commitment
        && soul.output_commitment == output.output_commitment,
        EInvalidBinding);
    assert!(soul.receipt_commitment == receipt.receipt_commitment,
        EInvalidBinding);
    assert!(receipt.protected == output.protected, EInvalidBinding);
    let economics = maker::root_economics_v8(root);
    assert!(receipt.economics_commitment
        == *maker::economics_commitment_v8(&economics), EInvalidBinding);
    let rights = maker::root_rights_v8(root);
    assert!(soul.soul_creator_royalty_bps
        == maker::rights_soul_creator_royalty_bps_v8(&rights), EInvalidBinding);
    assert!(soul.maker_source_royalty_bps
        == maker::rights_maker_source_royalty_bps_v8(&rights), EInvalidBinding);
    let policy = borrow_policy(output_registry, output.output_key);
    assert!(policy.row_commitment == output.output_policy_commitment,
        EInvalidBinding);
    assert!(derive_current_output_commitment(output) == output.output_commitment,
        EInvalidCommitment);
    assert!(derive_current_receipt_commitment(receipt)
        == receipt.receipt_commitment, EInvalidCommitment);
    assert_protection_binding(output, receipt);
    assert!(derive_current_soul_commitment(soul) == soul.soul_commitment,
        EInvalidCommitment);
    let output_record = output_registry.outputs.borrow(output_id);
    assert!(output_record.output_id == output_id
        && output_record.receipt_id == receipt_id
        && output_record.soul_id == soul_id
        && output_record.output_key == output.output_key
        && output_record.output_policy_commitment
            == output.output_policy_commitment
        && output_record.holder == expected_holder
        && output_record.recipe_commitment == output.recipe_commitment
        && output_record.render_commitment == output.render_commitment
        && output_record.output_commitment == output.output_commitment
        && output_record.receipt_commitment == receipt.receipt_commitment
        && output_record.protected == output.protected
        && output_record.seal_id == output.seal_id, EInvalidBinding);
    let soul_record = soul_registry.souls.borrow(soul_id);
    assert!(soul_record.soul_id == soul_id
        && soul_record.output_id == output_id
        && soul_record.receipt_id == receipt_id
        && soul_record.holder == expected_holder
        && soul_record.ownership_epoch == expected_epoch
        && soul_record.soul_commitment == soul.soul_commitment,
        EInvalidBinding);
}

fun assert_soul_market_boundary<
    PaymentCoin,
    MarketOriginalMarker,
    MarketCallableMarker,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    output_registry: &OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
) {
    binding::assert_market_call_cap_v8(catalog, market_call_cap);
    binding::assert_catalog_snapshot_v8(
        catalog,
        maker::root_protocol_config_id_v8(root),
        maker::root_protocol_config_revision_v8(root),
        maker::root_protocol_config_commitment_v8(root),
    );
    let catalog_product = binding::catalog_binding_v8(catalog);
    let market_binding = binding::market_binding_v8(catalog_product);
    binding::assert_type_origins_v8<
        MarketOriginalMarker,
        MarketCallableMarker,
    >(market_binding);
    binding::assert_type_original_v8<MarketRegistry>(market_binding);
    binding::assert_type_original_v8<MarketTreasury>(market_binding);
    assert!(maker::root_product_release_catalog_id_v8(root)
        == binding::catalog_id_v8(catalog), EInvalidBinding);
    assert!(binding::product_binding_commitment_v8(
        maker::root_product_release_binding_v8(root),
    ) == binding::product_binding_commitment_v8(catalog_product),
        EInvalidBinding);
    binding::assert_same_call_cap_set_v8(
        maker::root_product_release_call_cap_set_v8(root),
        binding::catalog_call_cap_set_v8(catalog),
    );
    assert_registry_pair(root, output_registry, soul_registry);
    let capability = maker::root_capability_registry_binding_v8(root);
    assert!(maker::capability_catalog_id_v8(capability)
        == binding::catalog_id_v8(catalog), EInvalidBinding);
    binding::assert_same_call_cap_set_v8(
        maker::capability_call_cap_set_v8(capability),
        binding::catalog_call_cap_set_v8(catalog),
    );
    assert!(maker::capability_output_registry_id_v8(capability)
        == object::id(output_registry), EInvalidBinding);
    assert!(maker::capability_soul_registry_id_v8(capability)
        == object::id(soul_registry), EInvalidBinding);
    assert!(maker::capability_market_registry_id_v8(capability)
        == object::id(market_registry), EInvalidBinding);
    assert!(maker::capability_market_treasury_id_v8(capability)
        == object::id(market_treasury), EInvalidBinding);
}

fun assert_active_soul_market_boundary<
    PaymentCoin,
    MarketOriginalMarker,
    MarketCallableMarker,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    output_registry: &OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
) {
    maker::assert_current_protocol_config_v8(root, protocol_config);
    binding::assert_catalog_current_v8(protocol_config, catalog);
    assert_soul_market_boundary<
        PaymentCoin,
        MarketOriginalMarker,
        MarketCallableMarker,
        MarketRegistry,
        MarketTreasury,
    >(
        output_registry, soul_registry, root, catalog, market_registry,
        market_treasury, market_call_cap,
    );
    assert_active_registry_pair(output_registry, soul_registry, root);
}

fun assert_soul_market_custody_header<
    PaymentCoin,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    custody: &SoulMarketCustodyBindingV8,
    listing: &UID,
    output_registry: &OutputRegistryV8,
    soul_registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
) {
    assert!(custody.listing_id == listing.to_inner(), EInvalidBinding);
    assert!(custody.output_registry_id == object::id(output_registry),
        EInvalidBinding);
    assert!(custody.soul_registry_id == object::id(soul_registry),
        EInvalidBinding);
    assert!(custody.market_registry_id == object::id(market_registry),
        EInvalidBinding);
    assert!(custody.market_treasury_id == object::id(market_treasury),
        EInvalidBinding);
    maker::assert_root_identity_v8(
        root, custody.root_id, custody.maker_version,
        &custody.root_content_commitment,
    );
    assert!(custody.seller != @0x0, EWrongHolder);
    assert_hash(&custody.output_commitment);
    assert_hash(&custody.receipt_commitment);
    assert_hash(&custody.soul_commitment);
}

fun assert_soul_market_custody_bundle(
    custody: &SoulMarketCustodyBindingV8,
    output: &CompleteOutputV8,
    receipt: &CompleteReceiptV8,
    soul: &CanonicalSoulV8,
) {
    assert!(custody.output_id == object::id(output)
        && custody.receipt_id == object::id(receipt)
        && custody.soul_id == object::id(soul), EWrongReceiving);
    assert!(custody.output_commitment == output.output_commitment
        && custody.receipt_commitment == receipt.receipt_commitment
        && custody.soul_commitment == soul.soul_commitment,
        EInvalidCommitment);
}

fun receive_soul_market_bundle(
    listing: &mut UID,
    custody: &SoulMarketCustodyBindingV8,
    output_receiving: Receiving<CompleteOutputV8>,
    receipt_receiving: Receiving<CompleteReceiptV8>,
    soul_receiving: Receiving<CanonicalSoulV8>,
): (CompleteOutputV8, CompleteReceiptV8, CanonicalSoulV8) {
    assert!(transfer::receiving_object_id(&output_receiving)
        == custody.output_id, EWrongReceiving);
    assert!(transfer::receiving_object_id(&receipt_receiving)
        == custody.receipt_id, EWrongReceiving);
    assert!(transfer::receiving_object_id(&soul_receiving)
        == custody.soul_id, EWrongReceiving);
    let output = transfer::receive(listing, output_receiving);
    let receipt = transfer::receive(listing, receipt_receiving);
    let soul = transfer::receive(listing, soul_receiving);
    assert_soul_market_custody_bundle(custody, &output, &receipt, &soul);
    (output, receipt, soul)
}

fun assert_config(catalog: &ProductReleaseCatalogV8, config: &OutputPackageConfigV8) {
    assert!(config.version == VERSION, EInvalidConfig);
    assert!(config.catalog_id == binding::catalog_id_v8(catalog), EInvalidConfig);
    assert!(&config.product_binding_commitment
        == binding::product_binding_commitment_v8(binding::catalog_binding_v8(catalog)),
        EInvalidConfig);
    binding::assert_output_call_cap_v8(catalog, &config.output_call_cap)
}

fun assert_registry_root<PaymentCoin>(
    output: &OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(output.version == VERSION, EInvalidBinding);
    maker::assert_root_identity_v8(
        root, output.root_id, output.maker_version, &output.root_content_commitment);
    assert!(&output.renderer_commitment == maker::root_renderer_commitment_v8(root), EInvalidBinding);
    assert!(output.expected_output_count <= MAX_OUTPUT_POLICY_COUNT, EInvalidBinding);
    assert_hash(&output.expected_policy_commitment);
    assert_hash(&output.rolling_policy_commitment);
    assert!(output.observed_output_count <= output.expected_output_count,
        EInvalidBinding);
    assert!(output.policy_keys.length() == output.observed_output_count,
        EInvalidBinding)
}

fun assert_registry_identity<PaymentCoin>(
    output: &OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    maker::assert_draft_v8(root);
    assert_registry_root(output, root)
}

fun assert_registry_ready(output: &OutputRegistryV8, souls: &SoulRegistryV8) {
    assert!(output.sealed, ERegistryNotSealed);
    assert!(output.observed_output_count == output.expected_output_count,
        EInvalidConfig);
    assert!(output.rolling_policy_commitment
        == output.expected_policy_commitment, EInvalidCommitment);
    assert!(output.total_complete_count == 0, EInvalidLifecycle);
    assert!(output.wallet_keys.is_empty(), EInvalidLifecycle);
    assert!(output.output_count == 0 && output.output_keys.is_empty(),
        EInvalidLifecycle);
    assert!(output.materialization_count == 0
        && output.materialization_keys.is_empty(), EInvalidLifecycle);
    assert!(souls.soul_count == 0 && souls.soul_keys.is_empty(),
        EInvalidLifecycle)
}

fun assert_active_output_registry<PaymentCoin>(
    output: &OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert_active_lifecycle(maker::root_lifecycle_v8(root));
    assert_registry_root(output, root);
    assert!(output.sealed, ERegistryNotSealed);
    assert!(output.rolling_policy_commitment
        == output.expected_policy_commitment, EInvalidCommitment);
    let capabilities = maker::root_capability_registry_binding_v8(root);
    assert!(maker::capability_output_registry_id_v8(capabilities)
        == object::id(output), EInvalidBinding);
    assert!(maker::capability_soul_registry_id_v8(capabilities)
        == output.soul_registry_id, EInvalidBinding)
}

fun assert_active_lifecycle(lifecycle: u8) {
    assert!(lifecycle == maker::lifecycle_active_v8(), EInvalidLifecycle)
}

fun assert_exact_holder(actual: address, expected: address) {
    assert!(actual == expected && expected != @0x0, EWrongHolder)
}

fun assert_registry_pair<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    output: &OutputRegistryV8,
    souls: &SoulRegistryV8,
) {
    assert_registry_root(output, root);
    assert!(souls.version == VERSION, EInvalidBinding);
    assert!(souls.root_id == output.root_id, EInvalidBinding);
    assert!(souls.maker_version == output.maker_version, EInvalidBinding);
    assert!(souls.root_content_commitment == output.root_content_commitment, EInvalidBinding);
    assert!(output.soul_registry_id == object::id(souls), EInvalidBinding);
    assert!(souls.output_registry_id == object::id(output), EInvalidBinding)
}

fun assert_active_registry_pair<PaymentCoin>(
    output: &OutputRegistryV8,
    souls: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert_active_output_registry(output, root);
    assert_registry_pair(root, output, souls)
}

fun assert_session_live<PaymentCoin>(
    session: &CompleteSessionV8,
    output: &OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    loadout: &MakerLoadoutV8,
    ctx: &TxContext,
) {
    assert_active_output_registry(output, root);
    assert_exact_holder(session.holder, ctx.sender());
    assert!(session.output_registry_id == object::id(output), EInvalidBinding);
    assert!(session.root_id == maker::root_id_v8(root), EInvalidBinding);
    let _ = borrow_policy(output, session.output_key);
    assert!(session.maker_version == maker::root_maker_version_v8(root), EInvalidBinding);
    assert!(&session.root_content_commitment == maker::root_content_commitment_v8(root), EInvalidBinding);
    assert!(session.loadout_id == runtime::loadout_id_v8(loadout), EInvalidProof);
    assert!(session.loadout_revision == runtime::loadout_revision_v8(loadout), EInvalidProof);
    assert!(&session.loadout_commitment == runtime::loadout_commitment_v8(loadout), EInvalidProof)
}

fun assert_complete_root<PaymentCoin>(
    output: &CompleteOutputV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert_active_lifecycle(maker::root_lifecycle_v8(root));
    maker::assert_root_identity_v8(
        root, output.root_id, output.maker_version, &output.root_content_commitment)
}

fun derive_soul_authorization_commitment(
    output: &CompleteOutputV8,
    receipt: &CompleteReceiptV8,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&SoulAuthorizationCommitmentInputV8 {
        domain: b"animacraft-v8/output/soul-authorization", version: VERSION,
        output_id: object::id(output), receipt_id: object::id(receipt),
        holder: output.holder, output_commitment: output.output_commitment,
        receipt_commitment: receipt.receipt_commitment,
        protection_binding_commitment: output.protection_binding_commitment,
    }))
}

fun assert_protected_proof_fields(
    output: &CompleteOutputV8,
    receipt: &CompleteReceiptV8,
    proof_receipt_id: ID,
    proof_output_id: ID,
    proof_recipe_commitment: &vector<u8>,
    proof_render_commitment: &vector<u8>,
    proof_output_commitment: &vector<u8>,
    proof_receipt_commitment: &vector<u8>,
    proof_scope_key: &String,
    proof_asset_key: &String,
    proof_seal_id: &vector<u8>,
) {
    assert!(proof_receipt_id == object::id(receipt), EInvalidProof);
    assert!(proof_output_id == object::id(output), EInvalidProof);
    assert!(proof_recipe_commitment == &output.recipe_commitment, EInvalidProof);
    assert!(proof_render_commitment == &output.render_commitment, EInvalidProof);
    assert!(proof_output_commitment == &output.output_commitment, EInvalidProof);
    assert!(proof_receipt_commitment == &receipt.receipt_commitment, EInvalidProof);
    assert!(proof_scope_key == &output.scope_key, EInvalidProof);
    assert!(proof_asset_key == &output.asset_key, EInvalidProof);
    assert_hash(proof_seal_id)
}

fun record_finished_output(
    registry: &mut OutputRegistryV8,
    output: &CompleteOutputV8,
    receipt: &CompleteReceiptV8,
    soul_id: ID,
) {
    let output_id = object::id(output);
    assert!(!registry.outputs.contains(output_id), EDuplicate);
    registry.outputs.add(output_id, OutputRecordV8 {
        output_id, receipt_id: object::id(receipt), soul_id,
        output_key: output.output_key,
        output_policy_commitment: output.output_policy_commitment,
        holder: output.holder, recipe_commitment: output.recipe_commitment,
        render_commitment: output.render_commitment,
        output_commitment: output.output_commitment,
        receipt_commitment: receipt.receipt_commitment,
        protected: output.protected, seal_id: output.seal_id,
    });
    registry.output_keys.push_back(output_id);
    registry.output_count = registry.output_count + 1;
}

fun record_soul(registry: &mut SoulRegistryV8, soul: &CanonicalSoulV8) {
    let soul_id = object::id(soul);
    assert!(!registry.souls.contains(soul_id), EDuplicate);
    registry.souls.add(soul_id, SoulRecordV8 {
        soul_id, output_id: soul.output_id, receipt_id: soul.receipt_id,
        holder: soul.holder, ownership_epoch: soul.ownership_epoch,
        soul_commitment: soul.soul_commitment,
    });
    registry.soul_keys.push_back(soul_id);
    registry.soul_count = registry.soul_count + 1;
}

public fun output_registry_id_v8(registry: &OutputRegistryV8): ID { object::id(registry) }
public fun output_registry_soul_registry_id_v8(registry: &OutputRegistryV8): ID {
    registry.soul_registry_id
}
public fun output_registry_expected_policy_count_v8(registry: &OutputRegistryV8): u64 {
    registry.expected_output_count
}
public fun output_registry_observed_policy_count_v8(registry: &OutputRegistryV8): u64 {
    registry.observed_output_count
}
public fun output_registry_sealed_v8(registry: &OutputRegistryV8): bool {
    registry.sealed
}
public fun output_registry_policy_commitment_v8(registry: &OutputRegistryV8): &vector<u8> {
    &registry.rolling_policy_commitment
}
public fun output_policy_row_v8(
    registry: &OutputRegistryV8, output_key: String,
): &OutputPolicyRowV8 { borrow_policy(registry, output_key) }
public fun output_policy_sequence_v8(row: &OutputPolicyRowV8): u64 { row.sequence }
public fun output_policy_output_key_v8(row: &OutputPolicyRowV8): &String { &row.output_key }
public fun output_policy_protected_v8(row: &OutputPolicyRowV8): bool { row.protected_output }
public fun output_policy_scope_key_v8(row: &OutputPolicyRowV8): &String {
    &row.complete_scope_key
}
public fun output_policy_renderer_schema_commitment_v8(
    row: &OutputPolicyRowV8,
): &vector<u8> { &row.renderer_schema_commitment }
public fun output_policy_allowed_pack_kind_v8(row: &OutputPolicyRowV8): u8 {
    row.allowed_pack_policy
}
public fun output_policy_allowlist_count_v8(row: &OutputPolicyRowV8): u64 {
    row.allowed_semantic_pack_ids.length()
}
public fun output_policy_allowlist_id_v8(row: &OutputPolicyRowV8, index: u64): &String {
    row.allowed_semantic_pack_ids.borrow(index)
}
public fun output_policy_row_commitment_v8(row: &OutputPolicyRowV8): &vector<u8> {
    &row.row_commitment
}
public fun output_registry_total_complete_count_v8(registry: &OutputRegistryV8): u64 {
    registry.total_complete_count
}
public fun output_registry_wallet_complete_count_v8(
    registry: &OutputRegistryV8, holder: address,
): u64 {
    let key = WalletKeyV8 { holder };
    if (registry.complete_by_wallet.contains(key)) {
        *registry.complete_by_wallet.borrow(key)
    } else { 0 }
}
public fun output_registry_output_count_v8(registry: &OutputRegistryV8): u64 {
    registry.output_count
}
public fun output_record_v8(registry: &OutputRegistryV8, output_id: ID): &OutputRecordV8 {
    registry.outputs.borrow(output_id)
}
public fun output_record_output_key_v8(record: &OutputRecordV8): &String {
    &record.output_key
}
public fun output_record_policy_commitment_v8(record: &OutputRecordV8): &vector<u8> {
    &record.output_policy_commitment
}
public fun output_record_holder_v8(record: &OutputRecordV8): address {
    record.holder
}
public fun output_registry_materialization_count_v8(registry: &OutputRegistryV8): u64 {
    registry.materialization_count
}
public fun output_registry_materialization_commitment_v8(
    registry: &OutputRegistryV8, soul_id: ID, materialization_key: String,
): &vector<u8> {
    registry.materializations.borrow(
        MaterializationKeyV8 { soul_id, materialization_key })
}
public fun soul_registry_id_v8(registry: &SoulRegistryV8): ID { object::id(registry) }
public fun soul_registry_soul_count_v8(registry: &SoulRegistryV8): u64 { registry.soul_count }
public fun soul_record_v8(registry: &SoulRegistryV8, soul_id: ID): &SoulRecordV8 {
    registry.souls.borrow(soul_id)
}
public fun soul_record_holder_v8(record: &SoulRecordV8): address { record.holder }
public fun soul_record_ownership_epoch_v8(record: &SoulRecordV8): u64 {
    record.ownership_epoch
}
public fun soul_record_commitment_v8(record: &SoulRecordV8): &vector<u8> {
    &record.soul_commitment
}

public fun pending_output_id_v8(pending: &ProtectedCompletePendingV8): ID {
    object::id(&pending.output)
}
public fun pending_receipt_id_v8(pending: &ProtectedCompletePendingV8): ID {
    object::id(&pending.receipt)
}
public fun pending_recipe_commitment_v8(pending: &ProtectedCompletePendingV8): &vector<u8> {
    &pending.output.recipe_commitment
}
public fun pending_render_commitment_v8(pending: &ProtectedCompletePendingV8): &vector<u8> {
    &pending.output.render_commitment
}
public fun pending_output_commitment_v8(pending: &ProtectedCompletePendingV8): &vector<u8> {
    &pending.output.output_commitment
}
public fun pending_receipt_commitment_v8(pending: &ProtectedCompletePendingV8): &vector<u8> {
    &pending.receipt.receipt_commitment
}
public fun pending_scope_key_v8(pending: &ProtectedCompletePendingV8): &String {
    &pending.output.scope_key
}
public fun pending_asset_key_v8(pending: &ProtectedCompletePendingV8): &String {
    &pending.output.asset_key
}
public fun pending_complete_instance_commitment_v8(
    pending: &ProtectedCompletePendingV8,
): vector<u8> {
    seal::complete_instance_commitment_v8(
        pending.output.recipe_commitment, pending.output.render_commitment,
        pending.output.output_commitment, pending.receipt.receipt_commitment)
}

public fun soul_market_custody_ticket_binding_v8(
    ticket: &SoulMarketCustodyTicketV8,
): &SoulMarketCustodyBindingV8 { &ticket.binding }
public fun soul_market_listing_id_v8(binding: &SoulMarketCustodyBindingV8): ID {
    binding.listing_id
}
public fun soul_market_output_registry_id_v8(
    binding: &SoulMarketCustodyBindingV8,
): ID { binding.output_registry_id }
public fun soul_market_soul_registry_id_v8(
    binding: &SoulMarketCustodyBindingV8,
): ID { binding.soul_registry_id }
public fun soul_market_market_registry_id_v8(
    binding: &SoulMarketCustodyBindingV8,
): ID { binding.market_registry_id }
public fun soul_market_market_treasury_id_v8(
    binding: &SoulMarketCustodyBindingV8,
): ID { binding.market_treasury_id }
public fun soul_market_root_id_v8(binding: &SoulMarketCustodyBindingV8): ID {
    binding.root_id
}
public fun soul_market_maker_version_v8(
    binding: &SoulMarketCustodyBindingV8,
): u64 { binding.maker_version }
public fun soul_market_root_content_commitment_v8(
    binding: &SoulMarketCustodyBindingV8,
): &vector<u8> { &binding.root_content_commitment }
public fun soul_market_output_id_v8(binding: &SoulMarketCustodyBindingV8): ID {
    binding.output_id
}
public fun soul_market_receipt_id_v8(binding: &SoulMarketCustodyBindingV8): ID {
    binding.receipt_id
}
public fun soul_market_soul_id_v8(binding: &SoulMarketCustodyBindingV8): ID {
    binding.soul_id
}
public fun soul_market_output_commitment_v8(
    binding: &SoulMarketCustodyBindingV8,
): &vector<u8> { &binding.output_commitment }
public fun soul_market_receipt_commitment_v8(
    binding: &SoulMarketCustodyBindingV8,
): &vector<u8> { &binding.receipt_commitment }
public fun soul_market_soul_commitment_v8(
    binding: &SoulMarketCustodyBindingV8,
): &vector<u8> { &binding.soul_commitment }
public fun soul_market_seller_v8(binding: &SoulMarketCustodyBindingV8): address {
    binding.seller
}
public fun soul_market_expected_epoch_v8(
    binding: &SoulMarketCustodyBindingV8,
): u64 { binding.expected_soul_ownership_epoch }

public fun soul_holder_v8(soul: &CanonicalSoulV8): address { soul.holder }
public fun soul_ownership_epoch_v8(soul: &CanonicalSoulV8): u64 { soul.ownership_epoch }
public fun soul_root_id_v8(soul: &CanonicalSoulV8): ID { soul.root_id }
public fun soul_maker_version_v8(soul: &CanonicalSoulV8): u64 { soul.maker_version }
public fun soul_root_content_commitment_v8(soul: &CanonicalSoulV8): &vector<u8> {
    &soul.root_content_commitment
}
public fun soul_output_key_v8(soul: &CanonicalSoulV8): &String { &soul.output_key }
public fun soul_output_policy_commitment_v8(soul: &CanonicalSoulV8): &vector<u8> {
    &soul.output_policy_commitment
}
public fun soul_output_id_v8(soul: &CanonicalSoulV8): ID { soul.output_id }
public fun soul_receipt_id_v8(soul: &CanonicalSoulV8): ID { soul.receipt_id }
public fun soul_commitment_v8(soul: &CanonicalSoulV8): &vector<u8> { &soul.soul_commitment }

public fun complete_output_id_v8(output: &CompleteOutputV8): ID { object::id(output) }
public fun complete_output_original_holder_v8(output: &CompleteOutputV8): address {
    output.original_holder
}
public fun complete_output_holder_v8(output: &CompleteOutputV8): address {
    output.holder
}
public fun complete_output_commitment_v8(
    output: &CompleteOutputV8,
): &vector<u8> { &output.output_commitment }
public fun receipt_id_v8(receipt: &CompleteReceiptV8): ID { object::id(receipt) }
public fun receipt_original_holder_v8(receipt: &CompleteReceiptV8): address {
    receipt.original_holder
}
public fun receipt_holder_v8(receipt: &CompleteReceiptV8): address { receipt.holder }
public fun receipt_output_key_v8(receipt: &CompleteReceiptV8): &String {
    &receipt.output_key
}
public fun receipt_output_policy_commitment_v8(
    receipt: &CompleteReceiptV8,
): &vector<u8> { &receipt.output_policy_commitment }
public fun receipt_loadout_id_v8(receipt: &CompleteReceiptV8): ID { receipt.loadout_id }
public fun receipt_loadout_revision_v8(receipt: &CompleteReceiptV8): u64 {
    receipt.loadout_revision
}
public fun receipt_loadout_commitment_v8(receipt: &CompleteReceiptV8): &vector<u8> {
    &receipt.loadout_commitment
}
public fun receipt_recipe_commitment_v8(receipt: &CompleteReceiptV8): &vector<u8> {
    &receipt.recipe_commitment
}
public fun receipt_render_commitment_v8(receipt: &CompleteReceiptV8): &vector<u8> {
    &receipt.render_commitment
}
public fun receipt_commitment_v8(receipt: &CompleteReceiptV8): &vector<u8> {
    &receipt.receipt_commitment
}

public fun physical_complete_output_registry_id_v8(
    binding: &PhysicalCompleteBindingV8,
): ID { binding.output_registry_id }
public fun physical_complete_root_id_v8(binding: &PhysicalCompleteBindingV8): ID {
    binding.root_id
}
public fun physical_complete_maker_version_v8(binding: &PhysicalCompleteBindingV8): u64 {
    binding.maker_version
}
public fun physical_complete_root_content_commitment_v8(
    binding: &PhysicalCompleteBindingV8,
): &vector<u8> { &binding.root_content_commitment }
public fun physical_complete_holder_v8(binding: &PhysicalCompleteBindingV8): address {
    binding.holder
}
public fun physical_complete_output_key_v8(binding: &PhysicalCompleteBindingV8): &String {
    &binding.output_key
}
public fun physical_complete_policy_commitment_v8(
    binding: &PhysicalCompleteBindingV8,
): &vector<u8> { &binding.output_policy_commitment }
public fun physical_complete_output_id_v8(binding: &PhysicalCompleteBindingV8): ID {
    binding.output_id
}
public fun physical_complete_receipt_id_v8(binding: &PhysicalCompleteBindingV8): ID {
    binding.receipt_id
}
public fun physical_complete_soul_id_v8(binding: &PhysicalCompleteBindingV8): ID {
    binding.soul_id
}
public fun physical_complete_soul_epoch_v8(binding: &PhysicalCompleteBindingV8): u64 {
    binding.soul_ownership_epoch
}
public fun physical_complete_recipe_commitment_v8(
    binding: &PhysicalCompleteBindingV8,
): &vector<u8> { &binding.recipe_commitment }
public fun physical_complete_render_commitment_v8(
    binding: &PhysicalCompleteBindingV8,
): &vector<u8> { &binding.render_commitment }
public fun physical_complete_output_commitment_v8(
    binding: &PhysicalCompleteBindingV8,
): &vector<u8> { &binding.output_commitment }
public fun physical_complete_receipt_commitment_v8(
    binding: &PhysicalCompleteBindingV8,
): &vector<u8> { &binding.receipt_commitment }
public fun physical_complete_soul_commitment_v8(
    binding: &PhysicalCompleteBindingV8,
): &vector<u8> { &binding.soul_commitment }

public fun physical_selection_loadout_id_v8(binding: &PhysicalSelectionBindingV8): ID {
    binding.loadout_id
}
public fun physical_selection_loadout_revision_v8(
    binding: &PhysicalSelectionBindingV8,
): u64 { binding.loadout_revision }
public fun physical_selection_loadout_commitment_v8(
    binding: &PhysicalSelectionBindingV8,
): &vector<u8> { &binding.loadout_commitment }
public fun physical_selection_index_v8(binding: &PhysicalSelectionBindingV8): u64 {
    binding.selection_index
}
public fun physical_selection_commitment_v8(
    binding: &PhysicalSelectionBindingV8,
): &vector<u8> { &binding.selection_commitment }
public fun physical_selection_part_key_v8(binding: &PhysicalSelectionBindingV8): &String {
    &binding.part_key
}
public fun physical_selection_item_key_v8(binding: &PhysicalSelectionBindingV8): &String {
    &binding.item_key
}
public fun physical_selection_style_key_v8(binding: &PhysicalSelectionBindingV8): &String {
    &binding.style_key
}
public fun physical_selection_layer_track_key_v8(
    binding: &PhysicalSelectionBindingV8,
): &String { &binding.layer_track_key }
public fun physical_selection_source_class_v8(binding: &PhysicalSelectionBindingV8): u8 {
    binding.source_class
}
public fun physical_selection_source_definition_id_v8(
    binding: &PhysicalSelectionBindingV8,
): ID { binding.source_definition_id }
public fun physical_selection_source_semantic_id_v8(
    binding: &PhysicalSelectionBindingV8,
): &String { &binding.source_semantic_id }
public fun physical_selection_source_content_commitment_v8(
    binding: &PhysicalSelectionBindingV8,
): &vector<u8> { &binding.source_content_commitment }
public fun physical_selection_source_epoch_v8(binding: &PhysicalSelectionBindingV8): u64 {
    binding.source_epoch
}
public fun physical_selection_pricing_commitment_v8(
    binding: &PhysicalSelectionBindingV8,
): &vector<u8> { &binding.pricing_commitment }
public fun physical_selection_asset_content_commitment_v8(
    binding: &PhysicalSelectionBindingV8,
): &vector<u8> { &binding.asset_content_commitment }

/// Downstream Market tests cannot manufacture the private fields of the
/// key-only bundle. This helper creates one exact unprotected bundle and the
/// matching Output/Soul registry records without adding production bytecode.
#[test_only]
public fun new_soul_market_bundle_for_testing_v8<PaymentCoin>(
    output_registry: &mut OutputRegistryV8,
    soul_registry: &mut SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    holder: address,
    ctx: &mut TxContext,
): (CompleteOutputV8, CompleteReceiptV8, CanonicalSoulV8) {
    assert_registry_pair(root, output_registry, soul_registry);
    assert!(output_registry.sealed && !output_registry.policy_keys.is_empty(),
        ERegistryNotSealed);
    assert_exact_holder(holder, holder);
    let policy_key = output_registry.policy_keys[0];
    let policy = output_registry.policy_rows.borrow(policy_key);
    assert!(!policy.protected_output, EInvalidPolicy);
    let output_uid = object::new(ctx);
    let output_id = output_uid.to_inner();
    let receipt_uid = object::new(ctx);
    let receipt_id = receipt_uid.to_inner();
    let base_line = BaseCompleteLineV8 {
        ordinal: 0, base_gross_atomic: 0, base_protocol_atomic: 0,
        maker_atomic: 0, fixed_protocol_atomic: 0, total_atomic: 0,
    };
    let mut output = CompleteOutputV8 {
        id: output_uid, version: VERSION,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        output_registry_id: object::id(output_registry),
        output_key: policy.output_key,
        original_holder: holder, holder,
        loadout_id: maker::root_id_v8(root), loadout_revision: 0,
        loadout_commitment: test_hash(41),
        output_policy_commitment: policy.row_commitment,
        renderer_schema_commitment: policy.renderer_schema_commitment,
        recipe_commitment: test_hash(42),
        render_commitment: test_hash(43),
        render_blob_id: b"market-fixture-render".to_string(),
        render_sha256: test_hash(44),
        render_blob_commitment: test_hash(45),
        output_commitment: vector[],
        protected: false,
        scope_key: b"".to_string(), asset_key: b"".to_string(),
        seal_id: option::none(), protection_binding_commitment: vector[],
    };
    output.output_commitment = derive_current_output_commitment(&output);
    let economics = maker::root_economics_v8(root);
    let mut receipt = CompleteReceiptV8 {
        id: receipt_uid, version: VERSION, output_id,
        root_id: output.root_id, maker_version: output.maker_version,
        root_content_commitment: output.root_content_commitment,
        output_key: output.output_key,
        original_holder: holder, holder,
        loadout_id: output.loadout_id, loadout_revision: output.loadout_revision,
        loadout_commitment: output.loadout_commitment,
        output_policy_commitment: output.output_policy_commitment,
        renderer_schema_commitment: output.renderer_schema_commitment,
        economics_commitment: *maker::economics_commitment_v8(&economics),
        recipe_commitment: output.recipe_commitment,
        render_commitment: output.render_commitment,
        output_commitment: output.output_commitment,
        base_line, pack_lines: vector[], total_paid_atomic: 0,
        receipt_commitment: vector[], protected: false,
        seal_id: option::none(),
    };
    receipt.receipt_commitment = derive_current_receipt_commitment(&receipt);
    let rights = maker::root_rights_v8(root);
    let mut soul = CanonicalSoulV8 {
        id: object::new(ctx), version: VERSION,
        soul_registry_id: object::id(soul_registry),
        root_id: output.root_id, maker_version: output.maker_version,
        root_content_commitment: output.root_content_commitment,
        output_key: output.output_key,
        output_policy_commitment: output.output_policy_commitment,
        holder, ownership_epoch: 0, output_id, receipt_id,
        recipe_commitment: output.recipe_commitment,
        render_commitment: output.render_commitment,
        output_commitment: output.output_commitment,
        receipt_commitment: receipt.receipt_commitment,
        soul_creator_royalty_bps:
            maker::rights_soul_creator_royalty_bps_v8(&rights),
        maker_source_royalty_bps:
            maker::rights_maker_source_royalty_bps_v8(&rights),
        soul_commitment: vector[],
    };
    soul.soul_commitment = derive_current_soul_commitment(&soul);
    record_finished_output(output_registry, &output, &receipt, object::id(&soul));
    record_soul(soul_registry, &soul);
    assert_live_soul_bundle(
        &output, &receipt, &soul, output_registry, soul_registry, root,
        holder, 0,
    );
    (output, receipt, soul)
}

/// Defining-module transfer bridge for downstream cross-transaction tests.
/// Production exposes no equivalent transfer path.
#[test_only]
public fun transfer_soul_market_bundle_for_testing_v8(
    output: CompleteOutputV8,
    receipt: CompleteReceiptV8,
    soul: CanonicalSoulV8,
) {
    let holder = output.holder;
    assert_exact_holder(holder, holder);
    assert_exact_holder(receipt.holder, holder);
    assert_exact_holder(soul.holder, holder);
    transfer::transfer(output, holder);
    transfer::transfer(receipt, holder);
    transfer::transfer(soul, holder);
}

#[test_only]
public fun destroy_soul_market_bundle_for_testing_v8(
    output: CompleteOutputV8,
    receipt: CompleteReceiptV8,
    soul: CanonicalSoulV8,
) {
    let CompleteOutputV8 {
        id: output_uid, version: _, root_id: _, maker_version: _,
        root_content_commitment: _, output_registry_id: _, output_key: _,
        original_holder: _, holder: _, loadout_id: _, loadout_revision: _,
        loadout_commitment: _, output_policy_commitment: _,
        renderer_schema_commitment: _, recipe_commitment: _,
        render_commitment: _, render_blob_id: _, render_sha256: _,
        render_blob_commitment: _, output_commitment: _, protected: _,
        scope_key: _, asset_key: _, seal_id: _,
        protection_binding_commitment: _,
    } = output;
    let CompleteReceiptV8 {
        id: receipt_uid, version: _, output_id: _, root_id: _, maker_version: _,
        root_content_commitment: _, output_key: _, original_holder: _, holder: _,
        loadout_id: _, loadout_revision: _, loadout_commitment: _,
        output_policy_commitment: _, renderer_schema_commitment: _,
        economics_commitment: _, recipe_commitment: _, render_commitment: _,
        output_commitment: _, base_line: _, pack_lines: _, total_paid_atomic: _,
        receipt_commitment: _, protected: _, seal_id: _,
    } = receipt;
    let CanonicalSoulV8 {
        id: soul_uid, version: _, soul_registry_id: _, root_id: _,
        maker_version: _, root_content_commitment: _, output_key: _,
        output_policy_commitment: _, holder: _, ownership_epoch: _, output_id: _,
        receipt_id: _, recipe_commitment: _, render_commitment: _,
        output_commitment: _, receipt_commitment: _,
        soul_creator_royalty_bps: _, maker_source_royalty_bps: _,
        soul_commitment: _,
    } = soul;
    output_uid.delete();
    receipt_uid.delete();
    soul_uid.delete();
}

#[test_only]
public fun physical_base_selection_binding_for_testing_v8(
    root_id: ID,
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    root_content_commitment: vector<u8>,
    asset_content_commitment: vector<u8>,
): PhysicalSelectionBindingV8 {
    PhysicalSelectionBindingV8 {
        loadout_id: root_id, loadout_revision: 0, loadout_commitment: vector[],
        selection_index: 0, selection_commitment: vector[],
        source_class: runtime::source_base_v8(),
        part_key, item_key, style_key, layer_track_key,
        source_definition_id: root_id, source_semantic_id: b"".to_string(),
        source_content_commitment: root_content_commitment, source_epoch: 0,
        pricing_commitment: vector[], asset_content_commitment,
    }
}

#[test_only]
public fun destroy_output_package_config_for_testing(config: OutputPackageConfigV8) {
    let OutputPackageConfigV8 { id, version: _, catalog_id: _,
        product_binding_commitment: _, output_call_cap } = config;
    id.delete();
    binding::destroy_call_cap_for_testing(output_call_cap)
}

#[test_only]
public fun destroy_registries_for_testing(
    output: OutputRegistryV8,
    souls: SoulRegistryV8,
) {
    let OutputRegistryV8 { id: output_uid, version: _, root_id: _, maker_version: _,
        root_content_commitment: _, renderer_commitment: _, soul_registry_id: _,
        expected_output_count: _, observed_output_count: _,
        expected_policy_commitment: _, rolling_policy_commitment: _, sealed: _,
        mut policy_rows, mut policy_keys, total_complete_count: _,
        mut complete_by_wallet, mut wallet_keys, output_count: _,
        mut outputs, mut output_keys, materialization_count: _,
        mut materializations, mut materialization_keys } = output;
    while (!policy_keys.is_empty()) {
        let key = policy_keys.pop_back();
        let _ = policy_rows.remove(key);
    };
    policy_keys.destroy_empty();
    policy_rows.destroy_empty();
    while (!wallet_keys.is_empty()) {
        let key = wallet_keys.pop_back();
        let _ = complete_by_wallet.remove(key);
    };
    wallet_keys.destroy_empty();
    complete_by_wallet.destroy_empty();
    while (!output_keys.is_empty()) {
        let key = output_keys.pop_back();
        let _ = outputs.remove(key);
    };
    output_keys.destroy_empty();
    outputs.destroy_empty();
    while (!materialization_keys.is_empty()) {
        let key = materialization_keys.pop_back();
        let _ = materializations.remove(key);
    };
    materialization_keys.destroy_empty();
    materializations.destroy_empty();
    output_uid.delete();
    let SoulRegistryV8 { id: soul_uid, version: _, root_id: _, maker_version: _,
        root_content_commitment: _, output_registry_id: _, soul_count: _,
        mut souls, mut soul_keys } = souls;
    while (!soul_keys.is_empty()) {
        let key = soul_keys.pop_back();
        let _ = souls.remove(key);
    };
    soul_keys.destroy_empty();
    souls.destroy_empty();
    soul_uid.delete();
}

#[test_only]
public struct TestMarketOriginalMarkerV8 has drop {}
#[test_only]
public struct TestMarketCallableMarkerV8 has drop {}
#[test_only]
public struct TestMarketRegistryV8 has key { id: UID }
#[test_only]
public struct TestMarketTreasuryV8 has key { id: UID }
#[test_only]
public struct TestDependencyRegistryV8 has key { id: UID }
#[test_only]
public struct TestMarketConfigV8 has key {
    id: UID,
    market_call_cap: PackageCallCapV8<MarketRoleV8>,
}
#[test_only]
public struct TestMarketListingV8 has key {
    id: UID,
    custody: Option<SoulMarketCustodyBindingV8>,
}
#[test_only]
public struct SoulMarketScenarioIdsV8 has copy, drop {
    root_id: ID,
    catalog_id: ID,
    output_registry_id: ID,
    soul_registry_id: ID,
    market_registry_id: ID,
    market_treasury_id: ID,
    market_config_id: ID,
    listing_id: ID,
    output_id: ID,
    receipt_id: ID,
    soul_id: ID,
}

#[test_only]
fun setup_soul_market_scenario(
    scenario: &mut Scenario,
): SoulMarketScenarioIdsV8 {
    let ctx = scenario.ctx();
    let seller = ctx.sender();
    let (mut protocol_config, protocol_treasury, protocol_admin) =
        protocol::new_protocol_with_treasury_for_testing<SUI>(true, ctx);
    let economics = maker::new_economics_snapshot_v8<SUI>(
        &protocol_config, maker::access_free_v8(), 0,
        maker::complete_unlimited_free_v8(), 0, 0, 0,
    );
    let rights = maker::new_onchain_native_rights_snapshot_v8(
        ctx, 250, 250, 500,
    );
    let root_content_commitment = test_hash(51);
    let counts = base::new_base_definition_counts_v8(1, 1, 1, 1, 0, 0);
    let commitments = base::minimal_expected_commitments_for_testing(
        root_content_commitment,
    );
    let clock = sui::clock::create_for_testing(ctx);
    let (mut root, mut base_registry, maker_treasury, admin) =
        core::new_initial_maker_draft_v8<SUI>(
            &protocol_config,
            b"output-market-fixture".to_string(),
            test_hash(52),
            b"output-market-fixture-blob".to_string(),
            test_hash(53),
            root_content_commitment,
            counts,
            commitments,
            test_hash(54),
            economics,
            rights,
            &clock,
            ctx,
        );
    base::populate_and_seal_minimal_for_testing(
        &mut base_registry, &root, &admin,
    );
    let mut catalog = binding::product_release_catalog_with_market_for_testing(
        &protocol_config,
        maker::root_core_original_package_id_v8(&root).to_address(),
        maker::root_core_callable_package_id_v8(&root).to_address(),
        type_name::original_id<TestMarketOriginalMarkerV8>(),
        type_name::defining_id<TestMarketCallableMarkerV8>(),
        ctx,
    );
    let catalog_witness = binding::release_catalog_witness_for_testing(&catalog);
    maker::finalize_product_release_binding_v8(
        &mut root, &admin, &protocol_config, catalog_witness, ctx,
    );
    let release_cap = binding::take_release_call_cap_v8(
        &protocol_config, &protocol_admin, &mut catalog,
    );
    let seal_cap = binding::take_seal_call_cap_v8(
        &protocol_config, &protocol_admin, &mut catalog,
    );
    let runtime_cap = binding::take_runtime_call_cap_v8(
        &protocol_config, &protocol_admin, &mut catalog,
    );
    let output_cap = binding::take_output_call_cap_v8(
        &protocol_config, &protocol_admin, &mut catalog,
    );
    let physical_cap = binding::take_physical_call_cap_v8(
        &protocol_config, &protocol_admin, &mut catalog,
    );
    let market_call_cap = binding::take_market_call_cap_v8(
        &protocol_config, &protocol_admin, &mut catalog,
    );
    let output_key = b"market-png".to_string();
    let schema_commitment = test_hash(55);
    let row_commitment = derive_output_policy_row_commitment_v8(
        &root, 0, output_key, false, b"".to_string(), schema_commitment,
        POLICY_ALL_ADMITTED, vector[],
    );
    let expected_policy_commitment = advance_output_registry_commitment_v8(
        &root, 0, empty_output_registry_commitment_v8(&root), row_commitment,
    );
    let (mut output_registry, soul_registry) = new_output_registries_v8(
        &root, &admin, 1, expected_policy_commitment, ctx,
    );
    append_output_policy_v8(
        &mut output_registry, &root, &admin, 0, output_key, false,
        b"".to_string(), schema_commitment, POLICY_ALL_ADMITTED, vector[],
        row_commitment,
    );
    seal_output_registry_v8(&mut output_registry, &root, &admin);
    let seal_policy = TestDependencyRegistryV8 { id: object::new(ctx) };
    let seal_registry = TestDependencyRegistryV8 { id: object::new(ctx) };
    let runtime_definitions = TestDependencyRegistryV8 { id: object::new(ctx) };
    let pack_registry = TestDependencyRegistryV8 { id: object::new(ctx) };
    let admission_authority = TestDependencyRegistryV8 { id: object::new(ctx) };
    let physical_registry = TestDependencyRegistryV8 { id: object::new(ctx) };
    let market_registry = TestMarketRegistryV8 { id: object::new(ctx) };
    let market_treasury = TestMarketTreasuryV8 { id: object::new(ctx) };
    let (seal_ready, runtime_ready, output_ready, physical_ready, market_ready) =
        activation::readiness_set_for_testing(
            &root, &catalog, &seal_policy, &seal_registry,
            &runtime_definitions, &pack_registry, &admission_authority,
            &output_registry, &soul_registry, &physical_registry,
            &market_registry, &market_treasury,
        );
    activation::activate_maker_for_testing(
        &mut root, &admin, &protocol_config, &catalog, &base_registry,
        &maker_treasury, &protocol_treasury, &release_cap,
        seal_ready, runtime_ready, output_ready, physical_ready, market_ready,
        ctx,
    );
    binding::destroy_call_cap_for_testing(release_cap);
    binding::destroy_call_cap_for_testing(seal_cap);
    binding::destroy_call_cap_for_testing(runtime_cap);
    binding::destroy_call_cap_for_testing(output_cap);
    binding::destroy_call_cap_for_testing(physical_cap);
    let mut soul_registry = soul_registry;
    let (output, receipt, soul) = new_soul_market_bundle_for_testing_v8(
        &mut output_registry, &mut soul_registry, &root, seller, ctx,
    );
    let market_config = TestMarketConfigV8 {
        id: object::new(ctx), market_call_cap,
    };
    let mut listing = TestMarketListingV8 {
        id: object::new(ctx), custody: option::none(),
    };
    let output_id = object::id(&output);
    let receipt_id = object::id(&receipt);
    let soul_id = object::id(&soul);
    let ticket = custody_soul_bundle_for_market_v8<
        SUI,
        TestMarketOriginalMarkerV8,
        TestMarketCallableMarkerV8,
        TestMarketRegistryV8,
        TestMarketTreasuryV8,
    >(
        output, receipt, soul, &mut listing.id, &output_registry,
        &soul_registry, &root, &protocol_config, &catalog, &market_registry,
        &market_treasury, &market_config.market_call_cap, ctx,
    );
    let custody = consume_soul_market_custody_ticket_v8<
        SUI,
        TestMarketOriginalMarkerV8,
        TestMarketCallableMarkerV8,
        TestMarketRegistryV8,
        TestMarketTreasuryV8,
    >(
        ticket, &listing.id, &output_registry, &soul_registry, &root,
        &catalog, &market_registry, &market_treasury,
        &market_config.market_call_cap,
    );
    listing.custody.fill(custody);
    let ids = SoulMarketScenarioIdsV8 {
        root_id: object::id(&root),
        catalog_id: object::id(&catalog),
        output_registry_id: object::id(&output_registry),
        soul_registry_id: object::id(&soul_registry),
        market_registry_id: object::id(&market_registry),
        market_treasury_id: object::id(&market_treasury),
        market_config_id: object::id(&market_config),
        listing_id: object::id(&listing),
        output_id,
        receipt_id,
        soul_id,
    };
    clock.destroy_for_testing();
    protocol::set_protocol_enabled_v8(
        &mut protocol_config, &protocol_admin, false,
    );
    protocol::destroy_protocol_with_treasury_for_testing(
        protocol_config, protocol_treasury, protocol_admin,
    );
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_draft_v8());
    core::share_maker_draft_v8(
        root, base_registry, maker_treasury, admin, ctx,
    );
    binding::share_product_release_catalog_v8(catalog);
    share_output_registries_v8(output_registry, soul_registry);
    transfer::share_object(seal_policy);
    transfer::share_object(seal_registry);
    transfer::share_object(runtime_definitions);
    transfer::share_object(pack_registry);
    transfer::share_object(admission_authority);
    transfer::share_object(physical_registry);
    transfer::share_object(market_registry);
    transfer::share_object(market_treasury);
    transfer::share_object(market_config);
    transfer::share_object(listing);
    ids
}

#[test_only]
fun test_hash(byte: u8): vector<u8> {
    let mut value = vector[];
    let mut index = 0;
    while (index < HASH_LENGTH) {
        value.push_back(byte);
        index = index + 1;
    };
    value
}

#[test_only]
fun test_registries(
    policy: u8,
    allowed: vector<String>,
    ctx: &mut TxContext,
): (OutputRegistryV8, SoulRegistryV8) {
    validate_allowed_pack_policy(policy, &allowed);
    let output_uid = object::new(ctx);
    let output_registry_id = output_uid.to_inner();
    let soul_uid = object::new(ctx);
    let soul_registry_id = soul_uid.to_inner();
    let output_key = b"png".to_string();
    let key = OutputPolicyKeyV8 { output_key };
    let mut policy_rows = table::new(ctx);
    policy_rows.add(key, OutputPolicyRowV8 {
        sequence: 0, output_key, protected_output: false,
        complete_scope_key: b"".to_string(),
        renderer_schema_commitment: test_hash(4),
        allowed_pack_policy: policy, allowed_semantic_pack_ids: allowed,
        row_commitment: test_hash(3),
    });
    (
        OutputRegistryV8 {
            id: output_uid, version: VERSION,
            root_id: object::id_from_address(@0x10), maker_version: 1,
            root_content_commitment: test_hash(1),
            renderer_commitment: test_hash(2), soul_registry_id,
            expected_output_count: 1, observed_output_count: 1,
            expected_policy_commitment: test_hash(5),
            rolling_policy_commitment: test_hash(5), sealed: true,
            policy_rows, policy_keys: vector[key], total_complete_count: 0,
            complete_by_wallet: table::new(ctx), wallet_keys: vector[],
            output_count: 0, outputs: table::new(ctx), output_keys: vector[],
            materialization_count: 0, materializations: table::new(ctx),
            materialization_keys: vector[],
        },
        SoulRegistryV8 {
            id: soul_uid, version: VERSION,
            root_id: object::id_from_address(@0x10), maker_version: 1,
            root_content_commitment: test_hash(1), output_registry_id,
            soul_count: 0, souls: table::new(ctx), soul_keys: vector[],
        },
    )
}

#[test_only]
fun test_draft_registries(
    expected_count: u64,
    expected_commitment: vector<u8>,
    ctx: &mut TxContext,
): (OutputRegistryV8, SoulRegistryV8) {
    let output_uid = object::new(ctx);
    let output_registry_id = output_uid.to_inner();
    let soul_uid = object::new(ctx);
    let soul_registry_id = soul_uid.to_inner();
    (
        OutputRegistryV8 {
            id: output_uid, version: VERSION,
            root_id: object::id_from_address(@0x10), maker_version: 1,
            root_content_commitment: test_hash(1),
            renderer_commitment: test_hash(2), soul_registry_id,
            expected_output_count: expected_count, observed_output_count: 0,
            expected_policy_commitment: expected_commitment,
            rolling_policy_commitment: test_hash(7), sealed: false,
            policy_rows: table::new(ctx), policy_keys: vector[],
            total_complete_count: 0,
            complete_by_wallet: table::new(ctx), wallet_keys: vector[],
            output_count: 0, outputs: table::new(ctx), output_keys: vector[],
            materialization_count: 0, materializations: table::new(ctx),
            materialization_keys: vector[],
        },
        SoulRegistryV8 {
            id: soul_uid, version: VERSION,
            root_id: object::id_from_address(@0x10), maker_version: 1,
            root_content_commitment: test_hash(1), output_registry_id,
            soul_count: 0, souls: table::new(ctx), soul_keys: vector[],
        },
    )
}

#[test_only]
fun test_append_policy(
    registry: &mut OutputRegistryV8,
    sequence: u64,
    key: vector<u8>,
    protected: bool,
    policy: u8,
    allowed: vector<String>,
    row_hash: u8,
    next_hash: u8,
) {
    append_policy_row(
        registry, sequence, string::utf8(key), protected,
        if (protected) b"complete/protected".to_string() else b"".to_string(),
        test_hash(row_hash), policy, allowed, test_hash(row_hash),
        test_hash(next_hash))
}

#[test_only]
fun test_pack_line(id: address, semantic: vector<u8>, content: u8): PackPaymentLineV8 {
    PackPaymentLineV8 {
        release_id: object::id_from_address(id),
        semantic_pack_id: string::utf8(semantic),
        release_content_commitment: test_hash(content), ordinal: 0,
        gross_atomic: 100, protocol_atomic: 10, pack_atomic: 90,
    }
}

#[test_only]
fun test_derived_pack(id: address, semantic: vector<u8>, content: u8): DerivedPackBindingV8 {
    DerivedPackBindingV8 {
        release_id: object::id_from_address(id),
        semantic_pack_id: string::utf8(semantic),
        release_content_commitment: test_hash(content),
        pricing_commitment: test_hash(content + 10),
    }
}

#[test_only]
fun test_physical_bindings(): (PhysicalCompleteBindingV8, PhysicalSelectionBindingV8) {
    (
        PhysicalCompleteBindingV8 {
            output_registry_id: object::id_from_address(@0x11),
            root_id: object::id_from_address(@0x10), maker_version: 1,
            root_content_commitment: test_hash(1), holder: @0xA11,
            output_key: b"png".to_string(),
            output_policy_commitment: test_hash(2),
            output_id: object::id_from_address(@0x12),
            receipt_id: object::id_from_address(@0x13),
            soul_id: object::id_from_address(@0x14), soul_ownership_epoch: 0,
            recipe_commitment: test_hash(3), render_commitment: test_hash(4),
            output_commitment: test_hash(5), receipt_commitment: test_hash(6),
            soul_commitment: test_hash(7),
        },
        PhysicalSelectionBindingV8 {
            loadout_id: object::id_from_address(@0x15), loadout_revision: 2,
            loadout_commitment: test_hash(8), selection_index: 0,
            selection_commitment: test_hash(9),
            part_key: b"part".to_string(), item_key: b"item".to_string(),
            style_key: b"style".to_string(), layer_track_key: b"track".to_string(),
            source_class: runtime::source_pack_v8(),
            source_definition_id: object::id_from_address(@0x16),
            source_semantic_id: b"pack".to_string(),
            source_content_commitment: test_hash(10), source_epoch: 0,
            pricing_commitment: test_hash(11), asset_content_commitment: test_hash(12),
        },
    )
}

#[test_only]
fun test_protected_artifacts(ctx: &mut TxContext): (CompleteOutputV8, CompleteReceiptV8) {
    let output_uid = object::new(ctx);
    let output_id = output_uid.to_inner();
    let receipt_uid = object::new(ctx);
    let base_line = BaseCompleteLineV8 {
        ordinal: 0, base_gross_atomic: 0, base_protocol_atomic: 0,
        maker_atomic: 0, fixed_protocol_atomic: 0, total_atomic: 0,
    };
    let output = CompleteOutputV8 {
        id: output_uid, version: VERSION, root_id: object::id_from_address(@0x10),
        maker_version: 1, root_content_commitment: test_hash(1),
        output_registry_id: object::id_from_address(@0x11),
        output_key: b"png".to_string(), original_holder: @0xA11,
        holder: @0xA11,
        loadout_id: object::id_from_address(@0x12), loadout_revision: 3,
        loadout_commitment: test_hash(2), output_policy_commitment: test_hash(3),
        renderer_schema_commitment: test_hash(12),
        recipe_commitment: test_hash(4), render_commitment: test_hash(5),
        render_blob_id: b"ciphertext".to_string(), render_sha256: test_hash(6),
        render_blob_commitment: test_hash(7), output_commitment: test_hash(8),
        protected: true, scope_key: b"complete/png".to_string(),
        asset_key: b"receipt/one".to_string(), seal_id: option::none(),
        protection_binding_commitment: vector[],
    };
    let receipt = CompleteReceiptV8 {
        id: receipt_uid, version: VERSION, output_id,
        root_id: object::id_from_address(@0x10), maker_version: 1,
        root_content_commitment: test_hash(1), output_key: b"png".to_string(),
        original_holder: @0xA11, holder: @0xA11,
        loadout_id: object::id_from_address(@0x12), loadout_revision: 3,
        loadout_commitment: test_hash(2), output_policy_commitment: test_hash(3),
        renderer_schema_commitment: test_hash(12),
        economics_commitment: test_hash(9), recipe_commitment: test_hash(4),
        render_commitment: test_hash(5), output_commitment: test_hash(8),
        base_line, pack_lines: vector[], total_paid_atomic: 0,
        receipt_commitment: test_hash(10), protected: true,
        seal_id: option::none(),
    };
    (output, receipt)
}

#[test]
fun all_four_complete_modes_quote_exactly() {
    assert!(complete_price_for_ordinal(maker::complete_unlimited_free_v8(), 0, 0, 99) == 0,
        EInvalidPolicy);
    assert!(complete_price_for_ordinal(maker::complete_free_quota_then_paid_v8(), 25, 2, 0) == 0,
        EInvalidPolicy);
    assert!(complete_price_for_ordinal(maker::complete_free_quota_then_paid_v8(), 25, 2, 2) == 25,
        EInvalidPolicy);
    assert!(complete_price_for_ordinal(maker::complete_paid_every_time_v8(), 25, 0, 0) == 25,
        EInvalidPolicy);
    assert!(complete_price_for_ordinal(maker::complete_free_quota_then_block_v8(), 0, 2, 1) == 0,
        EInvalidPolicy);
}

#[test, expected_failure(abort_code = ECompleteBlocked)]
fun free_quota_then_block_has_no_paid_tail() {
    complete_price_for_ordinal(maker::complete_free_quota_then_block_v8(), 0, 2, 2);
    abort ECompleteBlocked
}

#[test]
fun all_and_sorted_allowlist_are_the_only_static_policies() {
    validate_allowed_pack_policy(POLICY_ALL_ADMITTED, &vector[]);
    validate_allowed_pack_policy(POLICY_ALLOWLIST,
        &vector[b"alpha".to_string(), b"omega".to_string()]);
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun all_admitted_rejects_frozen_player_pack_selection() {
    validate_allowed_pack_policy(POLICY_ALL_ADMITTED,
        &vector[b"not-a-selection".to_string()]);
    abort EInvalidPolicy
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun allowlist_rejects_duplicate_semantic_pack_ids() {
    validate_allowed_pack_policy(POLICY_ALLOWLIST,
        &vector[b"same".to_string(), b"same".to_string()]);
    abort EInvalidPolicy
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun allowlist_rejects_unsorted_semantic_pack_ids() {
    validate_allowed_pack_policy(POLICY_ALLOWLIST,
        &vector[b"zeta".to_string(), b"alpha".to_string()]);
    abort EInvalidPolicy
}

#[test]
fun two_output_rows_seal_in_exact_sequence() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 120, 0, 0, 0);
    let (mut output, souls) = test_draft_registries(2, test_hash(9), &mut ctx);
    test_append_policy(&mut output, 0, b"png", false,
        POLICY_ALL_ADMITTED, vector[], 3, 8);
    test_append_policy(&mut output, 1, b"svg", true,
        POLICY_ALLOWLIST, vector[b"alpha".to_string()], 4, 9);
    seal_policy_rows(&mut output);
    assert!(output.sealed && output.observed_output_count == 2, EInvalidBinding);
    assert!(borrow_policy(&output, b"png".to_string()).sequence == 0,
        EInvalidBinding);
    assert!(borrow_policy(&output, b"svg".to_string()).sequence == 1,
        EInvalidBinding);
    destroy_registries_for_testing(output, souls)
}

#[test]
fun zero_output_rows_use_explicit_empty_commitment_and_are_ready() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 121, 0, 0, 0);
    let (mut output, souls) = test_draft_registries(0, test_hash(7), &mut ctx);
    seal_policy_rows(&mut output);
    assert_registry_ready(&output, &souls);
    destroy_registries_for_testing(output, souls)
}

#[test, expected_failure(abort_code = EInvalidSequence)]
fun output_rows_reject_out_of_order_sequence() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 122, 0, 0, 0);
    let (mut output, _souls) = test_draft_registries(2, test_hash(9), &mut ctx);
    test_append_policy(&mut output, 1, b"svg", false,
        POLICY_ALL_ADMITTED, vector[], 3, 8);
    abort EInvalidSequence
}

#[test, expected_failure(abort_code = EDuplicate)]
fun output_rows_reject_duplicate_output_key() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 123, 0, 0, 0);
    let (mut output, _souls) = test_draft_registries(2, test_hash(9), &mut ctx);
    test_append_policy(&mut output, 0, b"png", false,
        POLICY_ALL_ADMITTED, vector[], 3, 8);
    test_append_policy(&mut output, 1, b"png", false,
        POLICY_ALL_ADMITTED, vector[], 4, 9);
    abort EDuplicate
}

#[test, expected_failure(abort_code = EInvalidConfig)]
fun output_rows_reject_seal_at_wrong_count() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 124, 0, 0, 0);
    let (mut output, _souls) = test_draft_registries(2, test_hash(9), &mut ctx);
    test_append_policy(&mut output, 0, b"png", false,
        POLICY_ALL_ADMITTED, vector[], 3, 8);
    seal_policy_rows(&mut output);
    abort EInvalidConfig
}

#[test, expected_failure(abort_code = EInvalidCommitment)]
fun output_rows_reject_wrong_row_hash() {
    assert_row_commitment(&test_hash(3), &test_hash(4));
    abort EInvalidCommitment
}

#[test, expected_failure(abort_code = EInvalidCommitment)]
fun output_rows_reject_wrong_final_hash() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 125, 0, 0, 0);
    let (mut output, _souls) = test_draft_registries(1, test_hash(9), &mut ctx);
    test_append_policy(&mut output, 0, b"png", false,
        POLICY_ALL_ADMITTED, vector[], 3, 8);
    seal_policy_rows(&mut output);
    abort EInvalidCommitment
}

#[test, expected_failure(abort_code = ERegistrySealed)]
fun output_rows_reject_append_after_seal() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 126, 0, 0, 0);
    let (mut output, _souls) = test_draft_registries(1, test_hash(8), &mut ctx);
    test_append_policy(&mut output, 0, b"png", false,
        POLICY_ALL_ADMITTED, vector[], 3, 8);
    seal_policy_rows(&mut output);
    test_append_policy(&mut output, 1, b"svg", false,
        POLICY_ALL_ADMITTED, vector[], 4, 9);
    abort ERegistrySealed
}

#[test]
fun fixed_fee_is_a_distinct_protocol_line() {
    let base = 100;
    let primary = protocol_share(base, 1_000);
    let fixed = 7;
    assert!(primary == 10, EWrongPayment);
    assert!(base - primary == 90, EWrongPayment);
    assert!(base + fixed == 107, EWrongPayment);
}

#[test]
fun explicit_zero_output_and_soul_rows_are_valid() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 100, 0, 0, 0);
    let (output, souls) = test_registries(POLICY_ALL_ADMITTED, vector[], &mut ctx);
    assert!(output.output_count == 0 && souls.soul_count == 0, EInvalidBinding);
    assert!(output.total_complete_count == 0 && output.wallet_keys.is_empty(), EInvalidBinding);
    assert!(output.materialization_count == 0
        && output.materialization_keys.is_empty(), EInvalidBinding);
    destroy_registries_for_testing(output, souls)
}

#[test]
fun physical_witness_commitment_binds_output_policy_and_current_selection() {
    let (complete, selection) = test_physical_bindings();
    let one = derive_physical_witness_commitment(
        complete.output_registry_id, complete, selection, b"print-1".to_string());
    let mut other_output = complete;
    other_output.output_key = b"svg".to_string();
    let two = derive_physical_witness_commitment(
        complete.output_registry_id, other_output, selection, b"print-1".to_string());
    let mut other_selection = selection;
    other_selection.selection_commitment = test_hash(99);
    let three = derive_physical_witness_commitment(
        complete.output_registry_id, complete, other_selection, b"print-1".to_string());
    let mut other_keys = selection;
    other_keys.part_key = b"other-part".to_string();
    let four = derive_physical_witness_commitment(
        complete.output_registry_id, complete, other_keys, b"print-1".to_string());
    let mut other_item = selection;
    other_item.item_key = b"other-item".to_string();
    let five = derive_physical_witness_commitment(
        complete.output_registry_id, complete, other_item, b"print-1".to_string());
    let mut other_style = selection;
    other_style.style_key = b"other-style".to_string();
    let six = derive_physical_witness_commitment(
        complete.output_registry_id, complete, other_style, b"print-1".to_string());
    let mut other_track = selection;
    other_track.layer_track_key = b"other-track".to_string();
    let seven = derive_physical_witness_commitment(
        complete.output_registry_id, complete, other_track, b"print-1".to_string());
    assert!(one != two && one != three && one != four && one != five
        && one != six && one != seven, EInvalidCommitment)
}

#[test, expected_failure(abort_code = EDuplicate)]
fun materialization_key_is_unique_per_soul() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 127, 0, 0, 0);
    let (mut output, _souls) = test_registries(POLICY_ALL_ADMITTED, vector[], &mut ctx);
    let key = MaterializationKeyV8 {
        soul_id: object::id_from_address(@0x14),
        materialization_key: b"print-1".to_string(),
    };
    reserve_materialization(&mut output, key, test_hash(1));
    reserve_materialization(&mut output, key, test_hash(2));
    abort EDuplicate
}

#[test]
fun base_counter_tracks_wallet_and_total_without_public_mutator() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 101, 0, 0, 0);
    let (mut output, souls) = test_registries(POLICY_ALL_ADMITTED, vector[], &mut ctx);
    mutate_base_counter(&mut output, @0xA11, 0);
    mutate_base_counter(&mut output, @0xA11, 1);
    mutate_base_counter(&mut output, @0xB0B, 0);
    assert!(output.total_complete_count == 3, EInvalidBinding);
    assert!(output_registry_wallet_complete_count_v8(&output, @0xA11) == 2,
        EInvalidBinding);
    assert!(output_registry_wallet_complete_count_v8(&output, @0xB0B) == 1,
        EInvalidBinding);
    destroy_registries_for_testing(output, souls)
}

#[test]
fun zero_total_cap_is_unbounded() {
    assert_total_cap(0xffffffffffffffff, 0)
}

#[test]
fun output_paths_require_active_lifecycle_and_exact_holder() {
    assert_active_lifecycle(maker::lifecycle_active_v8());
    assert_exact_holder(@0xA11, @0xA11)
}

#[test, expected_failure(abort_code = EInvalidLifecycle)]
fun output_paths_reject_draft_lifecycle() {
    assert_active_lifecycle(maker::lifecycle_draft_v8());
    abort EInvalidLifecycle
}

#[test, expected_failure(abort_code = EWrongHolder)]
fun output_paths_reject_cross_holder() {
    assert_exact_holder(@0xA11, @0xB0B);
    abort EWrongHolder
}

#[test]
fun market_return_cross_transaction_survives_archived_root_and_config_drift() {
    let seller = @0xA11;
    let mut scenario = test_scenario::begin(seller);
    let ids = setup_soul_market_scenario(&mut scenario);
    scenario.next_tx(seller);
    {
        let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let catalog = scenario.take_shared_by_id<ProductReleaseCatalogV8>(ids.catalog_id);
        let output_registry = scenario.take_shared_by_id<OutputRegistryV8>(
            ids.output_registry_id,
        );
        let soul_registry = scenario.take_shared_by_id<SoulRegistryV8>(
            ids.soul_registry_id,
        );
        let market_registry = scenario.take_shared_by_id<TestMarketRegistryV8>(
            ids.market_registry_id,
        );
        let market_treasury = scenario.take_shared_by_id<TestMarketTreasuryV8>(
            ids.market_treasury_id,
        );
        let market_config = scenario.take_shared_by_id<TestMarketConfigV8>(
            ids.market_config_id,
        );
        let mut listing = scenario.take_shared_by_id<TestMarketListingV8>(
            ids.listing_id,
        );
        maker::set_lifecycle_for_testing(
            &mut root, maker::lifecycle_archived_v8(),
        );
        let output_receiving = test_scenario::receiving_ticket_by_id<
            CompleteOutputV8,
        >(ids.output_id);
        let receipt_receiving = test_scenario::receiving_ticket_by_id<
            CompleteReceiptV8,
        >(ids.receipt_id);
        let soul_receiving = test_scenario::receiving_ticket_by_id<
            CanonicalSoulV8,
        >(ids.soul_id);
        let custody = *listing.custody.borrow();
        return_soul_bundle_from_market_v8<
            SUI,
            TestMarketOriginalMarkerV8,
            TestMarketCallableMarkerV8,
            TestMarketRegistryV8,
            TestMarketTreasuryV8,
        >(
            output_receiving, receipt_receiving, soul_receiving,
            &mut listing.id, &custody, &output_registry,
            &soul_registry, &root, &catalog, &market_registry,
            &market_treasury, &market_config.market_call_cap,
        );
        test_scenario::return_shared(root);
        test_scenario::return_shared(catalog);
        test_scenario::return_shared(output_registry);
        test_scenario::return_shared(soul_registry);
        test_scenario::return_shared(market_registry);
        test_scenario::return_shared(market_treasury);
        test_scenario::return_shared(market_config);
        test_scenario::return_shared(listing);
    };
    scenario.next_tx(seller);
    {
        let output = scenario.take_from_sender_by_id<CompleteOutputV8>(ids.output_id);
        let receipt = scenario.take_from_sender_by_id<CompleteReceiptV8>(
            ids.receipt_id,
        );
        let soul = scenario.take_from_sender_by_id<CanonicalSoulV8>(ids.soul_id);
        assert!(output.holder == seller && receipt.holder == seller
            && soul.holder == seller, EWrongHolder);
        assert!(output.original_holder == seller
            && receipt.original_holder == seller, EWrongHolder);
        assert!(soul.ownership_epoch == 0, EOwnershipEpochMismatch);
        assert!(derive_current_output_commitment(&output)
            == output.output_commitment, EInvalidCommitment);
        assert!(derive_current_receipt_commitment(&receipt)
            == receipt.receipt_commitment, EInvalidCommitment);
        assert!(derive_current_soul_commitment(&soul)
            == soul.soul_commitment, EInvalidCommitment);
        transfer_soul_market_bundle_for_testing_v8(output, receipt, soul);
    };
    scenario.next_tx(seller);
    {
        let output = scenario.take_from_sender_by_id<CompleteOutputV8>(ids.output_id);
        let receipt = scenario.take_from_sender_by_id<CompleteReceiptV8>(
            ids.receipt_id,
        );
        let soul = scenario.take_from_sender_by_id<CanonicalSoulV8>(ids.soul_id);
        destroy_soul_market_bundle_for_testing_v8(output, receipt, soul);
    };
    scenario.end();
}

#[test]
fun market_purchase_cross_transaction_updates_only_ownership_state() {
    let seller = @0xA11;
    let buyer = @0xB0B;
    let mut scenario = test_scenario::begin(seller);
    let ids = setup_soul_market_scenario(&mut scenario);
    let original_output_commitment;
    let original_receipt_commitment;
    let original_soul_commitment;
    scenario.next_tx(buyer);
    {
        let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
        let mut output_registry = scenario.take_shared_by_id<OutputRegistryV8>(
            ids.output_registry_id,
        );
        let mut soul_registry = scenario.take_shared_by_id<SoulRegistryV8>(
            ids.soul_registry_id,
        );
        let mut listing = scenario.take_shared_by_id<TestMarketListingV8>(
            ids.listing_id,
        );
        maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
        let custody = *listing.custody.borrow();
        original_output_commitment = custody.output_commitment;
        original_receipt_commitment = custody.receipt_commitment;
        original_soul_commitment = custody.soul_commitment;
        purchase_received_soul_bundle(
            test_scenario::receiving_ticket_by_id<CompleteOutputV8>(ids.output_id),
            test_scenario::receiving_ticket_by_id<CompleteReceiptV8>(ids.receipt_id),
            test_scenario::receiving_ticket_by_id<CanonicalSoulV8>(ids.soul_id),
            &mut listing.id, &custody, &mut output_registry,
            &mut soul_registry, &root, buyer,
        );
        let output_record = output_registry.outputs.borrow(ids.output_id);
        let soul_record = soul_registry.souls.borrow(ids.soul_id);
        assert!(output_record.holder == buyer, EWrongHolder);
        assert!(soul_record.holder == buyer && soul_record.ownership_epoch == 1,
            EOwnershipEpochMismatch);
        assert!(soul_record.soul_commitment != original_soul_commitment,
            EInvalidCommitment);
        test_scenario::return_shared(root);
        test_scenario::return_shared(output_registry);
        test_scenario::return_shared(soul_registry);
        test_scenario::return_shared(listing);
    };
    scenario.next_tx(buyer);
    {
        let output = scenario.take_from_sender_by_id<CompleteOutputV8>(ids.output_id);
        let receipt = scenario.take_from_sender_by_id<CompleteReceiptV8>(
            ids.receipt_id,
        );
        let soul = scenario.take_from_sender_by_id<CanonicalSoulV8>(ids.soul_id);
        assert!(output.original_holder == seller
            && receipt.original_holder == seller, EWrongHolder);
        assert!(output.holder == buyer && receipt.holder == buyer
            && soul.holder == buyer, EWrongHolder);
        assert!(output.output_commitment == original_output_commitment
            && receipt.receipt_commitment == original_receipt_commitment,
            EInvalidCommitment);
        assert!(soul.ownership_epoch == 1
            && soul.soul_commitment != original_soul_commitment,
            EOwnershipEpochMismatch);
        assert!(derive_current_output_commitment(&output)
            == output.output_commitment, EInvalidCommitment);
        assert!(derive_current_receipt_commitment(&receipt)
            == receipt.receipt_commitment, EInvalidCommitment);
        assert!(derive_current_soul_commitment(&soul)
            == soul.soul_commitment, EInvalidCommitment);
        destroy_soul_market_bundle_for_testing_v8(output, receipt, soul);
    };
    scenario.end();
}

#[test, expected_failure(abort_code = ESelfPurchase)]
fun market_purchase_rejects_seller_as_buyer_before_receiving() {
    let seller = @0xA11;
    let mut scenario = test_scenario::begin(seller);
    let ids = setup_soul_market_scenario(&mut scenario);
    scenario.next_tx(seller);
    let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let mut output_registry = scenario.take_shared_by_id<OutputRegistryV8>(
        ids.output_registry_id,
    );
    let mut soul_registry = scenario.take_shared_by_id<SoulRegistryV8>(
        ids.soul_registry_id,
    );
    let mut listing = scenario.take_shared_by_id<TestMarketListingV8>(ids.listing_id);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let custody = *listing.custody.borrow();
    purchase_received_soul_bundle(
        test_scenario::receiving_ticket_by_id<CompleteOutputV8>(ids.output_id),
        test_scenario::receiving_ticket_by_id<CompleteReceiptV8>(ids.receipt_id),
        test_scenario::receiving_ticket_by_id<CanonicalSoulV8>(ids.soul_id),
        &mut listing.id, &custody, &mut output_registry,
        &mut soul_registry, &root, seller,
    );
    abort ESelfPurchase
}

#[test, expected_failure(abort_code = EOwnershipEpochMismatch)]
fun market_purchase_rejects_stale_expected_epoch_atomically() {
    let seller = @0xA11;
    let buyer = @0xB0B;
    let mut scenario = test_scenario::begin(seller);
    let ids = setup_soul_market_scenario(&mut scenario);
    scenario.next_tx(buyer);
    let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let mut output_registry = scenario.take_shared_by_id<OutputRegistryV8>(
        ids.output_registry_id,
    );
    let mut soul_registry = scenario.take_shared_by_id<SoulRegistryV8>(
        ids.soul_registry_id,
    );
    let mut listing = scenario.take_shared_by_id<TestMarketListingV8>(ids.listing_id);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let mut stale = *listing.custody.borrow();
    stale.expected_soul_ownership_epoch = 1;
    purchase_received_soul_bundle(
        test_scenario::receiving_ticket_by_id<CompleteOutputV8>(ids.output_id),
        test_scenario::receiving_ticket_by_id<CompleteReceiptV8>(ids.receipt_id),
        test_scenario::receiving_ticket_by_id<CanonicalSoulV8>(ids.soul_id),
        &mut listing.id, &stale, &mut output_registry,
        &mut soul_registry, &root, buyer,
    );
    abort EOwnershipEpochMismatch
}

#[test, expected_failure(abort_code = EWrongReceiving)]
fun market_purchase_rejects_wrong_expected_receiving_id_atomically() {
    let seller = @0xA11;
    let buyer = @0xB0B;
    let mut scenario = test_scenario::begin(seller);
    let ids = setup_soul_market_scenario(&mut scenario);
    scenario.next_tx(buyer);
    let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let mut output_registry = scenario.take_shared_by_id<OutputRegistryV8>(
        ids.output_registry_id,
    );
    let mut soul_registry = scenario.take_shared_by_id<SoulRegistryV8>(
        ids.soul_registry_id,
    );
    let mut listing = scenario.take_shared_by_id<TestMarketListingV8>(ids.listing_id);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let mut wrong = *listing.custody.borrow();
    wrong.output_id = object::id_from_address(@0xBAD);
    purchase_received_soul_bundle(
        test_scenario::receiving_ticket_by_id<CompleteOutputV8>(ids.output_id),
        test_scenario::receiving_ticket_by_id<CompleteReceiptV8>(ids.receipt_id),
        test_scenario::receiving_ticket_by_id<CanonicalSoulV8>(ids.soul_id),
        &mut listing.id, &wrong, &mut output_registry,
        &mut soul_registry, &root, buyer,
    );
    abort EWrongReceiving
}

#[test, expected_failure(abort_code = EInvalidCommitment)]
fun market_purchase_rejects_stale_commitment_atomically() {
    let seller = @0xA11;
    let buyer = @0xB0B;
    let mut scenario = test_scenario::begin(seller);
    let ids = setup_soul_market_scenario(&mut scenario);
    scenario.next_tx(buyer);
    let mut root = scenario.take_shared_by_id<MakerRootV8<SUI>>(ids.root_id);
    let mut output_registry = scenario.take_shared_by_id<OutputRegistryV8>(
        ids.output_registry_id,
    );
    let mut soul_registry = scenario.take_shared_by_id<SoulRegistryV8>(
        ids.soul_registry_id,
    );
    let mut listing = scenario.take_shared_by_id<TestMarketListingV8>(ids.listing_id);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let mut stale = *listing.custody.borrow();
    stale.output_commitment = test_hash(99);
    purchase_received_soul_bundle(
        test_scenario::receiving_ticket_by_id<CompleteOutputV8>(ids.output_id),
        test_scenario::receiving_ticket_by_id<CompleteReceiptV8>(ids.receipt_id),
        test_scenario::receiving_ticket_by_id<CanonicalSoulV8>(ids.soul_id),
        &mut listing.id, &stale, &mut output_registry,
        &mut soul_registry, &root, buyer,
    );
    abort EInvalidCommitment
}

#[test, expected_failure(abort_code = EInvalidLifecycle)]
fun readiness_rejects_nonzero_complete_counter() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 128, 0, 0, 0);
    let (mut output, souls) = test_draft_registries(0, test_hash(7), &mut ctx);
    seal_policy_rows(&mut output);
    mutate_base_counter(&mut output, @0xA11, 0);
    assert_registry_ready(&output, &souls);
    abort EInvalidLifecycle
}

#[test, expected_failure(abort_code = ERegistryNotSealed)]
fun readiness_rejects_unsealed_output_registry() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 129, 0, 0, 0);
    let (output, souls) = test_draft_registries(0, test_hash(7), &mut ctx);
    assert_registry_ready(&output, &souls);
    abort ERegistryNotSealed
}

#[test, expected_failure(abort_code = ECompleteBlocked)]
fun total_cap_blocks_exact_boundary() {
    assert_total_cap(2, 2);
    abort ECompleteBlocked
}

#[test]
fun runtime_derived_pack_lines_match_zero_and_ordered_rows() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 102, 0, 0, 0);
    let (output, souls) = test_registries(POLICY_ALL_ADMITTED, vector[], &mut ctx);
    let policy = borrow_policy(&output, b"png".to_string());
    assert_exact_pack_bindings(policy, &vector[], &vector[]);
    let lines = vector[
        test_pack_line(@0x21, b"alpha", 1),
        test_pack_line(@0x22, b"omega", 2),
    ];
    let derived = vector[
        test_derived_pack(@0x21, b"alpha", 1),
        test_derived_pack(@0x22, b"omega", 2),
    ];
    assert_exact_pack_bindings(policy, &lines, &derived);
    destroy_registries_for_testing(output, souls)
}

#[test, expected_failure(abort_code = EPackMismatch)]
fun missing_runtime_derived_pack_line_aborts_finish() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 103, 0, 0, 0);
    let (output, _souls) = test_registries(POLICY_ALL_ADMITTED, vector[], &mut ctx);
    assert_exact_pack_bindings(borrow_policy(&output, b"png".to_string()), &vector[],
        &vector[test_derived_pack(@0x21, b"alpha", 1)]);
    abort EPackMismatch
}

#[test, expected_failure(abort_code = EPackMismatch)]
fun duplicate_pack_settlement_line_aborts_finish() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 104, 0, 0, 0);
    let (output, _souls) = test_registries(POLICY_ALL_ADMITTED, vector[], &mut ctx);
    let line = test_pack_line(@0x21, b"alpha", 1);
    assert_exact_pack_bindings(borrow_policy(&output, b"png".to_string()), &vector[line, line],
        &vector[test_derived_pack(@0x21, b"alpha", 1)]);
    abort EPackMismatch
}

#[test, expected_failure(abort_code = EPackMismatch)]
fun reordered_pack_settlement_lines_abort_finish() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 105, 0, 0, 0);
    let (output, _souls) = test_registries(POLICY_ALL_ADMITTED, vector[], &mut ctx);
    let lines = vector[
        test_pack_line(@0x22, b"omega", 2),
        test_pack_line(@0x21, b"alpha", 1),
    ];
    let derived = vector[
        test_derived_pack(@0x21, b"alpha", 1),
        test_derived_pack(@0x22, b"omega", 2),
    ];
    assert_exact_pack_bindings(borrow_policy(&output, b"png".to_string()), &lines, &derived);
    abort EPackMismatch
}

#[test, expected_failure(abort_code = EPackMismatch)]
fun stale_pack_content_aborts_finish() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 106, 0, 0, 0);
    let (output, _souls) = test_registries(POLICY_ALL_ADMITTED, vector[], &mut ctx);
    assert_exact_pack_bindings(borrow_policy(&output, b"png".to_string()),
        &vector[test_pack_line(@0x21, b"alpha", 9)],
        &vector[test_derived_pack(@0x21, b"alpha", 1)]);
    abort EPackMismatch
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun allowlist_rejects_runtime_derived_pack_outside_policy() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 107, 0, 0, 0);
    let (output, _souls) = test_registries(POLICY_ALLOWLIST,
        vector[b"allowed".to_string()], &mut ctx);
    assert_exact_pack_bindings(borrow_policy(&output, b"png".to_string()),
        &vector[test_pack_line(@0x21, b"other", 1)],
        &vector[test_derived_pack(@0x21, b"other", 1)]);
    abort EInvalidPolicy
}

#[test, expected_failure(abort_code = EInvalidProof)]
fun protected_binding_rejects_cross_receipt() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 108, 0, 0, 0);
    let (output, receipt) = test_protected_artifacts(&mut ctx);
    assert_protected_proof_fields(&output, &receipt,
        object::id_from_address(@0xBAD), object::id(&output),
        &test_hash(4), &test_hash(5), &test_hash(8), &test_hash(10),
        &b"complete/png".to_string(), &b"receipt/one".to_string(), &test_hash(11));
    abort EInvalidProof
}

#[test, expected_failure(abort_code = EInvalidProof)]
fun protected_binding_rejects_cross_output() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 109, 0, 0, 0);
    let (output, receipt) = test_protected_artifacts(&mut ctx);
    assert_protected_proof_fields(&output, &receipt,
        object::id(&receipt), object::id_from_address(@0xBAD),
        &test_hash(4), &test_hash(5), &test_hash(8), &test_hash(10),
        &b"complete/png".to_string(), &b"receipt/one".to_string(), &test_hash(11));
    abort EInvalidProof
}

#[test, expected_failure(abort_code = EInvalidProof)]
fun protected_binding_rejects_scope_or_asset_drift() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 110, 0, 0, 0);
    let (output, receipt) = test_protected_artifacts(&mut ctx);
    assert_protected_proof_fields(&output, &receipt,
        object::id(&receipt), object::id(&output),
        &test_hash(4), &test_hash(5), &test_hash(8), &test_hash(10),
        &b"complete/other".to_string(), &b"receipt/one".to_string(), &test_hash(11));
    abort EInvalidProof
}

#[test, expected_failure(abort_code = EInvalidProof)]
fun protected_binding_rejects_any_instance_commitment_drift() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 111, 0, 0, 0);
    let (output, receipt) = test_protected_artifacts(&mut ctx);
    assert_protected_proof_fields(&output, &receipt,
        object::id(&receipt), object::id(&output),
        &test_hash(99), &test_hash(5), &test_hash(8), &test_hash(10),
        &b"complete/png".to_string(), &b"receipt/one".to_string(), &test_hash(11));
    abort EInvalidProof
}

#[test, expected_failure(abort_code = EInvalidCommitment)]
fun content_and_protection_commitments_ignore_current_holder_after_mint() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 112, 0, 0, 0);
    let (mut output, mut receipt) = test_protected_artifacts(&mut ctx);
    output.output_commitment = derive_current_output_commitment(&output);
    receipt.output_commitment = output.output_commitment;
    receipt.receipt_commitment = derive_current_receipt_commitment(&receipt);
    let seal_id = test_hash(11);
    output.seal_id = option::some(seal_id);
    receipt.seal_id = option::some(seal_id);
    output.protection_binding_commitment = hash::sha2_256(bcs::to_bytes(
        &ProtectionBindingCommitmentInputV8 {
            domain: b"animacraft-v8/output/protection", version: VERSION,
            output_id: object::id(&output), receipt_id: object::id(&receipt),
            output_commitment: output.output_commitment,
            receipt_commitment: receipt.receipt_commitment,
            scope_key: output.scope_key, asset_key: output.asset_key, seal_id,
        },
    ));
    let output_commitment = output.output_commitment;
    let receipt_commitment = receipt.receipt_commitment;
    let protection_commitment = output.protection_binding_commitment;
    output.holder = @0xB0B;
    receipt.holder = @0xB0B;
    assert!(output.original_holder == @0xA11
        && receipt.original_holder == @0xA11, EWrongHolder);
    assert!(derive_current_output_commitment(&output) == output_commitment,
        EInvalidCommitment);
    assert!(derive_current_receipt_commitment(&receipt) == receipt_commitment,
        EInvalidCommitment);
    assert!(output.protection_binding_commitment == protection_commitment,
        EInvalidCommitment);
    assert_protection_binding(&output, &receipt);
    abort EInvalidCommitment
}
