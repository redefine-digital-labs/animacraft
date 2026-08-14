/// Immutable Maker identity, economics/rights snapshots, DRAFT authority, and
/// one-time split-package bindings. Runtime behavior is intentionally absent.
module animacraft_v8_core::maker_v8;

use animacraft_v8_core::package_binding_v8::{
    Self as package_binding,
    CertifiedProductReleaseBindingV8,
    ProductReleaseCatalogV8,
    ProductReleaseBindingV8,
    ReleaseCatalogWitnessV8,
    RuntimePackReadinessV8,
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
const MAX_EVIDENCE_LOCATOR_BYTES: u64 = 1_024;

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
const EControlEpochMismatch: u64 = 18;
const EInvalidSuccessor: u64 = 19;
const ECatalogMismatch: u64 = 20;
const ESuccessorAuthorityAlreadyIssued: u64 = 21;
const EInvalidSuccessorAuthority: u64 = 22;

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
    creator: address,
    creator_confirmed: bool,
    evidence_certified: bool,
    certification_catalog_id: Option<ID>,
    certification_binding_commitment: Option<vector<u8>>,
    evidence_locator: String,
    evidence_blob_id: String,
    evidence_sha256: vector<u8>,
    terms_commitment: vector<u8>,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
    commitment: vector<u8>,
}

/// Exact evidence attestation minted only through the catalog-frozen Release
/// authority. It has no abilities and must be consumed into one snapshot.
public struct WrappedRightsCertificationV8 {
    creator: address,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    evidence_locator: String,
    evidence_blob_id: String,
    evidence_sha256: vector<u8>,
    terms_commitment: vector<u8>,
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
    control_epoch: u64,
    lifecycle: u8,
    maker_key: String,
    maker_version: u64,
    version_commitment: vector<u8>,
    previous_root_id: Option<ID>,
    previous_version_commitment: Option<vector<u8>>,
    successor_authority_id: Option<ID>,
    successor_root_id: Option<ID>,
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
    product_release_binding: Option<CertifiedProductReleaseBindingV8>,
    pack_admission_binding: Option<PackAdmissionBindingV8>,
    created_at_ms: u64,
}

/// This cap intentionally lacks `store`; Core controls every transfer path.
public struct MakerAdminCapV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    owner: address,
    control_epoch: u64,
}

/// Persistable but module-controlled, one-use authority for exactly one N+1
/// fork. Every predecessor CAS field is copied here and checked again when
/// the predecessor is mutably consumed by successor creation.
public struct SuccessorAuthorityV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    previous_root_id: ID,
    maker_key: String,
    maker_version: u64,
    version_commitment: vector<u8>,
    control_epoch: u64,
    owner: address,
    allowed_lifecycle: u8,
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
    creator: address,
    creator_confirmed: bool,
    evidence_certified: bool,
    certification_catalog_id: Option<ID>,
    certification_binding_commitment: Option<vector<u8>>,
    evidence_locator: String,
    evidence_blob_id: String,
    evidence_sha256: vector<u8>,
    terms_commitment: vector<u8>,
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
    maker_version: u64,
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
    catalog_id: ID,
    binding_commitment: vector<u8>,
}

public struct MakerControlTransferredV8 has copy, drop {
    root_id: ID,
    previous_owner: address,
    new_owner: address,
    previous_control_epoch: u64,
    new_control_epoch: u64,
    new_admin_cap_id: ID,
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

public fun new_onchain_native_rights_snapshot_v8(
    ctx: &TxContext,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
): RightsSnapshotV8 {
    new_rights_snapshot_internal_v8(
        RIGHTS_ONCHAIN_NATIVE,
        ctx.sender(),
        option::none(),
        option::none(),
        b"".to_string(),
        b"".to_string(),
        vector[],
        vector[],
        soul_creator_royalty_bps,
        maker_source_royalty_bps,
        maker_resale_royalty_bps,
    )
}

/// Release/transport certifies exact wrapped evidence for the transaction
/// signer. No author-controlled confirmation booleans enter this boundary.
public fun certify_wrapped_rights_v8<ReleaseAuthority: key>(
    config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    authority: &ReleaseAuthority,
    evidence_locator: String,
    evidence_blob_id: String,
    evidence_sha256: vector<u8>,
    terms_commitment: vector<u8>,
    ctx: &TxContext,
): WrappedRightsCertificationV8 {
    package_binding::assert_catalog_current_v8(config, catalog);
    package_binding::assert_release_authority_v8(catalog, authority);
    assert_non_empty_bounded(&evidence_locator, MAX_EVIDENCE_LOCATOR_BYTES);
    assert_non_empty_bounded(&evidence_blob_id, MAX_BLOB_ID_BYTES);
    assert_hash(&evidence_sha256);
    assert_hash(&terms_commitment);
    WrappedRightsCertificationV8 {
        creator: ctx.sender(),
        catalog_id: package_binding::catalog_id_v8(catalog),
        product_binding_commitment:
            *package_binding::product_binding_commitment_v8(
                package_binding::catalog_binding_v8(catalog),
            ),
        evidence_locator,
        evidence_blob_id,
        evidence_sha256,
        terms_commitment,
    }
}

public fun new_license_wrapped_rights_snapshot_v8(
    certification: WrappedRightsCertificationV8,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
): RightsSnapshotV8 {
    let WrappedRightsCertificationV8 {
        creator,
        catalog_id,
        product_binding_commitment,
        evidence_locator,
        evidence_blob_id,
        evidence_sha256,
        terms_commitment,
    } = certification;
    new_rights_snapshot_internal_v8(
        RIGHTS_LICENSE_WRAPPED,
        creator,
        option::some(catalog_id),
        option::some(product_binding_commitment),
        evidence_locator,
        evidence_blob_id,
        evidence_sha256,
        terms_commitment,
        soul_creator_royalty_bps,
        maker_source_royalty_bps,
        maker_resale_royalty_bps,
    )
}

fun new_rights_snapshot_internal_v8(
    origin: u8,
    creator: address,
    certification_catalog_id: Option<ID>,
    certification_binding_commitment: Option<vector<u8>>,
    evidence_locator: String,
    evidence_blob_id: String,
    evidence_sha256: vector<u8>,
    terms_commitment: vector<u8>,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
): RightsSnapshotV8 {
    assert!(origin == RIGHTS_ONCHAIN_NATIVE || origin == RIGHTS_LICENSE_WRAPPED, EInvalidRights);
    assert!(creator != @0x0, EInvalidRights);
    assert_rights_evidence(
        origin,
        &certification_catalog_id,
        &certification_binding_commitment,
        &evidence_locator,
        &evidence_blob_id,
        &evidence_sha256,
        &terms_commitment,
    );
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
        creator,
        creator_confirmed: true,
        evidence_certified: origin == RIGHTS_LICENSE_WRAPPED,
        certification_catalog_id,
        certification_binding_commitment,
        evidence_locator,
        evidence_blob_id,
        evidence_sha256,
        terms_commitment,
        soul_creator_royalty_bps,
        maker_source_royalty_bps,
        maker_resale_royalty_bps,
    }));
    RightsSnapshotV8 {
        origin,
        creator,
        creator_confirmed: true,
        evidence_certified: origin == RIGHTS_LICENSE_WRAPPED,
        certification_catalog_id,
        certification_binding_commitment,
        evidence_locator,
        evidence_blob_id,
        evidence_sha256,
        terms_commitment,
        soul_creator_royalty_bps,
        maker_source_royalty_bps,
        maker_resale_royalty_bps,
        commitment,
    }
}

public(package) fun new_initial_maker_draft_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    expected_base_definition_count: u64,
    expected_base_registry_commitment: vector<u8>,
    expected_pack_admission_policy_commitment: vector<u8>,
    maker_key: String,
    renderer_commitment: vector<u8>,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    economics: EconomicsSnapshotV8,
    rights: RightsSnapshotV8,
    clock: &Clock,
    ctx: &mut TxContext,
): (MakerRootV8<PaymentCoin>, MakerAdminCapV8) {
    new_maker_draft_internal_v8(
        config,
        expected_base_definition_count,
        expected_base_registry_commitment,
        expected_pack_admission_policy_commitment,
        maker_key,
        1,
        option::none(),
        option::none(),
        renderer_commitment,
        manifest_blob_id,
        manifest_sha256,
        content_commitment,
        economics,
        rights,
        clock,
        ctx,
    )
}

/// A successor takes its predecessor tuple only from the typed Root. The
/// caller supplies neither maker identity/version nor predecessor fields.
public(package) fun new_successor_maker_draft_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    previous: &mut MakerRootV8<PaymentCoin>,
    previous_admin: &MakerAdminCapV8,
    authority: SuccessorAuthorityV8<PaymentCoin>,
    expected_previous_control_epoch: u64,
    expected_base_definition_count: u64,
    expected_base_registry_commitment: vector<u8>,
    expected_pack_admission_policy_commitment: vector<u8>,
    renderer_commitment: vector<u8>,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    economics: EconomicsSnapshotV8,
    rights: RightsSnapshotV8,
    clock: &Clock,
    ctx: &mut TxContext,
): (MakerRootV8<PaymentCoin>, MakerAdminCapV8) {
    assert_admin_v8(previous, previous_admin);
    assert!(previous.owner == ctx.sender(), ENotCurrentOwner);
    assert!(
        previous.control_epoch == expected_previous_control_epoch,
        EControlEpochMismatch,
    );
    assert!(previous.lifecycle == ARCHIVED, EInvalidSuccessor);
    assert!(previous.maker_version < 0xffffffffffffffff, EInvalidSuccessor);
    assert!(previous.successor_root_id.is_none(), EInvalidSuccessor);
    assert_successor_authority(previous, &authority);
    let (successor, successor_admin) = new_maker_draft_internal_v8(
        config,
        expected_base_definition_count,
        expected_base_registry_commitment,
        expected_pack_admission_policy_commitment,
        previous.maker_key,
        previous.maker_version + 1,
        option::some(object::id(previous)),
        option::some(previous.version_commitment),
        renderer_commitment,
        manifest_blob_id,
        manifest_sha256,
        content_commitment,
        economics,
        rights,
        clock,
        ctx,
    );
    let successor_id = object::id(&successor);
    let SuccessorAuthorityV8 {
        id: authority_uid,
        version: _,
        previous_root_id: _,
        maker_key: _,
        maker_version: _,
        version_commitment: _,
        control_epoch: _,
        owner: _,
        allowed_lifecycle: _,
    } = authority;
    authority_uid.delete();
    previous.successor_authority_id = option::none();
    previous.successor_root_id = option::some(successor_id);
    (successor, successor_admin)
}

/// Issues exactly one persistable successor authority for an archived Root.
/// Core performs the transfer so this non-store capability cannot be routed
/// through an arbitrary public transfer path.
public fun issue_successor_authority_v8<PaymentCoin>(
    previous: &mut MakerRootV8<PaymentCoin>,
    previous_admin: &MakerAdminCapV8,
    expected_previous_control_epoch: u64,
    ctx: &mut TxContext,
) {
    let authority = new_successor_authority(
        previous,
        previous_admin,
        expected_previous_control_epoch,
        ctx,
    );
    transfer::transfer(authority, ctx.sender());
}

fun new_successor_authority<PaymentCoin>(
    previous: &mut MakerRootV8<PaymentCoin>,
    previous_admin: &MakerAdminCapV8,
    expected_previous_control_epoch: u64,
    ctx: &mut TxContext,
): SuccessorAuthorityV8<PaymentCoin> {
    assert_admin_v8(previous, previous_admin);
    assert!(previous.owner == ctx.sender(), ENotCurrentOwner);
    assert!(previous.control_epoch == expected_previous_control_epoch, EControlEpochMismatch);
    assert!(previous.lifecycle == ARCHIVED, EInvalidSuccessor);
    assert!(previous.maker_version < 0xffffffffffffffff, EInvalidSuccessor);
    assert!(previous.successor_root_id.is_none(), EInvalidSuccessor);
    assert!(previous.successor_authority_id.is_none(), ESuccessorAuthorityAlreadyIssued);
    let authority = SuccessorAuthorityV8<PaymentCoin> {
        id: object::new(ctx),
        version: VERSION,
        previous_root_id: object::id(previous),
        maker_key: previous.maker_key,
        maker_version: previous.maker_version,
        version_commitment: previous.version_commitment,
        control_epoch: previous.control_epoch,
        owner: previous.owner,
        allowed_lifecycle: ARCHIVED,
    };
    previous.successor_authority_id = option::some(object::id(&authority));
    authority
}

fun assert_successor_authority<PaymentCoin>(
    previous: &MakerRootV8<PaymentCoin>,
    authority: &SuccessorAuthorityV8<PaymentCoin>,
) {
    assert!(authority.version == VERSION, EInvalidSuccessorAuthority);
    assert!(previous.successor_authority_id.is_some(), EInvalidSuccessorAuthority);
    assert!(object::id(authority) == *previous.successor_authority_id.borrow(), EInvalidSuccessorAuthority);
    assert!(authority.previous_root_id == object::id(previous), EInvalidSuccessorAuthority);
    assert!(authority.maker_key == previous.maker_key, EInvalidSuccessorAuthority);
    assert!(authority.maker_version == previous.maker_version, EInvalidSuccessorAuthority);
    assert!(&authority.version_commitment == &previous.version_commitment, EInvalidSuccessorAuthority);
    assert!(authority.control_epoch == previous.control_epoch, EInvalidSuccessorAuthority);
    assert!(authority.owner == previous.owner, EInvalidSuccessorAuthority);
    assert!(authority.allowed_lifecycle == ARCHIVED, EInvalidSuccessorAuthority);
    assert!(previous.lifecycle == authority.allowed_lifecycle, EInvalidSuccessorAuthority);
}

/// Same-transaction IDs are fields, not inputs to precomputable commitments.
fun new_maker_draft_internal_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    expected_base_definition_count: u64,
    expected_base_registry_commitment: vector<u8>,
    expected_pack_admission_policy_commitment: vector<u8>,
    maker_key: String,
    maker_version: u64,
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
    assert!(maker_version > 0, EInvalidLineage);
    assert_non_empty_bounded(&manifest_blob_id, MAX_BLOB_ID_BYTES);
    assert_hash(&expected_base_registry_commitment);
    assert_hash(&expected_pack_admission_policy_commitment);
    assert_hash(&renderer_commitment);
    assert_hash(&manifest_sha256);
    assert_hash(&content_commitment);
    assert_lineage(&previous_root_id, &previous_version_commitment);
    assert_economics_snapshot_v8<PaymentCoin>(config, &economics);
    assert_rights_snapshot_v8(&rights);
    assert!(rights.creator == ctx.sender(), ENotCurrentOwner);

    let root_uid = object::new(ctx);
    let root_id = root_uid.to_inner();
    let owner = ctx.sender();
    let admin = MakerAdminCapV8 {
        id: object::new(ctx),
        version: VERSION,
        root_id,
        owner,
        control_epoch: 0,
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
        control_epoch: 0,
        lifecycle: DRAFT,
        maker_key,
        maker_version,
        version_commitment,
        previous_root_id,
        previous_version_commitment,
        successor_authority_id: option::none(),
        successor_root_id: option::none(),
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

/// One-time DRAFT finalization. The proof is non-store/non-copy and can only
/// carry the exact protocol-admin-certified catalog tuple.
public fun finalize_product_release_binding_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8,
    witness: ReleaseCatalogWitnessV8,
    ctx: &TxContext,
) {
    assert_draft_admin_v8(root, admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    assert!(
        root.product_release_binding.is_none(),
        EProductBindingAlreadyFinalized,
    );
    assert_current_protocol_config_v8(root, config);
    let certified = package_binding::consume_release_catalog_witness_v8(witness);
    package_binding::assert_certified_binding_v8(&certified);
    assert!(
        package_binding::certified_protocol_config_id_v8(&certified)
            == root.protocol_config_id,
        ECatalogMismatch,
    );
    assert!(
        package_binding::certified_protocol_config_revision_v8(&certified)
            == root.protocol_config_revision,
        ECatalogMismatch,
    );
    assert!(
        package_binding::certified_protocol_config_commitment_v8(&certified)
            == &root.protocol_config_commitment,
        ECatalogMismatch,
    );
    let binding = package_binding::certified_binding_v8(&certified);
    let core = package_binding::core_binding_v8(binding);
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
    let binding_commitment = *package_binding::product_binding_commitment_v8(binding);
    let catalog_id = package_binding::certified_catalog_id_v8(&certified);
    if (root.rights.origin == RIGHTS_LICENSE_WRAPPED) {
        assert!(root.rights.certification_catalog_id.is_some(), ECatalogMismatch);
        assert!(root.rights.certification_binding_commitment.is_some(), ECatalogMismatch);
        assert!(
            *root.rights.certification_catalog_id.borrow() == catalog_id,
            ECatalogMismatch,
        );
        assert!(
            root.rights.certification_binding_commitment.borrow()
                == &binding_commitment,
            ECatalogMismatch,
        );
    };
    root.product_release_binding = option::some(certified);
    event::emit(ProductReleaseBindingFinalizedV8 {
        root_id: object::id(root),
        catalog_id,
        binding_commitment,
    });
}

/// Binds only the stable Pack registry/admission authority and immutable
/// policy. It intentionally records no Pack count, release set, or registry
/// revision; those remain Runtime-owned CAS state after activation.
public fun finalize_pack_admission_binding_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8,
    readiness: RuntimePackReadinessV8,
    ctx: &TxContext,
) {
    assert_draft_admin_v8(root, admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    assert_current_protocol_config_v8(root, config);
    assert!(
        root.pack_admission_binding.is_none(),
        EPackAdmissionAlreadyFinalized,
    );
    assert!(root.product_release_binding.is_some(), EProductBindingMissing);
    let certified = root.product_release_binding.borrow();
    let product = package_binding::certified_binding_v8(certified);
    let (
        catalog_id,
        product_binding_commitment,
        readiness_root_id,
        readiness_root_version,
        readiness_root_content_commitment,
        pack_registry_id,
        admission_authority_id,
        policy_commitment,
    ) = package_binding::consume_runtime_pack_readiness_v8(readiness);
    assert!(
        catalog_id == package_binding::certified_catalog_id_v8(certified),
        ECatalogMismatch,
    );
    assert!(
        &product_binding_commitment
            == package_binding::product_binding_commitment_v8(product),
        ECatalogMismatch,
    );
    assert_root_identity_v8(
        root,
        readiness_root_id,
        readiness_root_version,
        &readiness_root_content_commitment,
    );
    assert!(
        &policy_commitment == &root.expected_pack_admission_policy_commitment,
        EInvalidCommitment,
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
        package_binding::certified_binding_v8(root.product_release_binding.borrow()),
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
    let product = package_binding::certified_binding_v8(
        root.product_release_binding.borrow(),
    );
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
    assert!(admin.control_epoch == root.control_epoch, EInvalidAdminCap);
}

public fun assert_creator_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    expected_creator: address,
) {
    assert!(root.creator == expected_creator, ENotCurrentOwner);
}

/// Companion packages call this at the point of mutation/payment. It proves
/// the protocol is still enabled and the entire Root/economics snapshot is
/// the exact current config, not merely the same config object ID.
public fun assert_current_protocol_config_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    config: &ProtocolConfigV8,
) {
    protocol::assert_exact_snapshot_v8<PaymentCoin>(
        config,
        root.protocol_config_id,
        root.protocol_config_revision,
        &root.protocol_config_commitment,
    );
    assert_economics_snapshot_v8<PaymentCoin>(config, &root.economics);
}

public fun assert_control_epoch_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    expected_control_epoch: u64,
) {
    assert!(root.control_epoch == expected_control_epoch, EControlEpochMismatch);
}

/// Consumes the current non-store AdminCap and transfers a fresh exact cap to
/// the new controller. Immutable Root/Base/Pack content bindings do not use
/// this epoch and remain valid.
public fun transfer_maker_control_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: MakerAdminCapV8,
    expected_control_epoch: u64,
    new_owner: address,
    ctx: &mut TxContext,
) {
    let next = rotate_maker_control_v8(
        root,
        admin,
        expected_control_epoch,
        new_owner,
        ctx,
    );
    transfer::transfer(next, new_owner);
}

fun rotate_maker_control_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: MakerAdminCapV8,
    expected_control_epoch: u64,
    new_owner: address,
    ctx: &mut TxContext,
): MakerAdminCapV8 {
    assert_admin_v8(root, &admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    assert!(root.control_epoch == expected_control_epoch, EControlEpochMismatch);
    assert!(root.control_epoch < 0xffffffffffffffff, EControlEpochMismatch);
    assert!(new_owner != @0x0 && new_owner != root.owner, ENotCurrentOwner);
    let previous_owner = root.owner;
    let previous_control_epoch = root.control_epoch;
    let MakerAdminCapV8 {
        id: old_admin_uid,
        version: _,
        root_id: _,
        owner: _,
        control_epoch: _,
    } = admin;
    old_admin_uid.delete();
    root.owner = new_owner;
    root.control_epoch = previous_control_epoch + 1;
    let next = MakerAdminCapV8 {
        id: object::new(ctx),
        version: VERSION,
        root_id: object::id(root),
        owner: new_owner,
        control_epoch: root.control_epoch,
    };
    root.admin_cap_id = object::id(&next);
    event::emit(MakerControlTransferredV8 {
        root_id: object::id(root),
        previous_owner,
        new_owner,
        previous_control_epoch,
        new_control_epoch: root.control_epoch,
        new_admin_cap_id: root.admin_cap_id,
    });
    next
}

public fun assert_base_registry_identity_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: &vector<u8>,
) {
    assert!(root.base_registry_id.is_some(), EBaseRegistryMissing);
    assert!(
        registry_id == *root.base_registry_id.borrow(),
        EBaseRegistryMismatch,
    );
    assert!(root_id == object::id(root), EBaseRegistryMismatch);
    assert!(maker_version == root.maker_version, EBaseRegistryMismatch);
    assert!(
        root_content_commitment == &root.content_commitment,
        EBaseRegistryMismatch,
    );
}

public fun assert_root_identity_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: &vector<u8>,
) {
    assert!(root_id == object::id(root), EBaseRegistryMismatch);
    assert!(maker_version == root.maker_version, EBaseRegistryMismatch);
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

public fun assert_economics_snapshot_v8<PaymentCoin>(
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

public fun assert_rights_snapshot_v8(rights: &RightsSnapshotV8) {
    assert!(
        rights.origin == RIGHTS_ONCHAIN_NATIVE
            || rights.origin == RIGHTS_LICENSE_WRAPPED,
        EInvalidRights,
    );
    assert!(rights.creator != @0x0, EInvalidRights);
    assert!(rights.creator_confirmed, EInvalidRights);
    assert!(rights.evidence_certified == (rights.origin == RIGHTS_LICENSE_WRAPPED), EInvalidRights);
    assert_rights_evidence(
        rights.origin,
        &rights.certification_catalog_id,
        &rights.certification_binding_commitment,
        &rights.evidence_locator,
        &rights.evidence_blob_id,
        &rights.evidence_sha256,
        &rights.terms_commitment,
    );
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
        creator: rights.creator,
        creator_confirmed: rights.creator_confirmed,
        evidence_certified: rights.evidence_certified,
        certification_catalog_id: rights.certification_catalog_id,
        certification_binding_commitment: rights.certification_binding_commitment,
        evidence_locator: rights.evidence_locator,
        evidence_blob_id: rights.evidence_blob_id,
        evidence_sha256: rights.evidence_sha256,
        terms_commitment: rights.terms_commitment,
        soul_creator_royalty_bps: rights.soul_creator_royalty_bps,
        maker_source_royalty_bps: rights.maker_source_royalty_bps,
        maker_resale_royalty_bps: rights.maker_resale_royalty_bps,
    }));
    assert!(&expected == &rights.commitment, EInvalidRights);
}

fun assert_rights_evidence(
    origin: u8,
    certification_catalog_id: &Option<ID>,
    certification_binding_commitment: &Option<vector<u8>>,
    evidence_locator: &String,
    evidence_blob_id: &String,
    evidence_sha256: &vector<u8>,
    terms_commitment: &vector<u8>,
) {
    if (origin == RIGHTS_ONCHAIN_NATIVE) {
        assert!(certification_catalog_id.is_none(), EInvalidRights);
        assert!(certification_binding_commitment.is_none(), EInvalidRights);
        assert!(string::as_bytes(evidence_locator).is_empty(), EInvalidRights);
        assert!(string::as_bytes(evidence_blob_id).is_empty(), EInvalidRights);
        assert!(evidence_sha256.is_empty(), EInvalidRights);
        assert!(terms_commitment.is_empty(), EInvalidRights);
    } else {
        assert!(origin == RIGHTS_LICENSE_WRAPPED, EInvalidRights);
        assert!(certification_catalog_id.is_some(), EInvalidRights);
        assert!(certification_binding_commitment.is_some(), EInvalidRights);
        assert_hash(certification_binding_commitment.borrow());
        assert_non_empty_bounded(evidence_locator, MAX_EVIDENCE_LOCATOR_BYTES);
        assert_non_empty_bounded(evidence_blob_id, MAX_BLOB_ID_BYTES);
        assert_hash(evidence_sha256);
        assert_hash(terms_commitment);
    };
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
    let mut any_nonzero = false;
    let mut index = 0;
    while (index < HASH_LENGTH) {
        if (value[index] != 0) any_nonzero = true;
        index = index + 1;
    };
    assert!(any_nonzero, EInvalidCommitment);
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
public fun root_creator_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): address {
    root.creator
}
public fun root_maker_key_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): &String {
    &root.maker_key
}
public fun root_maker_version_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u64 {
    root.maker_version
}
public fun root_previous_root_id_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &Option<ID> { &root.previous_root_id }
public fun root_previous_version_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &Option<vector<u8>> { &root.previous_version_commitment }
public fun root_successor_authority_id_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &Option<ID> { &root.successor_authority_id }
public fun root_successor_root_id_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &Option<ID> { &root.successor_root_id }
public fun root_control_epoch_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u64 {
    root.control_epoch
}
public fun root_lifecycle_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u8 {
    root.lifecycle
}
public fun root_protocol_config_id_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): ID { root.protocol_config_id }
public fun root_protocol_config_revision_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): u64 { root.protocol_config_revision }
public fun root_protocol_config_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> { &root.protocol_config_commitment }
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
    package_binding::certified_binding_v8(root.product_release_binding.borrow())
}
public fun root_product_release_catalog_id_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): ID {
    assert!(root.product_release_binding.is_some(), EProductBindingMissing);
    package_binding::certified_catalog_id_v8(root.product_release_binding.borrow())
}
public fun root_native_capability_mask_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): u64 {
    let binding = root_product_release_binding_v8(root);
    let mask = package_binding::binding_native_capability_mask_v8(binding);
    assert!(mask == package_binding::native_capability_mask_v8(), ECatalogMismatch);
    mask
}
public fun assert_native_capability_mask_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
) {
    let binding = root_product_release_binding_v8(root);
    package_binding::assert_native_capability_mask_v8(binding);
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
public fun admin_id_v8(admin: &MakerAdminCapV8): ID { object::id(admin) }
public fun admin_owner_v8(admin: &MakerAdminCapV8): address { admin.owner }
public fun admin_control_epoch_v8(admin: &MakerAdminCapV8): u64 {
    admin.control_epoch
}

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
public fun economics_complete_free_quota_per_wallet_v8(
    economics: &EconomicsSnapshotV8,
): u64 { economics.complete_per_wallet_quota }
public fun economics_complete_total_cap_v8(
    economics: &EconomicsSnapshotV8,
): u64 { economics.complete_total_cap }
public fun economics_payment_coin_type_v8(
    economics: &EconomicsSnapshotV8,
): &String { &economics.payment_coin_type }
public fun economics_protocol_config_id_v8(economics: &EconomicsSnapshotV8): ID {
    economics.protocol_config_id
}
public fun economics_protocol_config_revision_v8(
    economics: &EconomicsSnapshotV8,
): u64 { economics.protocol_config_revision }
public fun economics_protocol_config_commitment_v8(
    economics: &EconomicsSnapshotV8,
): &vector<u8> { &economics.protocol_config_commitment }
public fun economics_primary_content_fee_bps_v8(
    economics: &EconomicsSnapshotV8,
): u16 { economics.primary_content_fee_bps }
public fun economics_fixed_complete_fee_atomic_v8(
    economics: &EconomicsSnapshotV8,
): u64 { economics.fixed_complete_fee_atomic }
public fun economics_maker_market_fee_bps_v8(
    economics: &EconomicsSnapshotV8,
): u16 { economics.maker_market_fee_bps }
public fun economics_soul_market_fee_bps_v8(
    economics: &EconomicsSnapshotV8,
): u16 { economics.soul_market_fee_bps }
public fun economics_commitment_v8(
    economics: &EconomicsSnapshotV8,
): &vector<u8> { &economics.commitment }
public fun rights_commitment_v8(rights: &RightsSnapshotV8): &vector<u8> {
    &rights.commitment
}
public fun rights_origin_v8(rights: &RightsSnapshotV8): u8 { rights.origin }
public fun rights_creator_v8(rights: &RightsSnapshotV8): address { rights.creator }
public fun rights_creator_confirmed_v8(rights: &RightsSnapshotV8): bool {
    rights.creator_confirmed
}
public fun rights_evidence_certified_v8(rights: &RightsSnapshotV8): bool {
    rights.evidence_certified
}
public fun rights_certification_catalog_id_v8(
    rights: &RightsSnapshotV8,
): &Option<ID> { &rights.certification_catalog_id }
public fun rights_certification_binding_commitment_v8(
    rights: &RightsSnapshotV8,
): &Option<vector<u8>> { &rights.certification_binding_commitment }
public fun rights_evidence_locator_v8(rights: &RightsSnapshotV8): &String {
    &rights.evidence_locator
}
public fun rights_evidence_blob_id_v8(rights: &RightsSnapshotV8): &String {
    &rights.evidence_blob_id
}
public fun rights_evidence_sha256_v8(rights: &RightsSnapshotV8): &vector<u8> {
    &rights.evidence_sha256
}
public fun rights_terms_commitment_v8(rights: &RightsSnapshotV8): &vector<u8> {
    &rights.terms_commitment
}
public fun rights_soul_creator_royalty_bps_v8(rights: &RightsSnapshotV8): u16 {
    rights.soul_creator_royalty_bps
}
public fun rights_maker_source_royalty_bps_v8(rights: &RightsSnapshotV8): u16 {
    rights.maker_source_royalty_bps
}
public fun rights_maker_resale_royalty_bps_v8(rights: &RightsSnapshotV8): u16 {
    rights.maker_resale_royalty_bps
}

public fun successor_authority_previous_root_id_v8<PaymentCoin>(
    authority: &SuccessorAuthorityV8<PaymentCoin>,
): ID { authority.previous_root_id }
public fun successor_authority_maker_version_v8<PaymentCoin>(
    authority: &SuccessorAuthorityV8<PaymentCoin>,
): u64 { authority.maker_version }
public fun successor_authority_control_epoch_v8<PaymentCoin>(
    authority: &SuccessorAuthorityV8<PaymentCoin>,
): u64 { authority.control_epoch }
public fun successor_authority_owner_v8<PaymentCoin>(
    authority: &SuccessorAuthorityV8<PaymentCoin>,
): address { authority.owner }

#[test_only]
public fun set_lifecycle_for_testing<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    lifecycle: u8,
) {
    root.lifecycle = lifecycle;
}

#[test_only]
public fun rotate_maker_control_for_testing<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: MakerAdminCapV8,
    expected_control_epoch: u64,
    new_owner: address,
    ctx: &mut TxContext,
): MakerAdminCapV8 {
    rotate_maker_control_v8(root, admin, expected_control_epoch, new_owner, ctx)
}

#[test_only]
public fun destroy_successor_authority_for_testing<PaymentCoin>(
    authority: SuccessorAuthorityV8<PaymentCoin>,
) {
    let SuccessorAuthorityV8 {
        id,
        version: _,
        previous_root_id: _,
        maker_key: _,
        maker_version: _,
        version_commitment: _,
        control_epoch: _,
        owner: _,
        allowed_lifecycle: _,
    } = authority;
    id.delete();
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
        control_epoch: _,
        lifecycle: _,
        maker_key: _,
        maker_version: _,
        version_commitment: _,
        previous_root_id: _,
        previous_version_commitment: _,
        successor_authority_id: _,
        successor_root_id: _,
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
        control_epoch: _,
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
    let rights = new_onchain_native_rights_snapshot_v8(
        ctx,
        250,
        250,
        500,
    );
    let clock = sui::clock::create_for_testing(ctx);
    let (root, admin) = new_initial_maker_draft_v8<sui::sui::SUI>(
        &config,
        4,
        test_hash(1),
        test_hash(2),
        b"maker".to_string(),
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
fun wrapped_rights_certification_for_testing(
    creator: address,
    evidence_locator: String,
    evidence_blob_id: String,
    evidence_sha256: vector<u8>,
    terms_commitment: vector<u8>,
): WrappedRightsCertificationV8 {
    WrappedRightsCertificationV8 {
        creator,
        catalog_id: object::id_from_address(@0xCA),
        product_binding_commitment: test_hash(99),
        evidence_locator,
        evidence_blob_id,
        evidence_sha256,
        terms_commitment,
    }
}

#[test_only]
fun new_test_catalog(
    config: &ProtocolConfigV8,
    root: &MakerRootV8<sui::sui::SUI>,
    ctx: &mut TxContext,
): ProductReleaseCatalogV8 {
    package_binding::product_release_catalog_for_testing(
        config,
        root.core_original_package_id.to_address(),
        root.core_callable_package_id.to_address(),
        ctx,
    )
}

#[test_only]
fun finalize_test_product(
    root: &mut MakerRootV8<sui::sui::SUI>,
    admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    ctx: &TxContext,
) {
    let witness = package_binding::release_catalog_witness_for_testing(catalog);
    finalize_product_release_binding_v8(root, admin, config, witness, ctx);
}

#[test_only]
fun test_pack_readiness(
    root: &MakerRootV8<sui::sui::SUI>,
    catalog: &ProductReleaseCatalogV8,
    registry: address,
    authority: address,
): RuntimePackReadinessV8 {
    package_binding::runtime_pack_readiness_for_testing(
        catalog,
        object::id(root),
        root.maker_version,
        root.content_commitment,
        object::id_from_address(registry),
        object::id_from_address(authority),
        root.expected_pack_admission_policy_commitment,
    )
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
    let catalog = new_test_catalog(&config, &root, &mut ctx);
    finalize_test_product(&mut root, &admin, &config, &catalog, &ctx);
    assert_activation_scaffold_ready_v8(&root);
    package_binding::destroy_catalog_for_testing(catalog);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = EProductBindingAlreadyFinalized)]
fun product_binding_cannot_be_replaced() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 13, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    let catalog = new_test_catalog(&config, &root, &mut ctx);
    finalize_test_product(&mut root, &admin, &config, &catalog, &ctx);
    finalize_test_product(&mut root, &admin, &config, &catalog, &ctx);
    package_binding::destroy_catalog_for_testing(catalog);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = ECorePackageMismatch)]
fun wrong_core_type_origin_binding_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 14, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    let catalog = package_binding::product_release_catalog_for_testing(
        &config,
        @0x77,
        @0x78,
        &mut ctx,
    );
    finalize_test_product(&mut root, &admin, &config, &catalog, &ctx);
    package_binding::destroy_catalog_for_testing(catalog);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = EPackAdmissionAlreadyFinalized)]
fun pack_admission_binding_cannot_be_replaced() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 15, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    let catalog = new_test_catalog(&config, &root, &mut ctx);
    finalize_test_product(&mut root, &admin, &config, &catalog, &ctx);
    let readiness = test_pack_readiness(&root, &catalog, @0xC0, @0xC1);
    finalize_pack_admission_binding_v8(
        &mut root,
        &admin,
        &config,
        readiness,
        &ctx,
    );
    let replacement = test_pack_readiness(&root, &catalog, @0xC2, @0xC3);
    finalize_pack_admission_binding_v8(
        &mut root,
        &admin,
        &config,
        replacement,
        &ctx,
    );
    package_binding::destroy_catalog_for_testing(catalog);
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
    let catalog = new_test_catalog(&config, &root, &mut ctx);
    finalize_test_product(&mut root, &admin, &config, &catalog, &ctx);
    let readiness = test_pack_readiness(&root, &catalog, @0xC0, @0xC1);
    finalize_pack_admission_binding_v8(
        &mut root,
        &admin,
        &config,
        readiness,
        &ctx,
    );
    assert_activation_scaffold_ready_v8(&root);
    let binding = root_pack_admission_binding_v8(&root);
    assert!(binding.pack_registry_id == object::id_from_address(@0xC0), EBaseRegistryMismatch);
    assert!(
        binding.admission_authority_id == object::id_from_address(@0xC1),
        EBaseRegistryMismatch,
    );
    assert!(root_native_capability_mask_v8(&root) == 127, ECatalogMismatch);
    package_binding::destroy_catalog_for_testing(catalog);
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
    let catalog = new_test_catalog(&config, &root, &mut ctx);
    finalize_test_product(&mut root, &admin, &config, &catalog, &ctx);
    package_binding::destroy_catalog_for_testing(catalog);
    destroy_test_maker(config, protocol_cap, root, admin);
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

#[test]
fun complete_total_cap_boundaries_are_exact() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 18, 0, 0, 0);
    let (config, cap) = protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let unbounded = new_economics_snapshot_v8<sui::sui::SUI>(
        &config,
        ACCESS_FREE,
        0,
        COMPLETE_FREE_QUOTA_THEN_PAID,
        1,
        10,
        0,
    );
    assert!(economics_complete_total_cap_v8(&unbounded) == 0, EInvalidEconomics);
    let exact = new_economics_snapshot_v8<sui::sui::SUI>(
        &config,
        ACCESS_FREE,
        0,
        COMPLETE_FREE_QUOTA_THEN_BLOCK,
        0,
        10,
        10,
    );
    assert!(
        economics_complete_free_quota_per_wallet_v8(&exact)
            == economics_complete_total_cap_v8(&exact),
        EInvalidEconomics,
    );
    protocol::destroy_protocol_for_testing(config, cap);
}

#[test, expected_failure(abort_code = EInvalidEconomics)]
fun complete_total_cap_below_wallet_quota_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 19, 0, 0, 0);
    let (config, cap) = protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    new_economics_snapshot_v8<sui::sui::SUI>(
        &config,
        ACCESS_FREE,
        0,
        COMPLETE_FREE_QUOTA_THEN_PAID,
        1,
        10,
        9,
    );
    protocol::destroy_protocol_for_testing(config, cap);
}

#[test]
fun wrapped_rights_commit_exact_certified_evidence() {
    let certification = wrapped_rights_certification_for_testing(
        @0xA11,
        b"https://license.example/terms".to_string(),
        b"license-blob".to_string(),
        test_hash(20),
        test_hash(21),
    );
    let rights = new_license_wrapped_rights_snapshot_v8(
        certification,
        250,
        250,
        500,
    );
    assert_rights_snapshot_v8(&rights);
    assert!(rights_evidence_certified_v8(&rights), EInvalidRights);
    assert!(rights_evidence_sha256_v8(&rights) == &test_hash(20), EInvalidRights);
    assert!(rights_terms_commitment_v8(&rights) == &test_hash(21), EInvalidRights);
}

#[test]
fun wrapped_rights_require_exact_catalog_release_authority() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 192, 0, 0, 0);
    let (config, protocol_cap) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let catalog = package_binding::authority_catalog_for_testing(&config, &mut ctx);
    let authority = package_binding::new_release_authority_for_testing(&mut ctx);
    let certification = certify_wrapped_rights_v8(
        &config,
        &catalog,
        &authority,
        b"https://license.example/exact".to_string(),
        b"license-blob".to_string(),
        test_hash(40),
        test_hash(41),
        &ctx,
    );
    let rights = new_license_wrapped_rights_snapshot_v8(
        certification,
        250,
        250,
        500,
    );
    assert!(rights.creator == @0xA11, EInvalidRights);
    assert!(*rights.certification_catalog_id.borrow() == object::id(&catalog), EInvalidRights);
    assert!(
        rights.certification_binding_commitment.borrow()
            == package_binding::product_binding_commitment_v8(
                package_binding::catalog_binding_v8(&catalog),
            ),
        EInvalidRights,
    );
    package_binding::destroy_release_authority_for_testing(authority);
    package_binding::destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
}

#[test, expected_failure(abort_code = 7)]
fun wrapped_rights_reject_wrong_package_authority() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 193, 0, 0, 0);
    let (config, protocol_cap) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let catalog = package_binding::authority_catalog_for_testing(&config, &mut ctx);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let certification = certify_wrapped_rights_v8(
        &config,
        &catalog,
        &clock,
        b"https://license.example/forged".to_string(),
        b"license-blob".to_string(),
        test_hash(40),
        test_hash(41),
        &ctx,
    );
    let rights = new_license_wrapped_rights_snapshot_v8(certification, 250, 250, 500);
    let _ = rights;
    clock.destroy_for_testing();
    package_binding::destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
}

#[test, expected_failure(abort_code = 7)]
fun runtime_tuple_rejects_non_runtime_authority() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 194, 0, 0, 0);
    let (config, protocol_cap) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let catalog = package_binding::authority_catalog_for_testing(&config, &mut ctx);
    let wrong_authority = package_binding::new_release_authority_for_testing(&mut ctx);
    let readiness = package_binding::certify_runtime_pack_readiness_v8<
        sui::clock::Clock,
        package_binding::TestReleaseAuthorityV8,
    >(
        &catalog,
        &wrong_authority,
        object::id_from_address(@0xAA),
        1,
        test_hash(50),
        object::id_from_address(@0xBB),
        object::id_from_address(@0xCC),
        test_hash(51),
    );
    let (_, _, _, _, _, _, _, _) =
        package_binding::consume_runtime_pack_readiness_v8(readiness);
    package_binding::destroy_release_authority_for_testing(wrong_authority);
    package_binding::destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
}

#[test, expected_failure(abort_code = EInvalidRights)]
fun native_rights_reject_nonempty_wrapped_evidence() {
    new_rights_snapshot_internal_v8(
        RIGHTS_ONCHAIN_NATIVE,
        @0xA11,
        option::none(),
        option::none(),
        b"should-be-empty".to_string(),
        b"".to_string(),
        vector[],
        vector[],
        250,
        250,
        500,
    );
}

#[test, expected_failure(abort_code = EInvalidRights)]
fun wrapped_rights_reject_missing_typed_certification() {
    new_rights_snapshot_internal_v8(
        RIGHTS_LICENSE_WRAPPED,
        @0xA11,
        option::none(),
        option::none(),
        b"https://license.example/terms".to_string(),
        b"license-blob".to_string(),
        test_hash(20),
        test_hash(21),
        250,
        250,
        500,
    );
}

#[test, expected_failure(abort_code = EInvalidString)]
fun wrapped_rights_reject_empty_certified_evidence() {
    let certification = wrapped_rights_certification_for_testing(
        @0xA11,
        b"".to_string(),
        b"".to_string(),
        test_hash(20),
        test_hash(21),
    );
    new_license_wrapped_rights_snapshot_v8(
        certification,
        250,
        250,
        500,
    );
}

#[test]
fun native_rights_derive_creator_and_exact_empty_evidence() {
    let ctx = sui::tx_context::new_from_hint(@0xA11, 191, 0, 0, 0);
    let rights = new_onchain_native_rights_snapshot_v8(&ctx, 250, 250, 500);
    assert!(rights.creator == @0xA11, EInvalidRights);
    assert!(rights.creator_confirmed, EInvalidRights);
    assert!(!rights.evidence_certified, EInvalidRights);
    assert!(rights.certification_catalog_id.is_none(), EInvalidRights);
    assert!(rights.certification_binding_commitment.is_none(), EInvalidRights);
    assert!(string::as_bytes(&rights.evidence_locator).is_empty(), EInvalidRights);
    assert!(string::as_bytes(&rights.evidence_blob_id).is_empty(), EInvalidRights);
    assert!(rights.evidence_sha256.is_empty(), EInvalidRights);
    assert!(rights.terms_commitment.is_empty(), EInvalidRights);
}

#[test, expected_failure(abort_code = EBaseRegistryMismatch)]
fun typed_pack_proof_rejects_wrong_immutable_root_tuple() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 20, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    let catalog = new_test_catalog(&config, &root, &mut ctx);
    finalize_test_product(&mut root, &admin, &config, &catalog, &ctx);
    let readiness = package_binding::runtime_pack_readiness_for_testing(
        &catalog,
        object::id_from_address(@0xDEAD),
        root.maker_version,
        root.content_commitment,
        object::id_from_address(@0xC0),
        object::id_from_address(@0xC1),
        root.expected_pack_admission_policy_commitment,
    );
    finalize_pack_admission_binding_v8(&mut root, &admin, &config, readiness, &ctx);
    package_binding::destroy_catalog_for_testing(catalog);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test]
fun typed_successor_derives_exact_predecessor_and_version() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 21, 0, 0, 0);
    let (config, protocol_cap, mut previous, previous_admin) =
        new_test_maker(&mut ctx);
    set_lifecycle_for_testing(&mut previous, ARCHIVED);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let authority = new_successor_authority(
        &mut previous,
        &previous_admin,
        0,
        &mut ctx,
    );
    let economics = previous.economics;
    let rights = previous.rights;
    let (successor, successor_admin) = new_successor_maker_draft_v8(
        &config,
        &mut previous,
        &previous_admin,
        authority,
        0,
        4,
        test_hash(31),
        test_hash(32),
        test_hash(33),
        b"successor-blob".to_string(),
        test_hash(34),
        test_hash(35),
        economics,
        rights,
        &clock,
        &mut ctx,
    );
    assert!(successor.maker_key == previous.maker_key, EInvalidSuccessor);
    assert!(successor.maker_version == previous.maker_version + 1, EInvalidSuccessor);
    assert!(*previous.successor_root_id.borrow() == object::id(&successor), EInvalidSuccessor);
    assert!(previous.successor_authority_id.is_none(), EInvalidSuccessor);
    assert!(*successor.previous_root_id.borrow() == object::id(&previous), EInvalidSuccessor);
    assert!(
        successor.previous_version_commitment.borrow() == &previous.version_commitment,
        EInvalidSuccessor,
    );
    destroy_maker_for_testing(successor, successor_admin);
    destroy_maker_for_testing(previous, previous_admin);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = EInvalidSuccessor)]
fun same_transaction_cannot_issue_second_successor_after_consumption() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 211, 0, 0, 0);
    let (config, protocol_cap, mut previous, previous_admin) =
        new_test_maker(&mut ctx);
    set_lifecycle_for_testing(&mut previous, ARCHIVED);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let authority = new_successor_authority(
        &mut previous,
        &previous_admin,
        0,
        &mut ctx,
    );
    let economics = previous.economics;
    let rights = previous.rights;
    let (successor, successor_admin) = new_successor_maker_draft_v8(
        &config,
        &mut previous,
        &previous_admin,
        authority,
        0,
        4,
        test_hash(31),
        test_hash(32),
        test_hash(33),
        b"successor-blob".to_string(),
        test_hash(34),
        test_hash(35),
        economics,
        rights,
        &clock,
        &mut ctx,
    );
    destroy_maker_for_testing(successor, successor_admin);
    let replay = new_successor_authority(
        &mut previous,
        &previous_admin,
        0,
        &mut ctx,
    );
    destroy_successor_authority_for_testing(replay);
    destroy_maker_for_testing(previous, previous_admin);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = EInvalidSuccessor)]
fun cross_transaction_successor_replay_is_rejected_by_predecessor_cas() {
    let sender = @0xA11;
    let mut scenario = sui::test_scenario::begin(sender);
    {
        let ctx = scenario.ctx();
        let (config, protocol_cap, mut previous, previous_admin) =
            new_test_maker(ctx);
        set_lifecycle_for_testing(&mut previous, ARCHIVED);
        protocol::share_protocol_for_testing(config, protocol_cap, ctx);
        transfer::share_object(previous);
        transfer::transfer(previous_admin, sender);
    };
    scenario.next_tx(sender);
    {
        let mut previous = scenario.take_shared<MakerRootV8<sui::sui::SUI>>();
        let previous_admin = scenario.take_from_sender<MakerAdminCapV8>();
        issue_successor_authority_v8(
            &mut previous,
            &previous_admin,
            0,
            scenario.ctx(),
        );
        sui::test_scenario::return_shared(previous);
        scenario.return_to_sender(previous_admin);
    };
    scenario.next_tx(sender);
    {
        let config = scenario.take_shared<ProtocolConfigV8>();
        let mut previous = scenario.take_shared<MakerRootV8<sui::sui::SUI>>();
        let previous_admin = scenario.take_from_sender<MakerAdminCapV8>();
        let authority = scenario.take_from_sender<SuccessorAuthorityV8<sui::sui::SUI>>();
        let clock = sui::clock::create_for_testing(scenario.ctx());
        let economics = previous.economics;
        let rights = previous.rights;
        let (successor, successor_admin) = new_successor_maker_draft_v8(
            &config,
            &mut previous,
            &previous_admin,
            authority,
            0,
            4,
            test_hash(31),
            test_hash(32),
            test_hash(33),
            b"successor-blob".to_string(),
            test_hash(34),
            test_hash(35),
            economics,
            rights,
            &clock,
            scenario.ctx(),
        );
        destroy_maker_for_testing(successor, successor_admin);
        clock.destroy_for_testing();
        sui::test_scenario::return_shared(config);
        sui::test_scenario::return_shared(previous);
        scenario.return_to_sender(previous_admin);
    };
    scenario.next_tx(sender);
    {
        let mut previous = scenario.take_shared<MakerRootV8<sui::sui::SUI>>();
        let previous_admin = scenario.take_from_sender<MakerAdminCapV8>();
        issue_successor_authority_v8(
            &mut previous,
            &previous_admin,
            0,
            scenario.ctx(),
        );
        sui::test_scenario::return_shared(previous);
        scenario.return_to_sender(previous_admin);
    };
    scenario.end();
}

#[test, expected_failure(abort_code = EInvalidSuccessor)]
fun draft_predecessor_cannot_issue_successor_authority() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 22, 0, 0, 0);
    let (config, protocol_cap, mut previous, previous_admin) = new_test_maker(&mut ctx);
    let authority = new_successor_authority(
        &mut previous,
        &previous_admin,
        0,
        &mut ctx,
    );
    destroy_successor_authority_for_testing(authority);
    destroy_maker_for_testing(previous, previous_admin);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
}

#[test, expected_failure(abort_code = EControlEpochMismatch)]
fun successor_control_epoch_is_cas_guarded() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 23, 0, 0, 0);
    let (config, protocol_cap, mut previous, previous_admin) =
        new_test_maker(&mut ctx);
    set_lifecycle_for_testing(&mut previous, ARCHIVED);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let authority = new_successor_authority(
        &mut previous,
        &previous_admin,
        0,
        &mut ctx,
    );
    let economics = previous.economics;
    let rights = previous.rights;
    let (successor, successor_admin) = new_successor_maker_draft_v8(
        &config,
        &mut previous,
        &previous_admin,
        authority,
        1,
        4,
        test_hash(31),
        test_hash(32),
        test_hash(33),
        b"successor-blob".to_string(),
        test_hash(34),
        test_hash(35),
        economics,
        rights,
        &clock,
        &mut ctx,
    );
    destroy_maker_for_testing(successor, successor_admin);
    destroy_maker_for_testing(previous, previous_admin);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
    clock.destroy_for_testing();
}

#[test]
fun control_transfer_preserves_immutable_pack_and_catalog_binding() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 24, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    finalize_base_registry_binding_v8(
        &mut root,
        &admin,
        object::id_from_address(@0xB0),
    );
    let catalog = new_test_catalog(&config, &root, &mut ctx);
    finalize_test_product(&mut root, &admin, &config, &catalog, &ctx);
    let readiness = test_pack_readiness(&root, &catalog, @0xC0, @0xC1);
    finalize_pack_admission_binding_v8(&mut root, &admin, &config, readiness, &ctx);
    let next_admin = rotate_maker_control_for_testing(
        &mut root,
        admin,
        0,
        @0xBEEF,
        &mut ctx,
    );
    assert!(root.owner == @0xBEEF, ENotCurrentOwner);
    assert!(root.control_epoch == 1, EControlEpochMismatch);
    assert!(admin_owner_v8(&next_admin) == @0xBEEF, EInvalidAdminCap);
    assert!(admin_control_epoch_v8(&next_admin) == 1, EInvalidAdminCap);
    assert_activation_scaffold_ready_v8(&root);
    assert!(root_native_capability_mask_v8(&root) == 127, ECatalogMismatch);
    package_binding::destroy_catalog_for_testing(catalog);
    destroy_test_maker(config, protocol_cap, root, next_admin);
}

#[test, expected_failure(abort_code = EControlEpochMismatch)]
fun control_transfer_rejects_stale_epoch_cas() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 25, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    let next_admin = rotate_maker_control_for_testing(
        &mut root,
        admin,
        1,
        @0xBEEF,
        &mut ctx,
    );
    destroy_test_maker(config, protocol_cap, root, next_admin);
}

#[test, expected_failure(abort_code = 1)]
fun companion_current_config_assertion_rejects_disabled_drift() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 26, 0, 0, 0);
    let (mut config, protocol_cap, root, admin) = new_test_maker(&mut ctx);
    protocol::set_protocol_enabled_v8(&mut config, &protocol_cap, false);
    assert_current_protocol_config_v8(&root, &config);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = 2)]
fun companion_current_config_assertion_rejects_enabled_revision_drift() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 27, 0, 0, 0);
    let (mut config, protocol_cap, root, admin) = new_test_maker(&mut ctx);
    protocol::set_protocol_enabled_v8(&mut config, &protocol_cap, false);
    protocol::set_protocol_enabled_v8(&mut config, &protocol_cap, true);
    assert_current_protocol_config_v8(&root, &config);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = EInvalidAdminCap)]
fun admin_owner_binding_cannot_be_forged() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 28, 0, 0, 0);
    let (config, protocol_cap, root, mut admin) = new_test_maker(&mut ctx);
    admin.owner = @0xBAD;
    assert_admin_v8(&root, &admin);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = EInvalidAdminCap)]
fun admin_control_epoch_binding_cannot_be_forged() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 29, 0, 0, 0);
    let (config, protocol_cap, root, mut admin) = new_test_maker(&mut ctx);
    admin.control_epoch = 7;
    assert_admin_v8(&root, &admin);
    destroy_test_maker(config, protocol_cap, root, admin);
}
