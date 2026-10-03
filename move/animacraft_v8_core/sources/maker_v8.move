/// Immutable Maker identity, economics/rights snapshots, DRAFT authority, and
/// one-time split-package bindings. Runtime behavior is intentionally absent.
module animacraft_v8_core::maker_v8;

use animacraft_v8_core::package_binding_v8::{
    Self as package_binding,
    FreshTupleReplacementBindingV2,
    ProductReleaseCatalogV8,
    RuntimeCallerCapV1,
};
use animacraft_v8_core::protocol_config_v8::{Self as protocol, ProtocolConfigV8};
use animacraft_v8_core::companion_binding_v2::{
    Self as companion,
    MakerRuntimeCompanionRegistryIdsV2,
    MakerRuntimeCompanionBindingBuilderV2,
};
use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::{Self as string, String};
use sui::clock::Clock;
use sui::event;
use sui::transfer::Receiving;

const VERSION: u64 = 8;
#[test_only]
const HASH_LENGTH: u64 = 32;
#[test_only]
const ACCESS_FREE: u8 = 0;
const COMPLETE_UNLIMITED_FREE: u8 = 0;
const MAX_ROYALTY_BPS: u16 = 1_000;
const ROYALTY_STEP_BPS: u16 = 50;
const MAX_COMBINED_SOURCE_ROYALTY_BPS: u16 = 1_000;
const MAX_PRICE_ATOMIC: u64 = 1_000_000_000_000;
const MAX_QUOTA: u64 = 1_000_000_000;
const MAX_KEY_BYTES: u64 = 128;
const MAX_BLOB_ID_BYTES: u64 = 512;
const MAX_EVIDENCE_LOCATOR_BYTES: u64 = 1_024;

const DRAFT: u8 = 0;
/// Reached only by activation_v8 after every terminal readiness check passes.
const ACTIVE: u8 = 1;
const PAUSED: u8 = 2;
const ARCHIVED: u8 = 3;

const ACCESS_PAID: u8 = 1;
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
const EBindingIdCollision: u64 = 14;
const EBaseRegistryMismatch: u64 = 15;
const EBaseRegistryAlreadyFinalized: u64 = 16;
const EBaseRegistryMissing: u64 = 17;
const EControlEpochMismatch: u64 = 18;
const EInvalidSuccessor: u64 = 19;
const ECatalogMismatch: u64 = 20;
const ESuccessorAuthorityAlreadyIssued: u64 = 21;
const EInvalidSuccessorAuthority: u64 = 22;
const EMakerTreasuryAlreadyFinalized: u64 = 23;
const EMakerTreasuryMissing: u64 = 24;
const EMakerTreasuryMismatch: u64 = 25;
const ECompanionBindingMissing: u64 = 26;
const ECompanionBindingAlreadyFinalized: u64 = 27;
const EBaseRegistryNotSealed: u64 = 28;
const EBaseRegistrySealAlreadyInstalled: u64 = 29;

public struct EconomicsSnapshotV8 has copy, drop, store {
    protocol_config_id: ID,
    protocol_config_revision: u64,
    protocol_config_commitment: vector<u8>,
    protocol_treasury_id: ID,
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


/// Non-authoritative Root readback. Every operation that uses these values
/// must revalidate the live Catalog and immutable replacement binding.
public struct ProductReleaseCommitmentsV2 has copy, drop, store {
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
}

/// One publication identity; registry IDs never enter frozen artwork content.
public struct MakerPublicationStateV2 has copy, drop, store {
    catalog_id: Option<ID>,
    release_commitments: Option<ProductReleaseCommitmentsV2>,
    registry_ids: Option<MakerRuntimeCompanionRegistryIdsV2>,
    sealed_base_registry_commitment: Option<vector<u8>>,
}

public struct MakerContentSnapshotV2 has copy, drop, store {
    renderer_commitment: vector<u8>,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
}

public struct MakerRootV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    core_original_package_id: ID,
    core_callable_package_id: ID,
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
    maker_document_commitment: vector<u8>,
    creator_defaults_commitment: vector<u8>,
    living_content_binding_commitment: vector<u8>,
    content: MakerContentSnapshotV2,
    base_registry_id: Option<ID>,
    maker_treasury_id: Option<ID>,
    expected_base_definition_count: u64,
    expected_base_registry_commitment: vector<u8>,
    expected_pack_admission_policy_commitment: vector<u8>,
    economics: EconomicsSnapshotV8,
    rights: RightsSnapshotV8,
    publication: MakerPublicationStateV2,
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

/// Module-controlled, one-use authority for exactly one N+1 fork. It has no
/// `store` ability or public transfer path, so an external PTB must feed the
/// returned value directly into the successor constructor. Every predecessor
/// CAS field is copied here and checked again at consumption.
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
    protocol_treasury_id: ID,
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
    maker_document_commitment: vector<u8>,
    creator_defaults_commitment: vector<u8>,
    living_content_binding_commitment: vector<u8>,
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
    let protocol_treasury_id = *protocol::config_treasury_id_v8(config).borrow();
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
        protocol_treasury_id,
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
        protocol_treasury_id,
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

/// Release certifies exact wrapped evidence through its private rights
/// witness. The live Catalog and immutable replacement are revalidated here;
/// no Root summary or detached package-origin marker can authorize this mint.
public fun certify_wrapped_rights_v8<ReleaseRightsWitness: drop>(
    witness: ReleaseRightsWitness,
    config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    evidence_locator: String,
    evidence_blob_id: String,
    evidence_sha256: vector<u8>,
    terms_commitment: vector<u8>,
    ctx: &TxContext,
): WrappedRightsCertificationV8 {
    package_binding::assert_catalog_current_v8(config, catalog);
    package_binding::assert_replacement_current_v2(replacement, catalog);
    let release = package_binding::binding_at_v2(
        package_binding::catalog_binding_v8(catalog), 6);
    package_binding::assert_exact_witness_type_v2<ReleaseRightsWitness>(
        release, &b"release_v8", &b"ReleaseRightsWitnessV2");
    assert_non_empty_bounded(&evidence_locator, MAX_EVIDENCE_LOCATOR_BYTES);
    assert_non_empty_bounded(&evidence_blob_id, MAX_BLOB_ID_BYTES);
    assert_hash(&evidence_sha256);
    assert_hash(&terms_commitment);
    let _ = witness;
    WrappedRightsCertificationV8 {
        creator: ctx.sender(),
        catalog_id: package_binding::catalog_id_v8(catalog),
        product_binding_commitment:
            *package_binding::product_binding_commitment_v8(
                package_binding::catalog_binding_v8(catalog)),
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
    maker_document_commitment: vector<u8>,
    creator_defaults_commitment: vector<u8>,
    living_content_binding_commitment: vector<u8>,
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
        maker_document_commitment,
        creator_defaults_commitment,
        living_content_binding_commitment,
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
    maker_document_commitment: vector<u8>,
    creator_defaults_commitment: vector<u8>,
    living_content_binding_commitment: vector<u8>,
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
        maker_document_commitment,
        creator_defaults_commitment,
        living_content_binding_commitment,
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

/// Issues exactly one transaction-local successor authority for an archived
/// Root. The non-store result must be consumed by the successor constructor in
/// the same PTB, so an interrupted UI can never strand a one-shot authority.
public fun issue_successor_authority_v8<PaymentCoin>(
    previous: &mut MakerRootV8<PaymentCoin>,
    previous_admin: &MakerAdminCapV8,
    expected_previous_control_epoch: u64,
    ctx: &mut TxContext,
): SuccessorAuthorityV8<PaymentCoin> {
    new_successor_authority(
        previous,
        previous_admin,
        expected_previous_control_epoch,
        ctx,
    )
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
    maker_document_commitment: vector<u8>,
    creator_defaults_commitment: vector<u8>,
    living_content_binding_commitment: vector<u8>,
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
    assert_hash(&maker_document_commitment);
    assert_hash(&creator_defaults_commitment);
    assert_hash(&living_content_binding_commitment);
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
            maker_document_commitment,
            creator_defaults_commitment,
            living_content_binding_commitment,
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
        maker_document_commitment,
        creator_defaults_commitment,
        living_content_binding_commitment,
        content: MakerContentSnapshotV2 {
            renderer_commitment,
            manifest_blob_id,
            manifest_sha256,
            content_commitment,
        },
        base_registry_id: option::none(),
        maker_treasury_id: option::none(),
        expected_base_definition_count,
        expected_base_registry_commitment,
        expected_pack_admission_policy_commitment,
        economics,
        rights,
        publication: MakerPublicationStateV2 {
            catalog_id: option::none(), release_commitments: option::none(),
            registry_ids: option::none(),
            sealed_base_registry_commitment: option::none(),
        },
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

/// Only the real Base seal installs its object-bound commitment, after checking
/// every exact author row against the immutable precomputed Version intent.
public(package) fun install_sealed_base_registry_commitment_v2<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>, admin: &MakerAdminCapV8,
    registry_id: ID, commitment: vector<u8>,
) {
    assert_draft_admin_v8(root, admin);
    assert!(root.base_registry_id.is_some(), EBaseRegistryMissing);
    assert!(*root.base_registry_id.borrow() == registry_id, EBaseRegistryMismatch);
    assert!(root.publication.sealed_base_registry_commitment.is_none(), EBaseRegistrySealAlreadyInstalled);
    assert_hash(&commitment);
    root.publication.sealed_base_registry_commitment.fill(commitment);
}

public fun root_sealed_base_registry_commitment_v2<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> {
    assert!(root.publication.sealed_base_registry_commitment.is_some(), EBaseRegistryNotSealed);
    root.publication.sealed_base_registry_commitment.borrow()
}

/// Resolves the same-transaction Root/MakerTreasury ID cycle. The Treasury
/// module creates the typed treasury and calls this once before sharing.
public(package) fun finalize_maker_treasury_binding_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    maker_treasury_id: ID,
) {
    assert_draft_admin_v8(root, admin);
    assert!(
        root.maker_treasury_id.is_none(),
        EMakerTreasuryAlreadyFinalized,
    );
    assert!(maker_treasury_id != object::id(root), EBindingIdCollision);
    assert!(maker_treasury_id != root.admin_cap_id, EBindingIdCollision);
    if (root.base_registry_id.is_some()) {
        assert!(
            maker_treasury_id != *root.base_registry_id.borrow(),
            EBindingIdCollision,
        );
    };
    root.maker_treasury_id = option::some(maker_treasury_id);
}

public fun assert_maker_treasury_identity_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    maker_treasury_id: ID,
) {
    assert!(root.maker_treasury_id.is_some(), EMakerTreasuryMissing);
    assert!(
        *root.maker_treasury_id.borrow() == maker_treasury_id,
        EMakerTreasuryMismatch,
    );
}

/// One-time DRAFT binding to the live catalog. The Root stores only identity
/// and commitments; every later authorization must borrow and revalidate the
/// catalog instead of trusting an offline tuple snapshot.
public fun finalize_product_release_binding_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    ctx: &TxContext,
) {
    assert_draft_admin_v8(root, admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    assert!(
        root.publication.catalog_id.is_none(),
        EProductBindingAlreadyFinalized,
    );
    assert!(root.publication.release_commitments.is_none(),
        EProductBindingAlreadyFinalized);
    assert_current_protocol_config_v8(root, config);
    package_binding::assert_catalog_current_v8(config, catalog);
    package_binding::assert_catalog_setup_complete_v2(catalog);
    let (catalog_config_id, catalog_config_revision, catalog_config_commitment,
        binding, call_cap_set_commitment, _) =
        package_binding::catalog_terms_v2(catalog);
    assert!(catalog_config_id == root.economics.protocol_config_id
        && catalog_config_revision == root.economics.protocol_config_revision
        && catalog_config_commitment == &root.economics.protocol_config_commitment,
        ECatalogMismatch);
    let core = package_binding::binding_at_v2(binding, 0);
    let (core_original, core_callable, _, _, _, _) =
        package_binding::exact_binding_terms_v2(core);
    assert!(core_original == root.core_original_package_id
        && core_callable == root.core_callable_package_id,
        ECorePackageMismatch);
    let binding_commitment = *package_binding::product_binding_commitment_v8(binding);
    let catalog_id = package_binding::catalog_id_v8(catalog);
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
    root.publication.catalog_id = option::some(catalog_id);
    root.publication.release_commitments = option::some(
        ProductReleaseCommitmentsV2 {
            product_binding_commitment: binding_commitment,
            call_cap_set_commitment: *call_cap_set_commitment,
        });
    event::emit(ProductReleaseBindingFinalizedV8 {
        root_id: object::id(root),
        catalog_id,
        binding_commitment,
    });
}

public(package) fun begin_companion_binding_v2<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    ctx: &TxContext,
): MakerRuntimeCompanionBindingBuilderV2<PaymentCoin> {
    assert_draft_admin_v8(root, admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    assert_product_release_catalog_v8(root, catalog);
    assert!(root.publication.registry_ids.is_none(), ECompanionBindingAlreadyFinalized);
    assert!(root.base_registry_id.is_some(), EBaseRegistryMissing);
    assert!(root.maker_treasury_id.is_some(), EMakerTreasuryMissing);
    companion::new_builder_v2(
        protocol_config, catalog, replacement, object::id(root), root.maker_version,
        root.control_epoch, root.content.content_commitment, root.admin_cap_id,
        *root.base_registry_id.borrow(), *root_sealed_base_registry_commitment_v2(root),
        *root.maker_treasury_id.borrow(), ctx,
    )
}

public(package) fun finish_companion_binding_v2<PaymentCoin>(
    builder: MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    ctx: &TxContext,
) {
    assert_draft_admin_v8(root, admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    assert_product_release_catalog_v8(root, catalog);
    assert!(root.publication.registry_ids.is_none(), ECompanionBindingAlreadyFinalized);
    assert!(root.base_registry_id.is_some(), EBaseRegistryMissing);
    assert!(root.maker_treasury_id.is_some(), EMakerTreasuryMissing);
    let (facts, ids) = companion::finish_v2(builder, protocol_config, catalog, replacement, ctx);
    companion::assert_facts_v2(
        &facts, object::id(root), root.maker_version, root.control_epoch,
        &root.content.content_commitment, root.admin_cap_id,
        *root.base_registry_id.borrow(), root_sealed_base_registry_commitment_v2(root),
        *root.maker_treasury_id.borrow(), ctx,
    );
    install_companion_ids(root, ids);
}

fun install_companion_ids<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>, ids: MakerRuntimeCompanionRegistryIdsV2,
) {
    assert!(root.publication.registry_ids.is_none(), ECompanionBindingAlreadyFinalized);
    root.publication.registry_ids.fill(ids);
}

public fun root_companion_registry_ids_v2<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &MakerRuntimeCompanionRegistryIdsV2 {
    assert!(root.publication.registry_ids.is_some(), ECompanionBindingMissing);
    root.publication.registry_ids.borrow()
}

/// A companion package must match its real Root to the in-flight builder
/// before its private witness can append registry IDs.
public fun assert_companion_builder_root_v2<PaymentCoin>(
    builder: &MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>, admin: &MakerAdminCapV8, ctx: &TxContext,
) {
    assert_draft_admin_v8(root, admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    assert!(root.publication.registry_ids.is_none(), ECompanionBindingAlreadyFinalized);
    assert!(root.base_registry_id.is_some(), EBaseRegistryMissing);
    assert!(root.maker_treasury_id.is_some(), EMakerTreasuryMissing);
    companion::assert_facts_v2(companion::builder_facts_v2(builder),
        object::id(root), root.maker_version, root.control_epoch,
        &root.content.content_commitment, root.admin_cap_id,
        *root.base_registry_id.borrow(), root_sealed_base_registry_commitment_v2(root),
        *root.maker_treasury_id.borrow(), ctx);
}


/// Sole Core-package DRAFT -> ACTIVE mutation. The package-only boundary
/// still revalidates the live Catalog and immutable replacement rather than
/// trusting the Root's compact readback.
public(package) fun activate_from_core_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
) {
    assert_draft_admin_v8(root, admin);
    assert_activation_scaffold_ready_v8(root);
    package_binding::assert_catalog_current_v8(protocol_config, catalog);
    package_binding::assert_replacement_current_v2(replacement, catalog);
    assert_product_release_catalog_v8(root, catalog);
    root.lifecycle = ACTIVE;
}

/// Package-only lifecycle mutation used after activation_v8 has consumed the
/// exact Release witness/certificate gate.
public(package) fun transition_lifecycle_from_core_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    next: u8,
    ctx: &TxContext,
): (u8, u8) {
    assert_admin_v8(root, admin);
    assert!(root.owner == ctx.sender(), ENotCurrentOwner);
    if (next == PAUSED || next == ARCHIVED) {
        package_binding::assert_catalog_for_stop_v8(protocol_config, catalog);
    } else {
        package_binding::assert_catalog_current_v8(protocol_config, catalog);
    };
    package_binding::assert_replacement_current_v2(replacement, catalog);
    assert_product_release_catalog_v8(root, catalog);
    let previous = root.lifecycle;
    assert!(
        (previous == ACTIVE && (next == PAUSED || next == ARCHIVED))
            || (previous == PAUSED && (next == ACTIVE || next == ARCHIVED)),
        EInvalidLifecycle,
    );
    root.lifecycle = next;
    (previous, next)
}

public fun assert_active_live_authority_v2<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
) {
    assert!(root.lifecycle == ACTIVE, EInvalidLifecycle);
    package_binding::assert_catalog_current_v8(protocol_config, catalog);
    package_binding::assert_replacement_current_v2(replacement, catalog);
    assert_product_release_catalog_v8(root, catalog);
}

public fun assert_release_type_origins_v8<
    PaymentCoin,
    ReleaseBootstrapWitness,
>(
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
) {
    assert_activation_scaffold_ready_v8(root);
    package_binding::assert_catalog_current_v8(protocol_config, catalog);
    package_binding::assert_replacement_current_v2(replacement, catalog);
    assert_product_release_catalog_v8(root, catalog);
    package_binding::assert_exact_witness_type_v2<ReleaseBootstrapWitness>(
        package_binding::binding_at_v2(
            package_binding::catalog_binding_v8(catalog), 6),
        &b"release_v8",
        &b"ReleaseBootstrapFinalizeWitnessV2",
    );
}

/// Read-only scaffold check. It does not authorize activation; Fresh tuple
/// certificate gates must additionally borrow the live catalog.
public fun assert_activation_scaffold_ready_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
) {
    assert_draft_v8(root);
    assert!(root.publication.catalog_id.is_some(), EProductBindingMissing);
    assert!(root.publication.release_commitments.is_some(), EProductBindingMissing);
    assert!(
        root.publication.registry_ids.is_some(),
        ECompanionBindingMissing,
    );
    assert!(root.base_registry_id.is_some(), EBaseRegistryMissing);
    assert!(root.maker_treasury_id.is_some(), EMakerTreasuryMissing);
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
        root.economics.protocol_config_id,
        root.economics.protocol_config_revision,
        &root.economics.protocol_config_commitment,
    );
    assert!(
        protocol::config_treasury_id_v8(config).is_some(),
        EProtocolSnapshotMismatch,
    );
    assert!(
        *protocol::config_treasury_id_v8(config).borrow()
            == root.economics.protocol_treasury_id,
        EProtocolSnapshotMismatch,
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

/// Market may custody the real key-only admin only through its private,
/// bootstrap-installed V1 caller cap and the exact live replacement tuple.
public fun custody_maker_admin_for_market_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_caller_cap: &RuntimeCallerCapV1,
    listing_parent: &mut UID,
) {
    assert_market_executor_v2(
        root, protocol_config, catalog, replacement, market_caller_cap);
    assert!(root.lifecycle == PAUSED, EInvalidLifecycle);
    assert_admin_v8(root, &admin);
    transfer::transfer(admin, object::uid_to_address(listing_parent));
}

/// Cancellation preserves the cap; settlement rotates the canonical owner
/// and control epoch. A summary-only Root or caller-supplied package ID never
/// substitutes for the live Catalog/replacement/private Market cap.
public fun resolve_maker_admin_from_market_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_caller_cap: &RuntimeCallerCapV1,
    listing_parent: &mut UID,
    receiving: Receiving<MakerAdminCapV8>,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert_market_return_executor_v2(root, catalog, replacement, market_caller_cap);
    let admin = transfer::receive(listing_parent, receiving);
    assert_admin_v8(root, &admin);
    if (recipient == root.owner) {
        transfer::transfer(admin, recipient)
    } else {
        // A purchase changes ownership, unlike escrow return; keep its live
        // protocol gate even when invoked through the shared resolver.
        package_binding::assert_catalog_current_v8(protocol_config, catalog);
        assert!(root.lifecycle == PAUSED, EInvalidLifecycle);
        assert!(recipient == ctx.sender(), ENotCurrentOwner);
        let epoch = root.control_epoch;
        let next = rotate_maker_control_v8(root, admin, epoch, recipient, ctx);
        transfer::transfer(next, recipient);
    }
}

fun assert_market_executor_v2<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_caller_cap: &RuntimeCallerCapV1,
) {
    package_binding::assert_catalog_current_v8(protocol_config, catalog);
    assert_market_return_executor_v2(root, catalog, replacement, market_caller_cap);
}

fun assert_market_return_executor_v2<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_caller_cap: &RuntimeCallerCapV1,
) {
    package_binding::assert_replacement_current_v2(replacement, catalog);
    assert_product_release_catalog_v8(root, catalog);
    package_binding::assert_runtime_caller_cap_v1(
        market_caller_cap,
        1,
        replacement,
        catalog,
    );
}

fun rotate_maker_control_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: MakerAdminCapV8,
    expected_control_epoch: u64,
    new_owner: address,
    ctx: &mut TxContext,
): MakerAdminCapV8 {
    assert_admin_v8(root, &admin);
    assert!(root.owner == ctx.sender() || new_owner == ctx.sender(), ENotCurrentOwner);
    assert!(root.control_epoch == expected_control_epoch, EControlEpochMismatch);
    assert!(root.successor_authority_id.is_none(), ESuccessorAuthorityAlreadyIssued);
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
        root_content_commitment == &root.content.content_commitment,
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
        root_content_commitment == &root.content.content_commitment,
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


public fun assert_economics_snapshot_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    economics: &EconomicsSnapshotV8,
) {
    let expected = new_economics_snapshot_v8<PaymentCoin>(
        config,
        economics.maker_access,
        economics.maker_price_atomic,
        economics.complete_mode,
        economics.complete_price_atomic,
        economics.complete_per_wallet_quota,
        economics.complete_total_cap,
    );
    assert!(&expected == economics, EProtocolSnapshotMismatch);
}

public fun assert_rights_snapshot_v8(rights: &RightsSnapshotV8) {
    let expected = new_rights_snapshot_internal_v8(
        rights.origin,
        rights.creator,
        rights.certification_catalog_id,
        rights.certification_binding_commitment,
        rights.evidence_locator,
        rights.evidence_blob_id,
        rights.evidence_sha256,
        rights.terms_commitment,
        rights.soul_creator_royalty_bps,
        rights.maker_source_royalty_bps,
        rights.maker_resale_royalty_bps,
    );
    assert!(&expected == rights, EInvalidRights);
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
        assert!(certification_catalog_id.is_none()
            && certification_binding_commitment.is_none()
            && string::as_bytes(evidence_locator).is_empty()
            && string::as_bytes(evidence_blob_id).is_empty()
            && evidence_sha256.is_empty()
            && terms_commitment.is_empty(), EInvalidRights);
    } else {
        assert!(origin == RIGHTS_LICENSE_WRAPPED
            && certification_catalog_id.is_some()
            && certification_binding_commitment.is_some(), EInvalidRights);
        assert_hash(certification_binding_commitment.borrow());
        assert_non_empty_bounded(evidence_locator, MAX_EVIDENCE_LOCATOR_BYTES);
        assert_non_empty_bounded(evidence_blob_id, MAX_BLOB_ID_BYTES);
        assert_hash(evidence_sha256);
        assert_hash(terms_commitment);
    };
}

fun assert_valid_access(access: u8, price: u64) {
    assert!(access <= ACCESS_PAID && price <= MAX_PRICE_ATOMIC
        && (price > 0) == (access == ACCESS_PAID), EInvalidEconomics);
}

fun assert_valid_complete_policy(mode: u8, price: u64, quota: u64, total_cap: u64) {
    assert!(mode <= COMPLETE_FREE_QUOTA_THEN_BLOCK
        && price <= MAX_PRICE_ATOMIC
        && quota <= MAX_QUOTA
        && total_cap <= MAX_QUOTA
        && (total_cap == 0 || quota <= total_cap)
        && (price > 0) == (mode == COMPLETE_FREE_QUOTA_THEN_PAID
            || mode == COMPLETE_PAID_EVERY_TIME)
        && (quota > 0) == (mode == COMPLETE_FREE_QUOTA_THEN_PAID
            || mode == COMPLETE_FREE_QUOTA_THEN_BLOCK), EInvalidEconomics);
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
    assert!(protocol::is_nonzero_hash_v2(value), EInvalidCommitment);
}

fun assert_non_empty_bounded(value: &String, max: u64) {
    let length = string::as_bytes(value).length();
    assert!(length > 0 && length <= max, EInvalidString);
}

public fun root_id_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): ID {
    object::id(root)
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
public fun root_maker_version_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u64 {
    root.maker_version
}
public fun root_lifecycle_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u8 {
    root.lifecycle
}
/// Exact installed Base registry identity; an unbound draft has no fallback.
public fun root_base_registry_id_v2<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): ID {
    assert!(root.base_registry_id.is_some(), EBaseRegistryMissing);
    *root.base_registry_id.borrow()
}

public fun root_maker_key_v2<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): &String {
    &root.maker_key
}

public fun root_version_commitment_v2<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> { &root.version_commitment }

public fun root_maker_treasury_id_v2<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): ID {
    assert!(root.maker_treasury_id.is_some(), EMakerTreasuryMissing);
    *root.maker_treasury_id.borrow()
}

public fun economics_protocol_treasury_id_v2(economics: &EconomicsSnapshotV8): ID {
    economics.protocol_treasury_id
}

public fun root_content_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> { &root.content.content_commitment }
public fun root_creator_defaults_commitment_v1<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> { &root.creator_defaults_commitment }
public fun root_living_content_binding_commitment_v1<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> { &root.living_content_binding_commitment }
public fun root_expected_base_definition_count_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): u64 { root.expected_base_definition_count }
public fun root_expected_base_registry_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> { &root.expected_base_registry_commitment }
public fun root_economics_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): EconomicsSnapshotV8 { root.economics }
public fun root_product_release_catalog_id_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): ID {
    assert!(root.publication.catalog_id.is_some(), EProductBindingMissing);
    *root.publication.catalog_id.borrow()
}
public fun root_product_release_binding_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> {
    assert!(root.publication.release_commitments.is_some(), EProductBindingMissing);
    &root.publication.release_commitments.borrow().product_binding_commitment
}
public fun root_product_release_call_cap_set_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> {
    assert!(root.publication.release_commitments.is_some(), EProductBindingMissing);
    &root.publication.release_commitments.borrow().call_cap_set_commitment
}
public fun assert_product_release_catalog_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
) {
    assert!(root_product_release_catalog_id_v8(root)
        == package_binding::catalog_id_v8(catalog), ECatalogMismatch);
    assert!(root_product_release_binding_commitment_v8(root)
        == package_binding::product_binding_commitment_v8(
            package_binding::catalog_binding_v8(catalog)), ECatalogMismatch);
    let (_, _, _, _, call_cap_set_commitment, _) =
        package_binding::catalog_terms_v2(catalog);
    assert!(root_product_release_call_cap_set_commitment_v8(root)
        == call_cap_set_commitment, ECatalogMismatch);
}
public fun root_renderer_commitment_v2<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> { &root.content.renderer_commitment }
public fun root_expected_pack_admission_policy_commitment_v2<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> { &root.expected_pack_admission_policy_commitment }
public fun root_rights_v2<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): RightsSnapshotV8 { root.rights }
public fun root_creator_v2<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): address {
    root.creator
}
public fun root_control_epoch_v2<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u64 {
    root.control_epoch
}
public fun economics_protocol_config_id_v2(economics: &EconomicsSnapshotV8): ID {
    economics.protocol_config_id
}
public fun economics_protocol_config_revision_v2(economics: &EconomicsSnapshotV8): u64 {
    economics.protocol_config_revision
}
public fun economics_protocol_config_commitment_v2(
    economics: &EconomicsSnapshotV8,
): &vector<u8> { &economics.protocol_config_commitment }
public fun economics_maker_market_fee_bps_v2(economics: &EconomicsSnapshotV8): u16 {
    economics.maker_market_fee_bps
}
public fun economics_soul_market_fee_bps_v2(economics: &EconomicsSnapshotV8): u16 {
    economics.soul_market_fee_bps
}
public fun rights_commitment_v2(rights: &RightsSnapshotV8): &vector<u8> {
    &rights.commitment
}

/// Cross-package VM assertion for the actual private rights snapshot. Does not
/// construct or mutate certification and is absent from production bytecode.
#[test_only]
public fun assert_wrapped_rights_for_testing(
    rights: &RightsSnapshotV8, creator: address, catalog_id: ID,
) {
    assert!(rights.origin == RIGHTS_LICENSE_WRAPPED, 99);
    assert!(rights.creator == creator && rights.creator_confirmed, 99);
    assert!(rights.evidence_certified, 99);
    assert!(rights.certification_catalog_id == option::some(catalog_id), 99);
}
public fun rights_maker_resale_royalty_bps_v2(rights: &RightsSnapshotV8): u16 {
    rights.maker_resale_royalty_bps
}
public fun economics_commitment_v2(economics: &EconomicsSnapshotV8): &vector<u8> {
    &economics.commitment
}
public fun economics_complete_mode_v2(economics: &EconomicsSnapshotV8): u8 {
    economics.complete_mode
}
public fun economics_complete_price_atomic_v2(economics: &EconomicsSnapshotV8): u64 {
    economics.complete_price_atomic
}
/// The configured quota is free completions before either paid or blocked mode.
public fun economics_complete_per_wallet_quota_v2(economics: &EconomicsSnapshotV8): u64 {
    economics.complete_per_wallet_quota
}
public fun economics_complete_total_cap_v2(economics: &EconomicsSnapshotV8): u64 {
    economics.complete_total_cap
}
public fun economics_fixed_complete_fee_atomic_v2(economics: &EconomicsSnapshotV8): u64 {
    economics.fixed_complete_fee_atomic
}
public fun rights_soul_creator_royalty_bps_v2(rights: &RightsSnapshotV8): u16 {
    rights.soul_creator_royalty_bps
}
public fun rights_maker_source_royalty_bps_v2(rights: &RightsSnapshotV8): u16 {
    rights.maker_source_royalty_bps
}
public fun lifecycle_draft_v8(): u8 { DRAFT }
public fun lifecycle_active_v8(): u8 { ACTIVE }
public fun lifecycle_paused_v8(): u8 { PAUSED }
public fun lifecycle_archived_v8(): u8 { ARCHIVED }
public fun complete_unlimited_free_v8(): u8 { COMPLETE_UNLIMITED_FREE }
public fun complete_free_quota_then_paid_v8(): u8 { COMPLETE_FREE_QUOTA_THEN_PAID }
public fun complete_paid_every_time_v8(): u8 { COMPLETE_PAID_EVERY_TIME }
public fun complete_free_quota_then_block_v8(): u8 { COMPLETE_FREE_QUOTA_THEN_BLOCK }

public fun economics_maker_access_v8(economics: &EconomicsSnapshotV8): u8 {
    economics.maker_access
}
public fun economics_maker_price_atomic_v8(economics: &EconomicsSnapshotV8): u64 {
    economics.maker_price_atomic
}
public fun economics_primary_content_fee_bps_v8(
    economics: &EconomicsSnapshotV8,
): u16 { economics.primary_content_fee_bps }
#[test_only]
public fun set_lifecycle_for_testing<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    lifecycle: u8,
) {
    root.lifecycle = lifecycle;
}

#[test_only]
public fun begin_companion_binding_for_testing<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>, admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
    replacement: &package_binding::FreshTupleReplacementBindingV2, ctx: &TxContext,
): MakerRuntimeCompanionBindingBuilderV2<PaymentCoin> {
    begin_companion_binding_v2(root, admin, config, catalog, replacement, ctx)
}

#[test_only]
public fun finish_companion_binding_for_testing<PaymentCoin>(
    builder: MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    root: &mut MakerRootV8<PaymentCoin>, admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
    replacement: &package_binding::FreshTupleReplacementBindingV2, ctx: &TxContext,
) {
    finish_companion_binding_v2(builder, root, admin, config, catalog, replacement, ctx)
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
        maker_document_commitment: _,
        creator_defaults_commitment: _,
        living_content_binding_commitment: _,
        content: _,
        base_registry_id: _,
        maker_treasury_id: _,
        expected_base_definition_count: _,
        expected_base_registry_commitment: _,
        expected_pack_admission_policy_commitment: _,
        economics: _,
        rights: _,
        publication: _,
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
    let (mut root, admin) = new_initial_maker_draft_v8<sui::sui::SUI>(
        &config,
        4,
        test_hash(1),
        test_hash(2),
        b"maker".to_string(),
        test_hash(30),
        test_hash(31),
        test_hash(32),
        test_hash(3),
        b"walrus-blob".to_string(),
        test_hash(4),
        test_hash(5),
        economics,
        rights,
        &clock,
        ctx,
    );
    finalize_maker_treasury_binding_v8(
        &mut root,
        &admin,
        object::id_from_address(@0xB1),
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
    let mut catalog = package_binding::product_release_catalog_for_testing(
        config,
        root.core_original_package_id.to_address(),
        root.core_callable_package_id.to_address(),
        @0x11,
        @0x21,
        ctx,
    );
    package_binding::complete_catalog_setup_for_testing(&mut catalog, ctx);
    catalog
}

#[test_only]
fun finalize_test_product(
    root: &mut MakerRootV8<sui::sui::SUI>,
    admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    ctx: &TxContext,
) {
    finalize_product_release_binding_v8(root, admin, config, catalog, ctx);
}

#[test_only]
fun finalize_test_pack(
    root: &mut MakerRootV8<sui::sui::SUI>,
    admin: &MakerAdminCapV8,
    registry: address,
    authority: address,
){
    assert_draft_admin_v8(root, admin);
    install_companion_ids(root, companion::new_registry_ids_for_testing(vector[
        object::id_from_address(@0xD0), object::id_from_address(registry),
        object::id_from_address(authority), object::id_from_address(@0xD1),
        object::id_from_address(@0xD2), object::id_from_address(@0xD3),
        object::id_from_address(@0xD4), object::id_from_address(@0xD5),
    ]))
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
    assert!(root.publication.catalog_id.is_none(), EProductBindingAlreadyFinalized);
    assert!(root.publication.release_commitments.is_none(), EProductBindingAlreadyFinalized);
    assert!(root.publication.registry_ids.is_none(), ECompanionBindingAlreadyFinalized);
    assert!(root.expected_base_definition_count == 4, EBaseRegistryMismatch);
    assert!(root_maker_key_v2(&root) == &b"maker".to_string(), EInvalidString);
    assert!(root_version_commitment_v2(&root) == &root.version_commitment
        && root_version_commitment_v2(&root) != &root.maker_document_commitment,
        EInvalidCommitment);
    assert!(root_maker_treasury_id_v2(&root) == object::id_from_address(@0xB1),
        EMakerTreasuryMissing);
    assert!(&root.content.renderer_commitment == &test_hash(3), EInvalidCommitment);
    assert!(root_renderer_commitment_v2(&root) == &root.content.renderer_commitment,
        EInvalidCommitment);
    assert!(root_expected_pack_admission_policy_commitment_v2(&root)
        == &root.expected_pack_admission_policy_commitment, EInvalidCommitment);
    let rights = root_rights_v2(&root);
    assert!(rights == root.rights, EInvalidRights);
    assert!(rights_soul_creator_royalty_bps_v2(&rights) == rights.soul_creator_royalty_bps
        && rights_maker_source_royalty_bps_v2(&rights) == rights.maker_source_royalty_bps,
        EInvalidRights);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test_only]
fun test_companion_ids(): MakerRuntimeCompanionRegistryIdsV2 {
    companion::new_registry_ids_for_testing(vector[
        object::id_from_address(@0xC0), object::id_from_address(@0xC1),
        object::id_from_address(@0xC2), object::id_from_address(@0xC3),
        object::id_from_address(@0xC4), object::id_from_address(@0xC5),
        object::id_from_address(@0xC6), object::id_from_address(@0xC7),
    ])
}

#[test]
fun base_registry_reader_returns_exact_bound_identity() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 83, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    let registry_id = object::id_from_address(@0xB2);
    finalize_base_registry_binding_v8(&mut root, &admin, registry_id);
    assert!(root_base_registry_id_v2(&root) == registry_id, EBaseRegistryMismatch);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = EBaseRegistryMissing)]
fun base_registry_reader_rejects_unbound_root() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 83, 0, 0, 0);
    let (config, protocol_cap, root, admin) = new_test_maker(&mut ctx);
    root_base_registry_id_v2(&root);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test]
fun companion_binding_keeps_artwork_content_unchanged() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 83, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    let content = root.content;
    install_companion_ids(&mut root, test_companion_ids());
    assert!(root.content == content, EInvalidCommitment);
    let ids = root_companion_registry_ids_v2(&root);
    assert!(companion::output_registry_id_v2(ids) == object::id_from_address(@0xC4)
        && companion::soul_registry_id_v2(ids) == object::id_from_address(@0xC5),
        EBindingIdCollision);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = ECompanionBindingAlreadyFinalized)]
fun companion_binding_cannot_be_replaced() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 84, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    install_companion_ids(&mut root, test_companion_ids());
    install_companion_ids(&mut root, test_companion_ids());
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = ECompanionBindingMissing)]
fun companion_binding_read_rejects_unbound_root() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 85, 0, 0, 0);
    let (config, protocol_cap, root, admin) = new_test_maker(&mut ctx);
    root_companion_registry_ids_v2(&root);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test]
fun completion_snapshot_readers_preserve_each_configured_mode() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 82, 0, 0, 0);
    let (config, cap) = protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let modes = vector[complete_unlimited_free_v8(), complete_free_quota_then_paid_v8(),
        complete_paid_every_time_v8(), complete_free_quota_then_block_v8()];
    let mut i = 0u64;
    while (i < modes.length()) {
        let mode = modes[i];
        let price = if (mode == 1 || mode == 2) 25 else 0;
        let quota = if (mode == 1 || mode == 3) 2 else 0;
        let snapshot = new_economics_snapshot_v8<sui::sui::SUI>(
            &config, ACCESS_PAID, 7, mode, price, quota, 9);
        assert!(economics_maker_price_atomic_v8(&snapshot) == 7, EInvalidEconomics);
        assert!(economics_complete_mode_v2(&snapshot) == mode, EInvalidEconomics);
        assert!(economics_complete_price_atomic_v2(&snapshot) == price, EInvalidEconomics);
        assert!(economics_complete_per_wallet_quota_v2(&snapshot) == quota, EInvalidEconomics);
        assert!(economics_complete_total_cap_v2(&snapshot) == 9, EInvalidEconomics);
        assert!(economics_fixed_complete_fee_atomic_v2(&snapshot)
            == snapshot.fixed_complete_fee_atomic, EInvalidEconomics);
        assert!(economics_commitment_v2(&snapshot) == &snapshot.commitment, EInvalidCommitment);
        assert!(economics_protocol_config_id_v2(&snapshot) == protocol::config_id_v8(&config),
            EInvalidEconomics);
        assert!(economics_protocol_treasury_id_v2(&snapshot)
            == *protocol::config_treasury_id_v8(&config).borrow(), EInvalidEconomics);
        assert!(economics_protocol_config_revision_v2(&snapshot)
            == protocol::config_revision_v8(&config), EInvalidEconomics);
        assert!(economics_protocol_config_commitment_v2(&snapshot)
            == protocol::config_commitment_v8(&config), EInvalidEconomics);
        assert!(economics_maker_market_fee_bps_v2(&snapshot)
            == protocol::config_maker_market_fee_bps_v8(&config), EInvalidEconomics);
        assert!(economics_soul_market_fee_bps_v2(&snapshot)
            == protocol::config_soul_market_fee_bps_v8(&config), EInvalidEconomics);
        i = i + 1;
    };
    assert!(lifecycle_draft_v8() == DRAFT && lifecycle_active_v8() == ACTIVE
        && lifecycle_paused_v8() == PAUSED && lifecycle_archived_v8() == ARCHIVED,
        EInvalidLifecycle);
    protocol::destroy_protocol_for_testing(config, cap);
}

#[test, expected_failure(abort_code = EProductBindingMissing)]
fun activation_scaffold_rejects_absent_product_binding() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 11, 0, 0, 0);
    let (config, protocol_cap, root, admin) = new_test_maker(&mut ctx);
    assert_activation_scaffold_ready_v8(&root);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = ECompanionBindingMissing)]
fun activation_scaffold_rejects_absent_companion_binding() {
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
    let mut catalog = package_binding::product_release_catalog_for_testing(
        &config,
        @0x77,
        @0x78,
        @0x11,
        @0x21,
        &mut ctx,
    );
    package_binding::complete_catalog_setup_for_testing(&mut catalog, &mut ctx);
    finalize_test_product(&mut root, &admin, &config, &catalog, &ctx);
    package_binding::destroy_catalog_for_testing(catalog);
    destroy_test_maker(config, protocol_cap, root, admin);
}

#[test, expected_failure(abort_code = ECompanionBindingAlreadyFinalized)]
fun pack_companion_ids_cannot_be_replaced() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 15, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    let catalog = new_test_catalog(&config, &root, &mut ctx);
    finalize_test_product(&mut root, &admin, &config, &catalog, &ctx);
    finalize_test_pack(&mut root, &admin, @0xC0, @0xC1);
    finalize_test_pack(&mut root, &admin, @0xC2, @0xC3);
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
    finalize_test_pack(&mut root, &admin, @0xC0, @0xC1);
    assert_activation_scaffold_ready_v8(&root);
    let binding = root_companion_registry_ids_v2(&root);
    assert!(companion::pack_registry_id_v2(binding) == object::id_from_address(@0xC0), EBaseRegistryMismatch);
    assert!(
        companion::admission_authority_id_v2(binding) == object::id_from_address(@0xC1),
        EBaseRegistryMismatch,
    );
    package_binding::assert_catalog_current_v8(&config, &catalog);
    package_binding::destroy_catalog_for_testing(catalog);
    assert!(
        root_expected_pack_admission_policy_commitment_v2(&root)
            == &root.expected_pack_admission_policy_commitment,
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
    assert!(unbounded.complete_total_cap == 0, EInvalidEconomics);
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
        exact.complete_per_wallet_quota == exact.complete_total_cap,
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
    assert!(rights.evidence_certified, EInvalidRights);
    assert!(&rights.evidence_sha256 == &test_hash(20), EInvalidRights);
    assert!(&rights.terms_commitment == &test_hash(21), EInvalidRights);
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
    assert!(rights_maker_resale_royalty_bps_v2(&rights) == 500, EInvalidRights);
    assert!(rights_commitment_v2(&rights) == &rights.commitment, EInvalidCommitment);
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

#[test, expected_failure(abort_code = ECatalogMismatch)]
fun root_rejects_wrong_live_catalog() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 20, 0, 0, 0);
    let (config, protocol_cap, mut root, admin) = new_test_maker(&mut ctx);
    let catalog = new_test_catalog(&config, &root, &mut ctx);
    finalize_test_product(&mut root, &admin, &config, &catalog, &ctx);
    let other = new_test_catalog(&config, &root, &mut ctx);
    assert_product_release_catalog_v8(&root, &other);
    package_binding::destroy_catalog_for_testing(other);
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
    assert!(authority.previous_root_id == object::id(&previous), EInvalidSuccessorAuthority);
    assert!(authority.maker_key == previous.maker_key, EInvalidSuccessorAuthority);
    assert!(authority.maker_version == previous.maker_version, EInvalidSuccessorAuthority);
    assert!(authority.version_commitment == previous.version_commitment, EInvalidSuccessorAuthority);
    assert!(authority.control_epoch == previous.control_epoch, EInvalidSuccessorAuthority);
    assert!(authority.owner == previous.owner, EInvalidSuccessorAuthority);
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
        test_hash(36),
        test_hash(37),
        test_hash(38),
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
        test_hash(36),
        test_hash(37),
        test_hash(38),
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
        let authority = issue_successor_authority_v8(
            &mut previous,
            &previous_admin,
            0,
            scenario.ctx(),
        );
        transfer::transfer(authority, sender);
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
            test_hash(36),
            test_hash(37),
            test_hash(38),
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
        let authority = issue_successor_authority_v8(
            &mut previous,
            &previous_admin,
            0,
            scenario.ctx(),
        );
        destroy_successor_authority_for_testing(authority);
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
        test_hash(36),
        test_hash(37),
        test_hash(38),
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
fun archived_predecessor_without_successor_authority_can_transfer_control() {
    let sender = @0xA11;
    let new_owner = @0xBEEF;
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
        transfer_maker_control_v8(
            &mut previous,
            previous_admin,
            0,
            new_owner,
            scenario.ctx(),
        );
        assert!(previous.owner == new_owner, ENotCurrentOwner);
        assert!(previous.control_epoch == 1, EControlEpochMismatch);
        sui::test_scenario::return_shared(previous);
    };
    scenario.next_tx(new_owner);
    {
        let previous = scenario.take_shared<MakerRootV8<sui::sui::SUI>>();
        let next_admin = scenario.take_from_sender<MakerAdminCapV8>();
        assert!(next_admin.owner == new_owner, EInvalidAdminCap);
        assert!(next_admin.control_epoch == 1, EInvalidAdminCap);
        sui::test_scenario::return_shared(previous);
        scenario.return_to_sender(next_admin);
    };
    scenario.end();
}

#[test, expected_failure(abort_code = ESuccessorAuthorityAlreadyIssued)]
fun archived_predecessor_with_outstanding_successor_authority_cannot_transfer_control() {
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
        let authority = issue_successor_authority_v8(
            &mut previous,
            &previous_admin,
            0,
            scenario.ctx(),
        );
        transfer::transfer(authority, sender);
        sui::test_scenario::return_shared(previous);
        scenario.return_to_sender(previous_admin);
    };
    scenario.next_tx(sender);
    {
        let mut previous = scenario.take_shared<MakerRootV8<sui::sui::SUI>>();
        let previous_admin = scenario.take_from_sender<MakerAdminCapV8>();
        transfer_maker_control_v8(
            &mut previous,
            previous_admin,
            0,
            @0xBEEF,
            scenario.ctx(),
        );
        sui::test_scenario::return_shared(previous);
    };
    scenario.end();
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
    finalize_test_pack(&mut root, &admin, @0xC0, @0xC1);
    let next_admin = rotate_maker_control_for_testing(
        &mut root,
        admin,
        0,
        @0xBEEF,
        &mut ctx,
    );
    assert!(root.owner == @0xBEEF, ENotCurrentOwner);
    assert!(root_creator_v2(&root) == @0xA11, EInvalidRights);
    assert!(root_control_epoch_v2(&root) == 1, EControlEpochMismatch);
    assert!(root.control_epoch == 1, EControlEpochMismatch);
    assert!(next_admin.owner == @0xBEEF, EInvalidAdminCap);
    assert!(next_admin.control_epoch == 1, EInvalidAdminCap);
    assert_activation_scaffold_ready_v8(&root);
    package_binding::assert_catalog_current_v8(&config, &catalog);
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
