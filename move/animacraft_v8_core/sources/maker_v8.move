/// Immutable Maker identity, economics/rights snapshots, DRAFT authority, and
/// one-time split-package bindings. Runtime behavior is intentionally absent.
module animacraft_v8_core::maker_v8;

use animacraft_v8_core::package_binding_v8::{
    Self as package_binding,
    ProductReleaseBindingV8,
};
use animacraft_v8_core::protocol_config_v8::{Self as protocol, ProtocolConfigV8};
use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::{Self as string, String};
use sui::clock::Clock;
use sui::event;

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;
const MAX_ROYALTY_BPS: u16 = 1_000;
const ROYALTY_STEP_BPS: u16 = 50;
const MAX_COMBINED_SOURCE_ROYALTY_BPS: u16 = 1_000;
const MAX_PRICE_ATOMIC: u64 = 1_000_000_000_000;
const MAX_QUOTA: u64 = 1_000_000_000;
const MAX_KEY_BYTES: u64 = 128;
const MAX_BLOB_ID_BYTES: u64 = 512;

const DRAFT: u8 = 0;
/// Reserved for the future Release orchestrator. This bounded Core phase does
/// not expose a transition that can reach it.
const ACTIVE: u8 = 1;
const PAUSED: u8 = 2;
const ARCHIVED: u8 = 3;

const ACCESS_FREE: u8 = 0;
const ACCESS_PAID: u8 = 1;
const COMPLETE_UNLIMITED_FREE: u8 = 0;
const COMPLETE_FREE_QUOTA_THEN_PAID: u8 = 1;
const COMPLETE_PAID_EVERY_TIME: u8 = 2;
const COMPLETE_FREE_QUOTA_THEN_BLOCK: u8 = 3;
const RIGHTS_ONCHAIN_NATIVE: u8 = 0;
const RIGHTS_LICENSE_WRAPPED: u8 = 1;

const EInvalidLifecycle: u64 = 0;
const EInvalidAdminCap: u64 = 1;
const ENotCurrentOwner: u64 = 2;
const EInvalidCommitment: u64 = 3;
const EInvalidString: u64 = 4;
const EInvalidEconomics: u64 = 5;
const EInvalidRights: u64 = 6;
const EInvalidLineage: u64 = 7;
const EProtocolSnapshotMismatch: u64 = 8;
const ECorePackageMismatch: u64 = 9;
const EProductBindingAlreadyFinalized: u64 = 10;
const EProductBindingMissing: u64 = 11;
const EPackAdmissionAlreadyFinalized: u64 = 12;
const EPackAdmissionBindingMissing: u64 = 13;
const EBindingIdCollision: u64 = 14;
const EBaseRegistryMismatch: u64 = 15;
const EBaseRegistryAlreadyFinalized: u64 = 16;
const EBaseRegistryMissing: u64 = 17;

public struct EconomicsSnapshotV8 has copy, drop, store {
    protocol_config_id: ID,
    protocol_config_revision: u64,
    protocol_config_commitment: vector<u8>,
    payment_coin_type: String,
    maker_access: u8,
    maker_price_atomic: u64,
    complete_mode: u8,
    complete_price_atomic: u64,
    complete_per_wallet_quota: u64,
    complete_total_cap: u64,
    primary_content_fee_bps: u16,
    fixed_complete_fee_atomic: u64,
    maker_market_fee_bps: u16,
    soul_market_fee_bps: u16,
    commitment: vector<u8>,
}

public struct RightsSnapshotV8 has copy, drop, store {
    origin: u8,
    creator_confirmed: bool,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
    commitment: vector<u8>,
}

/// Immutable identity/policy binding only. Pack membership and Pack registry
/// revision deliberately do not live in MakerRootV8, so Runtime can admit
/// independent compatible Pack Releases after activation using revision CAS.
public struct PackAdmissionBindingV8 has copy, drop, store {
    pack_registry_id: ID,
    admission_authority_id: ID,
    policy_commitment: vector<u8>,
    commitment: vector<u8>,
}

public struct MakerRootV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    core_original_package_id: ID,
    core_callable_package_id: ID,
    protocol_config_id: ID,
    protocol_config_revision: u64,
    protocol_config_commitment: vector<u8>,
    creator: address,
    owner: address,
    admin_cap_id: ID,
    ownership_epoch: u64,
    lifecycle: u8,
    maker_key: String,
    maker_version: String,
    version_commitment: vector<u8>,
    previous_root_id: Option<ID>,
    previous_version_commitment: Option<vector<u8>>,
    renderer_commitment: vector<u8>,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    base_registry_id: Option<ID>,
    expected_base_definition_count: u64,
    expected_base_registry_commitment: vector<u8>,
    expected_pack_admission_policy_commitment: vector<u8>,
    economics: EconomicsSnapshotV8,
    rights: RightsSnapshotV8,
    product_release_binding: Option<ProductReleaseBindingV8>,
    pack_admission_binding: Option<PackAdmissionBindingV8>,
    created_at_ms: u64,
}

/// This cap intentionally lacks `store`; Core controls every transfer path.
public struct MakerAdminCapV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    owner: address,
    ownership_epoch: u64,
}

public struct EconomicsCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    protocol_config_id: ID,
    protocol_config_revision: u64,
    protocol_config_commitment: vector<u8>,
    payment_coin_type: String,
    maker_access: u8,
    maker_price_atomic: u64,
    complete_mode: u8,
    complete_price_atomic: u64,
    complete_per_wallet_quota: u64,
    complete_total_cap: u64,
    primary_content_fee_bps: u16,
    fixed_complete_fee_atomic: u64,
    maker_market_fee_bps: u16,
    soul_market_fee_bps: u16,
}

public struct RightsCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    origin: u8,
    creator_confirmed: bool,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
}

public struct VersionCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    core_original_package_id: ID,
    protocol_config_id: ID,
    protocol_config_revision: u64,
    protocol_config_commitment: vector<u8>,
    maker_key: String,
    maker_version: String,
    previous_root_id: Option<ID>,
    previous_version_commitment: Option<vector<u8>>,
    renderer_commitment: vector<u8>,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    expected_base_definition_count: u64,
    expected_base_registry_commitment: vector<u8>,
    expected_pack_admission_policy_commitment: vector<u8>,
    economics_commitment: vector<u8>,
    rights_commitment: vector<u8>,
}

public struct PackAdmissionCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    root_id: ID,
    root_version_commitment: vector<u8>,
    pack_registry_id: ID,
    admission_authority_id: ID,
    policy_commitment: vector<u8>,
}

public struct ProductReleaseBindingFinalizedV8 has copy, drop {
    root_id: ID,
    binding_commitment: vector<u8>,
}

public struct PackAdmissionBindingFinalizedV8 has copy, drop {
    root_id: ID,
    pack_registry_id: ID,
    admission_authority_id: ID,
    policy_commitment: vector<u8>,
    binding_commitment: vector<u8>,
}

public fun version_v8(): u64 { VERSION }
public fun lifecycle_draft_v8(): u8 { DRAFT }
public fun lifecycle_active_v8(): u8 { ACTIVE }
public fun lifecycle_paused_v8(): u8 { PAUSED }
public fun lifecycle_archived_v8(): u8 { ARCHIVED }
public fun access_free_v8(): u8 { ACCESS_FREE }
public fun access_paid_v8(): u8 { ACCESS_PAID }
public fun complete_unlimited_free_v8(): u8 { COMPLETE_UNLIMITED_FREE }
public fun complete_free_quota_then_paid_v8(): u8 {
    COMPLETE_FREE_QUOTA_THEN_PAID
}
public fun complete_paid_every_time_v8(): u8 { COMPLETE_PAID_EVERY_TIME }
public fun complete_free_quota_then_block_v8(): u8 {
    COMPLETE_FREE_QUOTA_THEN_BLOCK
}
public fun rights_onchain_native_v8(): u8 { RIGHTS_ONCHAIN_NATIVE }
public fun rights_license_wrapped_v8(): u8 { RIGHTS_LICENSE_WRAPPED }

public fun new_economics_snapshot_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    maker_access: u8,
    maker_price_atomic: u64,
    complete_mode: u8,
    complete_price_atomic: u64,
    complete_per_wallet_quota: u64,
    complete_total_cap: u64,
): EconomicsSnapshotV8 {
    protocol::assert_enabled_for_coin_v8<PaymentCoin>(config);
    assert_valid_access(maker_access, maker_price_atomic);
    assert_valid_complete_policy(
        complete_mode,
        complete_price_atomic,
        complete_per_wallet_quota,
        complete_total_cap,
    );
    let protocol_config_id = protocol::config_id_v8(config);
    let protocol_config_revision = protocol::config_revision_v8(config);
    let protocol_config_commitment = *protocol::config_commitment_v8(config);
    let payment_coin_type = protocol::payment_coin_type_name_v8<PaymentCoin>();
    let primary_content_fee_bps = protocol::config_primary_content_fee_bps_v8(config);
    let fixed_complete_fee_atomic = protocol::config_fixed_complete_fee_atomic_v8(config);
    let maker_market_fee_bps = protocol::config_maker_market_fee_bps_v8(config);
    let soul_market_fee_bps = protocol::config_soul_market_fee_bps_v8(config);
    let commitment = hash::sha2_256(bcs::to_bytes(&EconomicsCommitmentInputV8 {
        domain: b"animacraft-v8/economics-snapshot",
        version: VERSION,
        protocol_config_id,
        protocol_config_revision,
        protocol_config_commitment,
        payment_coin_type,
        maker_access,
        maker_price_atomic,
        complete_mode,
        complete_price_atomic,
        complete_per_wallet_quota,
        complete_total_cap,
        primary_content_fee_bps,
        fixed_complete_fee_atomic,
        maker_market_fee_bps,
        soul_market_fee_bps,
    }));
    EconomicsSnapshotV8 {
        protocol_config_id,
        protocol_config_revision,
        protocol_config_commitment,
        payment_coin_type,
        maker_access,
        maker_price_atomic,
        complete_mode,
        complete_price_atomic,
        complete_per_wallet_quota,
        complete_total_cap,
        primary_content_fee_bps,
        fixed_complete_fee_atomic,
        maker_market_fee_bps,
        soul_market_fee_bps,
        commitment,
    }
}

public fun new_rights_snapshot_v8(
    origin: u8,
    creator_confirmed: bool,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
): RightsSnapshotV8 {
    assert!(
        origin == RIGHTS_ONCHAIN_NATIVE || origin == RIGHTS_LICENSE_WRAPPED,
        EInvalidRights,
    );
    assert!(creator_confirmed, EInvalidRights);
    assert_valid_royalty(soul_creator_royalty_bps);
    assert_valid_royalty(maker_source_royalty_bps);
    assert_valid_royalty(maker_resale_royalty_bps);
    assert!(
        soul_creator_royalty_bps + maker_source_royalty_bps
            <= MAX_COMBINED_SOURCE_ROYALTY_BPS,
        EInvalidRights,
    );
    let commitment = hash::sha2_256(bcs::to_bytes(&RightsCommitmentInputV8 {
        domain: b"animacraft-v8/rights-snapshot",
        version: VERSION,
        origin,
        creator_confirmed,
        soul_creator_royalty_bps,
        maker_source_royalty_bps,
        maker_resale_royalty_bps,
    }));
    RightsSnapshotV8 {
        origin,
        creator_confirmed,
        soul_creator_royalty_bps,
        maker_source_royalty_bps,
        maker_resale_royalty_bps,
        commitment,
    }
}

/// Called by the companion-independent Core constructor after it has allocated
/// the exact base-registry ID. Same-transaction IDs are fields, not inputs to
/// the precomputable version/content commitments.
public(package) fun new_maker_draft_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    expected_base_definition_count: u64,
    expected_base_registry_commitment: vector<u8>,
    expected_pack_admission_policy_commitment: vector<u8>,
    maker_key: String,
    maker_version: String,
    previous_root_id: Option<ID>,
    previous_version_commitment: Option<vector<u8>>,
    renderer_commitment: vector<u8>,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    economics: EconomicsSnapshotV8,
    rights: RightsSnapshotV8,
    clock: &Clock,
    ctx: &mut TxContext,
): (MakerRootV8<PaymentCoin>, MakerAdminCapV8) {
    protocol::assert_enabled_for_coin_v8<PaymentCoin>(config);
    assert_non_empty_bounded(&maker_key, MAX_KEY_BYTES);
    assert_non_empty_bounded(&maker_version, MAX_KEY_BYTES);
    assert_non_empty_bounded(&manifest_blob_id, MAX_BLOB_ID_BYTES);
    assert_hash(&expected_base_registry_commitment);
    assert_hash(&expected_pack_admission_policy_commitment);
    assert_hash(&renderer_commitment);
    assert_hash(&manifest_sha256);
    assert_hash(&content_commitment);
    assert_lineage(&previous_root_id, &previous_version_commitment);
    assert_economics_snapshot<PaymentCoin>(config, &economics);
    assert_rights_snapshot(&rights);

    let root_uid = object::new(ctx);
    let root_id = root_uid.to_inner();
    let owner = ctx.sender();
    let admin = MakerAdminCapV8 {
        id: object::new(ctx),
        version: VERSION,
        root_id,
        owner,
        ownership_epoch: 0,
    };
    let admin_cap_id = object::id(&admin);
    let core_original_package_id = protocol::config_core_original_package_id_v8(config);
    let core_callable_package_id = protocol::config_core_callable_package_id_v8(config);
    let protocol_config_id = protocol::config_id_v8(config);
    let protocol_config_revision = protocol::config_revision_v8(config);
    let protocol_config_commitment = *protocol::config_commitment_v8(config);
    let version_commitment = hash::sha2_256(bcs::to_bytes(
        &VersionCommitmentInputV8 {
            domain: b"animacraft-v8/maker-version",
            version: VERSION,
            core_original_package_id,
            protocol_config_id,
            protocol_config_revision,
            protocol_config_commitment,
            maker_key,
            maker_version,
            previous_root_id,
            previous_version_commitment,
            renderer_commitment,
            manifest_blob_id,
            manifest_sha256,
            content_commitment,
            expected_base_definition_count,
            expected_base_registry_commitment,
            expected_pack_admission_policy_commitment,
            economics_commitment: economics.commitment,
            rights_commitment: rights.commitment,
        },
    ));
    let root = MakerRootV8<PaymentCoin> {
        id: root_uid,
        version: VERSION,
        core_original_package_id,
        core_callable_package_id,
        protocol_config_id,
        protocol_config_revision,
        protocol_config_commitment,
        creator: owner,
        owner,
        admin_cap_id,
        ownership_epoch: 0,
        lifecycle: DRAFT,
        maker_key,
        maker_version,
        version_commitment,
        previous_root_id,
        previous_version_commitment,
        renderer_commitment,
        manifest_blob_id,
        manifest_sha256,
        content_commitment,
        base_registry_id: option::none(),
        expected_base_definition_count,
        expected_base_registry_commitment,
        expected_pack_admission_policy_commitment,
        economics,
        rights,
        product_release_binding: option::none(),
        pack_admission_binding: option::none(),
        created_at_ms: clock.timestamp_ms(),
    };
    (root, admin)
}

/// Resolves the same-transaction Root/registry ID cycle. The Core constructor
/// calls this exactly once while the Root is still an unshared DRAFT.
public(package) fun finalize_base_registry_binding_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry_id: ID,
) {
    assert_draft_admin_v8(root, admin);
    assert!(root.base_registry_id.is_none(), EBaseRegistryAlreadyFinalized);
    assert!(base_registry_id != object::id(root), EBindingIdCollision);
    assert!(base_registry_id != root.admin_cap_id, EBindingIdCollision);
    root.base_registry_id = option::some(base_registry_id);
}

/// One-time DRAFT finalization. No companion object is trusted here; the
/// future Release orchestrator must separately present each concrete type.
public fun finalize_product_release_binding_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    binding: ProductReleaseBindingV8,
    ctx: &TxContext,
) {
    assert_draft_admin_v8(root, admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    assert!(
        root.product_release_binding.is_none(),
        EProductBindingAlreadyFinalized,
    );
    package_binding::assert_product_release_binding_well_formed_v8(&binding);
    let core = package_binding::core_binding_v8(&binding);
    assert!(
        package_binding::original_package_id_v8(core)
            == root.core_original_package_id,
        ECorePackageMismatch,
    );
    assert!(
        package_binding::callable_package_id_v8(core)
            == root.core_callable_package_id,
        ECorePackageMismatch,
    );
    let binding_commitment = *package_binding::product_binding_commitment_v8(&binding);
    root.product_release_binding = option::some(binding);
    event::emit(ProductReleaseBindingFinalizedV8 {
        root_id: object::id(root),
        binding_commitment,
    });
}

/// Binds only the stable Pack registry/admission authority and immutable
/// policy. It intentionally records no Pack count, release set, or registry
/// revision; those remain Runtime-owned CAS state after activation.
public fun finalize_pack_admission_binding_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    pack_registry_id: ID,
    admission_authority_id: ID,
    ctx: &TxContext,
) {
    assert_draft_admin_v8(root, admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    assert!(
        root.pack_admission_binding.is_none(),
        EPackAdmissionAlreadyFinalized,
    );
    assert!(pack_registry_id != admission_authority_id, EBindingIdCollision);
    assert!(pack_registry_id != object::id(root), EBindingIdCollision);
    if (root.base_registry_id.is_some()) {
        assert!(
            pack_registry_id != *root.base_registry_id.borrow(),
            EBindingIdCollision,
        );
    };
    assert!(pack_registry_id != root.admin_cap_id, EBindingIdCollision);
    assert!(admission_authority_id != object::id(root), EBindingIdCollision);
    if (root.base_registry_id.is_some()) {
        assert!(
            admission_authority_id != *root.base_registry_id.borrow(),
            EBindingIdCollision,
        );
    };
    assert!(admission_authority_id != root.admin_cap_id, EBindingIdCollision);
    let policy_commitment = root.expected_pack_admission_policy_commitment;
    let commitment = hash::sha2_256(bcs::to_bytes(
        &PackAdmissionCommitmentInputV8 {
            domain: b"animacraft-v8/pack-admission-binding",
            version: VERSION,
            root_id: object::id(root),
            root_version_commitment: root.version_commitment,
            pack_registry_id,
            admission_authority_id,
            policy_commitment,
        },
    ));
    let binding = PackAdmissionBindingV8 {
        pack_registry_id,
        admission_authority_id,
        policy_commitment,
        commitment,
    };
    root.pack_admission_binding = option::some(binding);
    event::emit(PackAdmissionBindingFinalizedV8 {
        root_id: object::id(root),
        pack_registry_id,
        admission_authority_id,
        policy_commitment,
        binding_commitment: commitment,
    });
}

/// Read-only Core half of activation readiness. It cannot activate a Maker;
/// the future Release package must also prove concrete companion readiness.
public fun assert_activation_scaffold_ready_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
) {
    assert_draft_v8(root);
    assert!(root.product_release_binding.is_some(), EProductBindingMissing);
    assert!(
        root.pack_admission_binding.is_some(),
        EPackAdmissionBindingMissing,
    );
    assert!(root.base_registry_id.is_some(), EBaseRegistryMissing);
    package_binding::assert_product_release_binding_well_formed_v8(
        root.product_release_binding.borrow(),
    );
    assert_pack_admission_binding(root, root.pack_admission_binding.borrow());
}

/// Lets the future Release orchestrator check that its marker types match the
/// exact original/callable IDs frozen into this Root. This is not activation.
public fun assert_release_type_origins_v8<
    PaymentCoin,
    ReleaseOriginalMarker,
    ReleaseCallableMarker,
>(root: &MakerRootV8<PaymentCoin>) {
    assert_activation_scaffold_ready_v8(root);
    let product = root.product_release_binding.borrow();
    package_binding::assert_type_origins_v8<
        ReleaseOriginalMarker,
        ReleaseCallableMarker,
    >(package_binding::release_binding_v8(product));
}

public fun assert_draft_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>) {
    assert!(root.lifecycle == DRAFT, EInvalidLifecycle);
}

public fun assert_draft_admin_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    assert_admin_v8(root, admin);
    assert_draft_v8(root);
}

public fun assert_admin_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    assert!(admin.version == VERSION, EInvalidAdminCap);
    assert!(admin.root_id == object::id(root), EInvalidAdminCap);
    assert!(object::id(admin) == root.admin_cap_id, EInvalidAdminCap);
    assert!(admin.owner == root.owner, EInvalidAdminCap);
    assert!(admin.ownership_epoch == root.ownership_epoch, EInvalidAdminCap);
}

public fun assert_base_registry_identity_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    registry_id: ID,
    root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: &vector<u8>,
) {
    assert!(root.base_registry_id.is_some(), EBaseRegistryMissing);
    assert!(
        registry_id == *root.base_registry_id.borrow(),
        EBaseRegistryMismatch,
    );
    assert!(root_id == object::id(root), EBaseRegistryMismatch);
    assert!(ownership_epoch == root.ownership_epoch, EBaseRegistryMismatch);
    assert!(
        root_content_commitment == &root.content_commitment,
        EBaseRegistryMismatch,
    );
}

public fun assert_root_identity_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: &vector<u8>,
) {
    assert!(root_id == object::id(root), EBaseRegistryMismatch);
    assert!(ownership_epoch == root.ownership_epoch, EBaseRegistryMismatch);
    assert!(
        root_content_commitment == &root.content_commitment,
        EBaseRegistryMismatch,
    );
}

public(package) fun share_maker_root_and_admin_v8<PaymentCoin>(
    root: MakerRootV8<PaymentCoin>,
    admin: MakerAdminCapV8,
    ctx: &TxContext,
) {
    assert_draft_admin_v8(&root, &admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    transfer::share_object(root);
    transfer::transfer(admin, ctx.sender());
}

fun assert_pack_admission_binding<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    binding: &PackAdmissionBindingV8,
) {
    assert!(
        binding.policy_commitment
            == root.expected_pack_admission_policy_commitment,
        EInvalidCommitment,
    );
    let expected = hash::sha2_256(bcs::to_bytes(
        &PackAdmissionCommitmentInputV8 {
            domain: b"animacraft-v8/pack-admission-binding",
            version: VERSION,
            root_id: object::id(root),
            root_version_commitment: root.version_commitment,
            pack_registry_id: binding.pack_registry_id,
            admission_authority_id: binding.admission_authority_id,
            policy_commitment: binding.policy_commitment,
        },
    ));
    assert!(&expected == &binding.commitment, EInvalidCommitment);
}

fun assert_economics_snapshot<PaymentCoin>(
    config: &ProtocolConfigV8,
    economics: &EconomicsSnapshotV8,
) {
    protocol::assert_exact_snapshot_v8<PaymentCoin>(
        config,
        economics.protocol_config_id,
        economics.protocol_config_revision,
        &economics.protocol_config_commitment,
    );
    assert!(
        economics.payment_coin_type == protocol::payment_coin_type_name_v8<PaymentCoin>(),
        EProtocolSnapshotMismatch,
    );
    assert!(
        economics.primary_content_fee_bps
            == protocol::config_primary_content_fee_bps_v8(config),
        EProtocolSnapshotMismatch,
    );
    assert!(
        economics.fixed_complete_fee_atomic
            == protocol::config_fixed_complete_fee_atomic_v8(config),
        EProtocolSnapshotMismatch,
    );
    assert!(
        economics.maker_market_fee_bps
            == protocol::config_maker_market_fee_bps_v8(config),
        EProtocolSnapshotMismatch,
    );
    assert!(
        economics.soul_market_fee_bps
            == protocol::config_soul_market_fee_bps_v8(config),
        EProtocolSnapshotMismatch,
    );
    assert_valid_access(economics.maker_access, economics.maker_price_atomic);
    assert_valid_complete_policy(
        economics.complete_mode,
        economics.complete_price_atomic,
        economics.complete_per_wallet_quota,
        economics.complete_total_cap,
    );
    let expected = hash::sha2_256(bcs::to_bytes(&EconomicsCommitmentInputV8 {
        domain: b"animacraft-v8/economics-snapshot",
        version: VERSION,
        protocol_config_id: economics.protocol_config_id,
        protocol_config_revision: economics.protocol_config_revision,
        protocol_config_commitment: economics.protocol_config_commitment,
        payment_coin_type: economics.payment_coin_type,
        maker_access: economics.maker_access,
        maker_price_atomic: economics.maker_price_atomic,
        complete_mode: economics.complete_mode,
        complete_price_atomic: economics.complete_price_atomic,
        complete_per_wallet_quota: economics.complete_per_wallet_quota,
        complete_total_cap: economics.complete_total_cap,
        primary_content_fee_bps: economics.primary_content_fee_bps,
        fixed_complete_fee_atomic: economics.fixed_complete_fee_atomic,
        maker_market_fee_bps: economics.maker_market_fee_bps,
        soul_market_fee_bps: economics.soul_market_fee_bps,
    }));
    assert!(&expected == &economics.commitment, EProtocolSnapshotMismatch);
}

fun assert_rights_snapshot(rights: &RightsSnapshotV8) {
    assert!(
        rights.origin == RIGHTS_ONCHAIN_NATIVE
            || rights.origin == RIGHTS_LICENSE_WRAPPED,
        EInvalidRights,
    );
    assert!(rights.creator_confirmed, EInvalidRights);
    assert_valid_royalty(rights.soul_creator_royalty_bps);
    assert_valid_royalty(rights.maker_source_royalty_bps);
    assert_valid_royalty(rights.maker_resale_royalty_bps);
    assert!(
        rights.soul_creator_royalty_bps + rights.maker_source_royalty_bps
            <= MAX_COMBINED_SOURCE_ROYALTY_BPS,
        EInvalidRights,
    );
    let expected = hash::sha2_256(bcs::to_bytes(&RightsCommitmentInputV8 {
        domain: b"animacraft-v8/rights-snapshot",
        version: VERSION,
        origin: rights.origin,
        creator_confirmed: rights.creator_confirmed,
        soul_creator_royalty_bps: rights.soul_creator_royalty_bps,
        maker_source_royalty_bps: rights.maker_source_royalty_bps,
        maker_resale_royalty_bps: rights.maker_resale_royalty_bps,
    }));
    assert!(&expected == &rights.commitment, EInvalidRights);
}

fun assert_valid_access(access: u8, price: u64) {
    assert!(
        (access == ACCESS_FREE && price == 0)
            || (access == ACCESS_PAID && price > 0 && price <= MAX_PRICE_ATOMIC),
        EInvalidEconomics,
    );
}

fun assert_valid_complete_policy(mode: u8, price: u64, quota: u64, total_cap: u64) {
    assert!(price <= MAX_PRICE_ATOMIC, EInvalidEconomics);
    assert!(quota <= MAX_QUOTA && total_cap <= MAX_QUOTA, EInvalidEconomics);
    assert!(total_cap == 0 || quota <= total_cap, EInvalidEconomics);
    assert!(
        (mode == COMPLETE_UNLIMITED_FREE && price == 0 && quota == 0)
            || (
                mode == COMPLETE_FREE_QUOTA_THEN_PAID
                    && price > 0
                    && quota > 0
            )
            || (mode == COMPLETE_PAID_EVERY_TIME && price > 0 && quota == 0)
            || (
                mode == COMPLETE_FREE_QUOTA_THEN_BLOCK
                    && price == 0
                    && quota > 0
            ),
        EInvalidEconomics,
    );
}

fun assert_valid_royalty(value: u16) {
    assert!(value <= MAX_ROYALTY_BPS, EInvalidRights);
    assert!(value % ROYALTY_STEP_BPS == 0, EInvalidRights);
}

fun assert_lineage(
    previous_root_id: &Option<ID>,
    previous_version_commitment: &Option<vector<u8>>,
) {
    assert!(
        previous_root_id.is_some() == previous_version_commitment.is_some(),
        EInvalidLineage,
    );
    if (previous_version_commitment.is_some()) {
        assert_hash(previous_version_commitment.borrow());
    };
}

fun assert_hash(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
}

fun assert_non_empty_bounded(value: &String, max: u64) {
    let length = string::as_bytes(value).length();
    assert!(length > 0 && length <= max, EInvalidString);
}

public fun root_id_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): ID {
    object::id(root)
}
public fun root_version_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u64 {
    root.version
}
public fun root_core_original_package_id_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): ID { root.core_original_package_id }
public fun root_core_callable_package_id_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): ID { root.core_callable_package_id }
public fun root_owner_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): address {
    root.owner
}
public fun root_ownership_epoch_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u64 {
    root.ownership_epoch
}
public fun root_lifecycle_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u8 {
    root.lifecycle
}
public fun root_version_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> { &root.version_commitment }
public fun root_content_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> { &root.content_commitment }
public fun root_base_registry_id_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): ID {
    assert!(root.base_registry_id.is_some(), EBaseRegistryMissing);
    *root.base_registry_id.borrow()
}
public fun root_expected_base_definition_count_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): u64 { root.expected_base_definition_count }
public fun root_expected_base_registry_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> { &root.expected_base_registry_commitment }
public fun root_expected_pack_admission_policy_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> { &root.expected_pack_admission_policy_commitment }
public fun root_economics_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): EconomicsSnapshotV8 { root.economics }
public fun root_rights_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): RightsSnapshotV8 { root.rights }
public fun root_product_release_binding_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &ProductReleaseBindingV8 {
    assert!(root.product_release_binding.is_some(), EProductBindingMissing);
    root.product_release_binding.borrow()
}
public fun root_pack_admission_binding_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &PackAdmissionBindingV8 {
    assert!(root.pack_admission_binding.is_some(), EPackAdmissionBindingMissing);
    root.pack_admission_binding.borrow()
}
public fun pack_registry_id_v8(binding: &PackAdmissionBindingV8): ID {
    binding.pack_registry_id
}
public fun pack_admission_authority_id_v8(binding: &PackAdmissionBindingV8): ID {
    binding.admission_authority_id
}
public fun pack_admission_policy_commitment_v8(
    binding: &PackAdmissionBindingV8,
): &vector<u8> { &binding.policy_commitment }
public fun pack_admission_binding_commitment_v8(
    binding: &PackAdmissionBindingV8,
): &vector<u8> { &binding.commitment }
public fun admin_root_id_v8(admin: &MakerAdminCapV8): ID { admin.root_id }

public fun economics_maker_access_v8(economics: &EconomicsSnapshotV8): u8 {
    economics.maker_access
}
public fun economics_maker_price_atomic_v8(economics: &EconomicsSnapshotV8): u64 {
    economics.maker_price_atomic
}
public fun economics_complete_mode_v8(economics: &EconomicsSnapshotV8): u8 {
    economics.complete_mode
}
public fun economics_complete_price_atomic_v8(
    economics: &EconomicsSnapshotV8,
): u64 { economics.complete_price_atomic }
public fun economics_commitment_v8(
    economics: &EconomicsSnapshotV8,
): &vector<u8> { &economics.commitment }
public fun rights_commitment_v8(rights: &RightsSnapshotV8): &vector<u8> {
    &rights.commitment
}

#[test_only]
public fun set_lifecycle_for_testing<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    lifecycle: u8,
) {
    root.lifecycle = lifecycle;
}

#[test_only]
public fun destroy_maker_for_testing<PaymentCoin>(
    root: MakerRootV8<PaymentCoin>,
    admin: MakerAdminCapV8,
) {
    let MakerRootV8 {
        id: root_uid,
        version: _,
        core_original_package_id: _,
        core_callable_package_id: _,
        protocol_config_id: _,
        protocol_config_revision: _,
        protocol_config_commitment: _,
        creator: _,
        owner: _,
        admin_cap_id: _,
        ownership_epoch: _,
        lifecycle: _,
        maker_key: _,
        maker_version: _,
        version_commitment: _,
        previous_root_id: _,
        previous_version_commitment: _,
        renderer_commitment: _,
        manifest_blob_id: _,
        manifest_sha256: _,
        content_commitment: _,
        base_registry_id: _,
        expected_base_definition_count: _,
        expected_base_registry_commitment: _,
        expected_pack_admission_policy_commitment: _,
        economics: _,
        rights: _,
        product_release_binding: _,
        pack_admission_binding: _,
        created_at_ms: _,
    } = root;
    let MakerAdminCapV8 {
        id: admin_uid,
        version: _,
        root_id: _,
        owner: _,
        ownership_epoch: _,
    } = admin;
    root_uid.delete();
    admin_uid.delete();
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
fun new_test_maker(
    ctx: &mut TxContext,
): (
    ProtocolConfigV8,
    animacraft_v8_core::protocol_config_v8::ProtocolAdminCapV8,
    MakerRootV8<sui::sui::SUI>,
    MakerAdminCapV8,
) {
    let (config, protocol_cap) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, ctx);
    let economics = new_economics_snapshot_v8<sui::sui::SUI>(
        &config,
        ACCESS_FREE,
        0,
        COMPLETE_UNLIMITED_FREE,
        0,
        0,
        0,
    );
    let rights = new_rights_snapshot_v8(
        RIGHTS_ONCHAIN_NATIVE,
        true,
        250,
        250,
        500,
    );
    let clock = sui::clock::create_for_testing(ctx);
    let (root, admin) = new_maker_draft_v8<sui::sui::SUI>(
        &config,
        4,
        test_hash(1),
        test_hash(2),
        b"maker".to_string(),
        b"1.0.0".to_string(),
        option::none(),
        option::none(),
        test_hash(3),
        b"walrus-blob".to_string(),
        test_hash(4),
        test_hash(5),
        economics,
        rights,
        &clock,
        ctx,
    );
    clock.destroy_for_testing();
    (config, protocol_cap, root, admin)
}

#[test_only]
fun destroy_test_maker(
    config: ProtocolConfigV8,
    protocol_cap: animacraft_v8_core::protocol_config_v8::ProtocolAdminCapV8,
    root: MakerRootV8<sui::sui::SUI>,
    admin: MakerAdminCapV8,
) {
    destroy_maker_for_testing(root, admin);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
}

#[test]
fun new_root_is_draft_and_snapshots_native_policy() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 10, 0, 0, 0);
    let (config, protocol_cap, root, admin) = new_test_maker(&mut ctx);
    assert!(root.lifecycle == DRAFT, EInvalidLifecycle);
    assert!(root.product_release_binding.is_none(), EProductBindingAlreadyFinalized);
    assert!(root.pack_admission_binding.is_none(), EPackAdmissionAlreadyFinalized);
    assert!(root.expected_base_definition_count == 4, EBaseRegistryMismatch);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = EProductBindingMissing)]
fun activation_scaffold_rejects_absent_product_binding() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 11, 0, 0, 0);
    let (config, protocol_cap, root, admin) = new_test_maker(&mut ctx);
    assert_activation_scaffold_ready_v8(&root);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = EPackAdmissionBindingMissing)]
fun activation_scaffold_rejects_absent_pack_admission_binding() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 12, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    let product = package_binding::product_release_binding_for_testing(
        root.core_original_package_id.to_address(),
        root.core_callable_package_id.to_address(),
    );
    finalize_product_release_binding_v8(&mut root, &admin, product, &ctx);
    assert_activation_scaffold_ready_v8(&root);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = EProductBindingAlreadyFinalized)]
fun product_binding_cannot_be_replaced() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 13, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    let product = package_binding::product_release_binding_for_testing(
        root.core_original_package_id.to_address(),
        root.core_callable_package_id.to_address(),
    );
    finalize_product_release_binding_v8(&mut root, &admin, product, &ctx);
    finalize_product_release_binding_v8(&mut root, &admin, product, &ctx);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = ECorePackageMismatch)]
fun wrong_core_type_origin_binding_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 14, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    let product = package_binding::product_release_binding_for_testing(@0x77, @0x78);
    finalize_product_release_binding_v8(&mut root, &admin, product, &ctx);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = EPackAdmissionAlreadyFinalized)]
fun pack_admission_binding_cannot_be_replaced() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 15, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    finalize_pack_admission_binding_v8(
        &mut root,
        &admin,
        object::id_from_address(@0xC0),
        object::id_from_address(@0xC1),
        &ctx,
    );
    finalize_pack_admission_binding_v8(
        &mut root,
        &admin,
        object::id_from_address(@0xC2),
        object::id_from_address(@0xC3),
        &ctx,
    );
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test]
fun exact_pack_admission_scaffold_has_no_frozen_pack_count() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 151, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    finalize_base_registry_binding_v8(
        &mut root,
        &admin,
        object::id_from_address(@0xB0),
    );
    let product = package_binding::product_release_binding_for_testing(
        root.core_original_package_id.to_address(),
        root.core_callable_package_id.to_address(),
    );
    finalize_product_release_binding_v8(&mut root, &admin, product, &ctx);
    finalize_pack_admission_binding_v8(
        &mut root,
        &admin,
        object::id_from_address(@0xC0),
        object::id_from_address(@0xC1),
        &ctx,
    );
    assert_activation_scaffold_ready_v8(&root);
    let binding = root_pack_admission_binding_v8(&root);
    assert!(binding.pack_registry_id == object::id_from_address(@0xC0), EBaseRegistryMismatch);
    assert!(
        binding.admission_authority_id == object::id_from_address(@0xC1),
        EBaseRegistryMismatch,
    );
    assert!(
        &binding.policy_commitment
            == root_expected_pack_admission_policy_commitment_v8(&root),
        EBaseRegistryMismatch,
    );
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = EInvalidLifecycle)]
fun binding_is_draft_only() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 16, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    set_lifecycle_for_testing(&mut root, ACTIVE);
    let product = package_binding::product_release_binding_for_testing(
        root.core_original_package_id.to_address(),
        root.core_callable_package_id.to_address(),
    );
    finalize_product_release_binding_v8(&mut root, &admin, product, &ctx);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = EInvalidRights)]
fun unconfirmed_rights_are_rejected() {
    new_rights_snapshot_v8(RIGHTS_LICENSE_WRAPPED, false, 250, 250, 500);
}

#[test, expected_failure(abort_code = EInvalidEconomics)]
fun free_maker_cannot_have_a_price() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 17, 0, 0, 0);
    let (config, cap) = protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    new_economics_snapshot_v8<sui::sui::SUI>(
        &config,
        ACCESS_FREE,
        1,
        COMPLETE_UNLIMITED_FREE,
        0,
        0,
        0,
    );
    protocol::destroy_protocol_for_testing(config, cap);
}
