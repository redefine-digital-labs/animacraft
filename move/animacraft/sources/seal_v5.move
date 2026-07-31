module animacraft::seal_v5;

use animacraft::animacraft::{Self as legacy};
use animacraft::commerce_v5::{Self as commerce, MakerRootV5};
use std::bcs;
use std::hash;
use std::option::Option;
use std::string::String;
use sui::balance;
use sui::coin;
use sui::event;
use sui::table::{Self as table, Table};

const VERSION: u64 = 1;
const SHA2_256_BYTES: u64 = 32;
const PRODUCT_BASE: u8 = 0;
const PRODUCT_PACK: u8 = 1;

const ENoAccess: u64 = 0;
const ENotRootOwner: u64 = 1;
const ERootMismatch: u64 = 2;
const EPolicySealed: u64 = 3;
const EPolicyNotSealed: u64 = 4;
const ECommerceRegistryNotSealed: u64 = 5;
const EInvalidCommitment: u64 = 6;
const EInvalidAssetDigest: u64 = 7;
const EStyleIsNotPaidPack: u64 = 8;
const EPackMismatch: u64 = 9;
const EPackInactive: u64 = 10;
const EDuplicateSealIdentity: u64 = 11;
const ENoRegisteredAssets: u64 = 12;
const EWrongVersion: u64 = 13;
const EInvalidProductKind: u64 = 14;
const EBaseIsNotPaid: u64 = 15;
const EDuplicateStyleProduct: u64 = 16;
const EStyleIsNotSealProtected: u64 = 17;
const EInvalidCompleteOutput: u64 = 18;

/// Canonical key identity. This exact BCS layout is mirrored by the web SDK.
/// A new immutable release commitment, Style, Pack or PNG digest always derives
/// a different Seal key.
public struct SealIdentityV5 has copy, drop, store {
    release_commitment: vector<u8>,
    product_kind: u8,
    part_key: String,
    item_key: String,
    style_key: String,
    pack_key: String,
    asset_digest: vector<u8>,
}

public struct PaidStyleAssetV5 has copy, drop, store {
    seal_id: vector<u8>,
    product_kind: u8,
    part_key: String,
    item_key: String,
    style_key: String,
    pack_key: String,
    ciphertext_blob_id: String,
    asset_digest: vector<u8>,
}

/// A digest-independent identity for one protected Commerce Style. A Style may
/// only be registered once in a release even if a caller supplies another PNG
/// digest and therefore derives another Seal ID.
public struct StyleProductIdentityV5 has copy, drop, store {
    product_kind: u8,
    part_key: String,
    item_key: String,
    style_key: String,
    pack_key: String,
}

/// One immutable Seal policy per Commerce v5 release. The policy is shared,
/// while access is always resolved against the latest MakerRootV5 state.
public struct MakerSealPolicyV5 has key {
    id: UID,
    version: u64,
    root_id: ID,
    release_commitment: vector<u8>,
    registered_assets: Table<vector<u8>, PaidStyleAssetV5>,
    registered_style_products: Table<vector<u8>, bool>,
    asset_count: u64,
    sealed: bool,
}

public struct MakerSealPolicyCreatedV5 has copy, drop {
    policy_id: ID,
    root_id: ID,
    release_commitment: vector<u8>,
}

public struct PaidStyleAssetRegisteredV5 has copy, drop {
    policy_id: ID,
    root_id: ID,
    seal_id: vector<u8>,
    product_kind: u8,
    part_key: String,
    item_key: String,
    style_key: String,
    pack_key: String,
    ciphertext_blob_id: String,
    asset_digest: vector<u8>,
}

public struct MakerSealPolicySealedV5 has copy, drop {
    policy_id: ID,
    root_id: ID,
    asset_count: u64,
}

public fun derive_seal_id_v5(
    release_commitment: vector<u8>,
    product_kind: u8,
    part_key: String,
    item_key: String,
    style_key: String,
    pack_key: String,
    asset_digest: vector<u8>,
): vector<u8> {
    assert!(release_commitment.length() == SHA2_256_BYTES, EInvalidCommitment);
    assert!(asset_digest.length() == SHA2_256_BYTES, EInvalidAssetDigest);
    assert!(
        product_kind == PRODUCT_BASE || product_kind == PRODUCT_PACK,
        EInvalidProductKind,
    );
    hash::sha2_256(bcs::to_bytes(&SealIdentityV5 {
        release_commitment,
        product_kind,
        part_key,
        item_key,
        style_key,
        pack_key,
        asset_digest,
    }))
}

public fun derive_complete_output_seal_id_v5(
    root_id: ID,
    payer: address,
    recipe_hash: vector<u8>,
    output_nonce: vector<u8>,
    output_digest: vector<u8>,
): vector<u8> {
    assert!(
        recipe_hash.length() == SHA2_256_BYTES
            && output_nonce.length() == SHA2_256_BYTES
            && output_digest.length() == SHA2_256_BYTES,
        EInvalidCompleteOutput,
    );
    commerce::derive_complete_output_seal_id_v5(
        root_id,
        payer,
        recipe_hash,
        output_nonce,
        output_digest,
    )
}

/// Creates an owned policy so publication can register every paid Style and
/// then share it. Root ownership is the only configuration authority.
public fun new_maker_seal_policy_v5(
    root: &MakerRootV5,
    release_commitment: vector<u8>,
    ctx: &mut TxContext,
): MakerSealPolicyV5 {
    assert_root_owner(root, ctx);
    assert!(release_commitment.length() == SHA2_256_BYTES, EInvalidCommitment);
    let policy = MakerSealPolicyV5 {
        id: object::new(ctx),
        version: VERSION,
        root_id: commerce::root_id_v5(root),
        release_commitment,
        registered_assets: table::new(ctx),
        registered_style_products: table::new(ctx),
        asset_count: 0,
        sealed: false,
    };
    event::emit(MakerSealPolicyCreatedV5 {
        policy_id: object::id(&policy),
        root_id: commerce::root_id_v5(root),
        release_commitment,
    });
    policy
}

public fun share_maker_seal_policy_v5(policy: MakerSealPolicyV5) {
    transfer::share_object(policy);
}

entry fun create_and_share_maker_seal_policy_v5(
    root: &MakerRootV5,
    release_commitment: vector<u8>,
    ctx: &mut TxContext,
) {
    share_maker_seal_policy_v5(
        new_maker_seal_policy_v5(root, release_commitment, ctx),
    );
}

/// Registers exactly one PNG gated by paid Base access or a paid Pack.
/// Product provenance is derived from Commerce rather than trusted from a
/// client.
public fun register_paid_style_asset_v5(
    policy: &mut MakerSealPolicyV5,
    root: &MakerRootV5,
    product_kind: u8,
    part_key: String,
    item_key: String,
    style_key: String,
    pack_key: String,
    asset_digest: vector<u8>,
    ctx: &TxContext,
) {
    assert_policy_root(policy, root);
    assert_root_owner(root, ctx);
    assert!(!policy.sealed, EPolicySealed);
    assert!(asset_digest.length() == SHA2_256_BYTES, EInvalidAssetDigest);

    assert!(
        product_kind == PRODUCT_BASE || product_kind == PRODUCT_PACK,
        EInvalidProductKind,
    );
    assert!(
        commerce::style_product_seal_protected_v5(
            root,
            part_key,
            item_key,
            style_key,
        ),
        EStyleIsNotSealProtected,
    );
    let registered_pack = commerce::style_product_pack_key_v5(
        root,
        part_key,
        item_key,
        style_key,
    );
    if (product_kind == PRODUCT_BASE) {
        assert!(
            commerce::base_access_kind_v5(root)
                == commerce::pack_access_paid_once(),
            EBaseIsNotPaid,
        );
        if (registered_pack.is_none()) {
            assert!(pack_key.is_empty(), EPackMismatch);
        } else {
            assert!(*registered_pack.borrow() == pack_key, EPackMismatch);
            let pack = commerce::pack_record_v5(root, pack_key);
            assert!(
                commerce::pack_access_kind_v5(pack)
                    == commerce::pack_access_free(),
                EStyleIsNotPaidPack,
            );
            assert!(commerce::pack_active_v5(pack), EPackInactive);
        };
    } else {
        assert!(registered_pack.is_some(), EStyleIsNotPaidPack);
        assert!(*registered_pack.borrow() == pack_key, EPackMismatch);
        let pack = commerce::pack_record_v5(root, pack_key);
        assert!(
            commerce::pack_access_kind_v5(pack)
                == commerce::pack_access_paid_once(),
            EStyleIsNotPaidPack,
        );
        assert!(commerce::pack_active_v5(pack), EPackInactive);
    };
    let ciphertext_blob_id = commerce::style_product_asset_blob_id_v5(
        root,
        part_key,
        item_key,
        style_key,
    );

    let seal_id = derive_seal_id_v5(
        policy.release_commitment,
        product_kind,
        part_key,
        item_key,
        style_key,
        pack_key,
        asset_digest,
    );
    let style_product_id = hash::sha2_256(bcs::to_bytes(
        &StyleProductIdentityV5 {
            product_kind,
            part_key,
            item_key,
            style_key,
            pack_key,
        },
    ));
    assert!(
        !policy.registered_assets.contains(seal_id),
        EDuplicateSealIdentity,
    );
    assert!(
        !policy.registered_style_products.contains(style_product_id),
        EDuplicateStyleProduct,
    );
    policy.registered_style_products.add(style_product_id, true);
    policy.registered_assets.add(
        seal_id,
        PaidStyleAssetV5 {
            seal_id,
            product_kind,
            part_key,
            item_key,
            style_key,
            pack_key,
            ciphertext_blob_id,
            asset_digest,
        },
    );
    policy.asset_count = policy.asset_count + 1;
    event::emit(PaidStyleAssetRegisteredV5 {
        policy_id: object::id(policy),
        root_id: commerce::root_id_v5(root),
        seal_id,
        product_kind,
        part_key,
        item_key,
        style_key,
        pack_key,
        ciphertext_blob_id,
        asset_digest,
    });
}

/// Permanently freezes the asset registry after Commerce's exact Style
/// registry is frozen. A correction requires a new Maker release/root/policy.
public fun seal_maker_seal_policy_v5(
    policy: &mut MakerSealPolicyV5,
    root: &mut MakerRootV5,
    ctx: &TxContext,
) {
    assert_policy_root(policy, root);
    assert_root_owner(root, ctx);
    assert!(!policy.sealed, EPolicySealed);
    assert!(
        commerce::style_registry_sealed_v5(root),
        ECommerceRegistryNotSealed,
    );
    assert!(policy.asset_count > 0, ENoRegisteredAssets);
    policy.sealed = true;
    commerce::bind_seal_policy_v5(
        root,
        object::id(policy),
        policy.release_commitment,
        policy.asset_count,
    );
    event::emit(MakerSealPolicySealedV5 {
        policy_id: object::id(policy),
        root_id: commerce::root_id_v5(root),
        asset_count: policy.asset_count,
    });
}

public fun policy_id_v5(policy: &MakerSealPolicyV5): ID {
    object::id(policy)
}

public fun policy_root_id_v5(policy: &MakerSealPolicyV5): ID {
    policy.root_id
}

public fun policy_release_commitment_v5(
    policy: &MakerSealPolicyV5,
): &vector<u8> {
    &policy.release_commitment
}

public fun policy_asset_count_v5(policy: &MakerSealPolicyV5): u64 {
    policy.asset_count
}

public fun policy_sealed_v5(policy: &MakerSealPolicyV5): bool {
    policy.sealed
}

/// Seal key servers dry-run a PTB that calls this function. Missing IDs,
/// unsealed policies, wrong roots, free Packs and wallets without both Base
/// and Pack entitlement all fail closed.
entry fun seal_approve_paid_style_v5(
    id: vector<u8>,
    policy: &MakerSealPolicyV5,
    root: &MakerRootV5,
    ctx: &TxContext,
) {
    assert!(
        check_paid_style_access_v5(id, policy, root, ctx.sender()),
        ENoAccess,
    );
}

public fun check_paid_style_access_v5(
    id: vector<u8>,
    policy: &MakerSealPolicyV5,
    root: &MakerRootV5,
    wallet: address,
): bool {
    assert_policy_root(policy, root);
    assert!(policy.version == VERSION, EWrongVersion);
    assert!(policy.sealed, EPolicyNotSealed);
    assert!(
        commerce::style_registry_sealed_v5(root),
        ECommerceRegistryNotSealed,
    );
    if (!policy.registered_assets.contains(id)) return false;
    let asset = policy.registered_assets.borrow(id);
    if (asset.seal_id != id) return false;
    let derived = derive_seal_id_v5(
        policy.release_commitment,
        asset.product_kind,
        asset.part_key,
        asset.item_key,
        asset.style_key,
        asset.pack_key,
        asset.asset_digest,
    );
    if (derived != id) return false;

    let registered_pack = commerce::style_product_pack_key_v5(
        root,
        asset.part_key,
        asset.item_key,
        asset.style_key,
    );
    if (asset.product_kind == PRODUCT_BASE) {
        if (
            commerce::base_access_kind_v5(root)
                != commerce::pack_access_paid_once()
        ) return false;
        if (registered_pack.is_none()) {
            if (!asset.pack_key.is_empty()) return false;
        } else {
            if (*registered_pack.borrow() != asset.pack_key) return false;
            let pack = commerce::pack_record_v5(root, asset.pack_key);
            if (
                commerce::pack_access_kind_v5(pack)
                    != commerce::pack_access_free()
                    || !commerce::pack_active_v5(pack)
            ) return false;
        };
    } else if (asset.product_kind == PRODUCT_PACK) {
        if (
            registered_pack.is_none()
                || *registered_pack.borrow() != asset.pack_key
        ) return false;
    } else {
        return false
    };
    if (
        commerce::style_product_asset_blob_id_v5(
            root,
            asset.part_key,
            asset.item_key,
            asset.style_key,
        ) != asset.ciphertext_blob_id
    ) {
        return false
    };
    if (asset.product_kind == PRODUCT_BASE) {
        commerce::has_base_entitlement_v5(root, wallet)
    } else {
        let pack = commerce::pack_record_v5(root, asset.pack_key);
        commerce::pack_access_kind_v5(pack) == commerce::pack_access_paid_once()
            && commerce::pack_active_v5(pack)
            && commerce::has_base_entitlement_v5(root, wallet)
            && commerce::has_pack_entitlement_v5(root, asset.pack_key, wallet)
    }
}

/// Transitional approval for an encrypted final OC image before it is bound
/// to a Soul in the same Complete+mint PTB. Once bound, this policy fails
/// closed; Soulidity's owner-aware policy becomes the only valid approval path.
entry fun seal_approve_complete_output_v5(
    id: vector<u8>,
    root: &MakerRootV5,
    ctx: &TxContext,
) {
    assert!(
        check_complete_output_access_v5(id, root, ctx.sender()),
        ENoAccess,
    );
}

public fun check_complete_output_access_v5(
    id: vector<u8>,
    root: &MakerRootV5,
    wallet: address,
): bool {
    if (
        id.length() != SHA2_256_BYTES
            || !commerce::complete_output_exists_v5(root, id)
    ) return false;
    let output = commerce::complete_output_record_v5(root, id);
    if (
        commerce::complete_output_is_soul_bound_v5(output)
            || commerce::complete_output_seal_id_v5(output) != &id
            || commerce::complete_output_payer_v5(output) != wallet
            || commerce::complete_output_ciphertext_blob_id_v5(output).is_empty()
    ) return false;
    derive_complete_output_seal_id_v5(
        commerce::root_id_v5(root),
        commerce::complete_output_payer_v5(output),
        *commerce::complete_output_recipe_hash_v5(output),
        *commerce::complete_output_nonce_v5(output),
        *commerce::complete_output_digest_v5(output),
    ) == id
}

fun assert_policy_root(
    policy: &MakerSealPolicyV5,
    root: &MakerRootV5,
) {
    assert!(policy.root_id == commerce::root_id_v5(root), ERootMismatch);
}

fun assert_root_owner(root: &MakerRootV5, ctx: &TxContext) {
    assert!(
        commerce::root_current_owner_v5(root) == ctx.sender(),
        ENotRootOwner,
    );
}

#[test_only]
public fun destroy_policy_for_testing(policy: MakerSealPolicyV5) {
    std::unit_test::destroy(policy);
}

#[test]
fun seal_id_commits_to_every_exact_field() {
    let release = repeated_byte_for_testing(1);
    let digest = repeated_byte_for_testing(2);
    let id = derive_seal_id_v5(
        release,
        PRODUCT_PACK,
        b"hair".to_string(),
        b"long".to_string(),
        b"blue".to_string(),
        b"premium".to_string(),
        digest,
    );
    let changed_style = derive_seal_id_v5(
        release,
        PRODUCT_PACK,
        b"hair".to_string(),
        b"long".to_string(),
        b"red".to_string(),
        b"premium".to_string(),
        digest,
    );
    let changed_digest = derive_seal_id_v5(
        release,
        PRODUCT_PACK,
        b"hair".to_string(),
        b"long".to_string(),
        b"blue".to_string(),
        b"premium".to_string(),
        repeated_byte_for_testing(3),
    );
    assert!(id.length() == 32);
    assert!(id == vector[
        109, 163, 135, 75, 43, 74, 18, 67,
        33, 25, 208, 124, 78, 172, 40, 124,
        125, 119, 166, 252, 65, 16, 3, 244,
        126, 167, 58, 56, 240, 245, 72, 242,
    ]);
    assert!(id != changed_style);
    assert!(id != changed_digest);
}

#[test]
fun complete_output_seal_id_matches_web_bcs_fixture() {
    let id = derive_complete_output_seal_id_v5(
        object::id_from_address(@0x1234),
        @0xABCD,
        repeated_byte_for_testing(3),
        repeated_byte_for_testing(4),
        repeated_byte_for_testing(5),
    );
    assert!(id == vector[
        133, 197, 140, 39, 15, 155, 214, 39,
        12, 57, 193, 164, 74, 166, 62, 60,
        233, 45, 7, 27, 69, 167, 127, 157,
        121, 115, 169, 13, 168, 187, 195, 17,
    ]);
}

#[test]
fun paid_pack_seal_access_tracks_wallet_entitlement() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 80, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut profile = legacy::new_creator_profile(
        b"seal creator".to_string(),
        b"".to_string(),
        b"".to_string(),
        ctx.sender(),
        &mut ctx,
    );
    let (mut maker, legacy_treasury, legacy_cap) =
        legacy::new_managed_oc_maker<sui::sui::SUI>(
            &mut profile,
            b"seal maker".to_string(),
            b"".to_string(),
            b"".to_string(),
            b"manifest".to_string(),
            legacy::license_personal(),
            0,
            false,
            false,
            true,
            true,
            false,
            0,
            &clock,
            &mut ctx,
        );
    legacy::admin_add_part(
        &legacy_cap,
        &mut maker,
        b"hair".to_string(),
        b"Hair".to_string(),
        legacy::part_standard(),
        0,
        true,
        true,
        &clock,
        &mut ctx,
    );
    legacy::admin_add_color(
        &legacy_cap,
        &mut maker,
        b"hair".to_string(),
        b"#0000ff".to_string(),
        &clock,
        &mut ctx,
    );
    legacy::admin_add_item(
        &legacy_cap,
        &mut maker,
        b"hair".to_string(),
        b"long".to_string(),
        b"Long".to_string(),
        b"hair-blob".to_string(),
        b"".to_string(),
        legacy::item_included(),
        &clock,
        &mut ctx,
    );
    legacy::admin_publish_maker(
        &legacy_cap,
        &mut maker,
        b"manifest".to_string(),
        &clock,
        &mut ctx,
    );

    let (
        legacy_config,
        legacy_protocol_treasury,
        mut protocol_admin,
    ) = legacy::new_protocol_fee_objects_for_testing<sui::sui::SUI>(
        false,
        &mut ctx,
    );
    let (mut config, mut protocol_treasury) =
        commerce::new_commerce_protocol_v5_for_testing<sui::sui::SUI>(
            &legacy_config,
            &mut protocol_admin,
            &mut ctx,
        );
    commerce::bind_logical_auxiliary_blob_v5(
        &mut config,
        &protocol_admin,
        b"projection-auxiliary-blob".to_string(),
    );
    commerce::bind_soul_binding_proof_type_v5<
        commerce::TrustedSoulBindingProofV5,
    >(
        &mut config,
        &protocol_admin,
    );
    let (
        mut root,
        mut treasury,
        vault,
        cap,
    ) = commerce::new_migrated_maker_v5_for_testing<sui::sui::SUI>(
        &mut maker,
        &legacy_treasury,
        legacy_cap,
        &config,
        commerce::rights_onchain_native(),
        commerce::new_completion_policy(
            commerce::policy_unlimited_free(),
            0,
            0,
        ),
        250,
        500,
        &clock,
        &mut ctx,
    );
    commerce::update_base_access_v5(
        &mut root,
        &cap,
        commerce::pack_access_paid_once(),
        300,
        &ctx,
    );
    commerce::add_pack_v5(
        &mut root,
        &cap,
        b"free-extra".to_string(),
        b"Free Extra".to_string(),
        commerce::pack_access_free(),
        0,
        commerce::new_completion_policy(
            commerce::policy_unlimited_free(),
            0,
            0,
        ),
        &ctx,
    );
    commerce::add_pack_v5(
        &mut root,
        &cap,
        b"premium".to_string(),
        b"Premium".to_string(),
        commerce::pack_access_paid_once(),
        500,
        commerce::new_completion_policy(
            commerce::policy_unlimited_free(),
            0,
            0,
        ),
        &ctx,
    );
    commerce::register_base_style_v5(
        &mut root,
        &cap,
        &maker,
        b"hair".to_string(),
        b"long".to_string(),
        b"default".to_string(),
        &ctx,
    );
    commerce::register_pack_style_v5(
        &mut root,
        &cap,
        &maker,
        b"hair".to_string(),
        b"long".to_string(),
        b"green".to_string(),
        b"free-extra".to_string(),
        &ctx,
    );
    commerce::register_pack_style_v5(
        &mut root,
        &cap,
        &maker,
        b"hair".to_string(),
        b"long".to_string(),
        b"blue".to_string(),
        b"premium".to_string(),
        &ctx,
    );
    let release = repeated_byte_for_testing(1);
    let digest = repeated_byte_for_testing(2);
    let base_seal_id = derive_seal_id_v5(
        release,
        PRODUCT_BASE,
        b"hair".to_string(),
        b"long".to_string(),
        b"default".to_string(),
        b"".to_string(),
        digest,
    );
    let free_pack_seal_id = derive_seal_id_v5(
        release,
        PRODUCT_BASE,
        b"hair".to_string(),
        b"long".to_string(),
        b"green".to_string(),
        b"free-extra".to_string(),
        digest,
    );
    let paid_pack_seal_id = derive_seal_id_v5(
        release,
        PRODUCT_PACK,
        b"hair".to_string(),
        b"long".to_string(),
        b"blue".to_string(),
        b"premium".to_string(),
        digest,
    );
    let mut policy = new_maker_seal_policy_v5(
        &root,
        release,
        &mut ctx,
    );
    register_paid_style_asset_v5(
        &mut policy,
        &root,
        PRODUCT_BASE,
        b"hair".to_string(),
        b"long".to_string(),
        b"default".to_string(),
        b"".to_string(),
        digest,
        &ctx,
    );
    register_paid_style_asset_v5(
        &mut policy,
        &root,
        PRODUCT_BASE,
        b"hair".to_string(),
        b"long".to_string(),
        b"green".to_string(),
        b"free-extra".to_string(),
        digest,
        &ctx,
    );
    register_paid_style_asset_v5(
        &mut policy,
        &root,
        PRODUCT_PACK,
        b"hair".to_string(),
        b"long".to_string(),
        b"blue".to_string(),
        b"premium".to_string(),
        digest,
        &ctx,
    );
    commerce::seal_style_registry_v5(&mut root, &cap, &ctx);
    seal_maker_seal_policy_v5(&mut policy, &mut root, &ctx);

    assert!(!check_paid_style_access_v5(
        base_seal_id,
        &policy,
        &root,
        ctx.sender(),
    ));
    assert!(!check_paid_style_access_v5(
        free_pack_seal_id,
        &policy,
        &root,
        ctx.sender(),
    ));
    assert!(!check_paid_style_access_v5(
        paid_pack_seal_id,
        &policy,
        &root,
        ctx.sender(),
    ));
    commerce::update_protocol_enabled_v5(&mut config, &protocol_admin, true);
    commerce::activate_maker_v5(&mut root, &cap, &ctx);
    let base_payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(300),
        &mut ctx,
    );
    commerce::purchase_base_access_v5(
        &mut root,
        &mut treasury,
        &config,
        &mut protocol_treasury,
        base_payment,
        &clock,
        &mut ctx,
    );
    assert!(check_paid_style_access_v5(
        base_seal_id,
        &policy,
        &root,
        ctx.sender(),
    ));
    assert!(check_paid_style_access_v5(
        free_pack_seal_id,
        &policy,
        &root,
        ctx.sender(),
    ));
    assert!(!check_paid_style_access_v5(
        paid_pack_seal_id,
        &policy,
        &root,
        ctx.sender(),
    ));
    let payment = coin::from_balance(
        balance::create_for_testing<sui::sui::SUI>(500),
        &mut ctx,
    );
    commerce::purchase_pack_v5(
        &mut root,
        &mut treasury,
        &config,
        &mut protocol_treasury,
        b"premium".to_string(),
        payment,
        &clock,
        &mut ctx,
    );
    assert!(check_paid_style_access_v5(
        paid_pack_seal_id,
        &policy,
        &root,
        ctx.sender(),
    ));
    assert!(!check_paid_style_access_v5(
        paid_pack_seal_id,
        &policy,
        &root,
        @0xB11,
    ));

    // Complete stores the encrypted full-resolution image on Walrus while
    // exposing only a separate public low-resolution preview URL.
    let recipe = vector[legacy::new_recipe_slot(
        b"hair".to_string(),
        b"long".to_string(),
        b"#0000ff".to_string(),
        0,
    )];
    let style_selections = vector[commerce::new_style_selection_v5(
        b"hair".to_string(),
        b"long".to_string(),
        b"blue".to_string(),
    )];
    let recipe_hash =
        commerce::hash_complete_selection_v5(&recipe, &style_selections);
    let output_nonce = repeated_byte_for_testing(21);
    let output_digest = repeated_byte_for_testing(22);
    let output_seal_id = derive_complete_output_seal_id_v5(
        commerce::root_id_v5(&root),
        ctx.sender(),
        recipe_hash,
        output_nonce,
        output_digest,
    );
    let authorization = commerce::authorize_complete_free_v5(
        &mut root,
        &maker,
        &config,
        b"Sealed Complete".to_string(),
        b"profile-json-blob".to_string(),
        b"walrus-seal-ciphertext-blob".to_string(),
        b"https://cdn.example/preview-lowres.webp".to_string(),
        output_seal_id,
        output_nonce,
        output_digest,
        recipe_hash,
        recipe,
        style_selections,
        &clock,
        &ctx,
    );
    assert!(check_complete_output_access_v5(
        output_seal_id,
        &root,
        ctx.sender(),
    ));
    assert!(!check_complete_output_access_v5(
        output_seal_id,
        &root,
        @0xB11,
    ));
    let soul_id = object::id_from_address(@0x501);
    commerce::bind_and_destroy_complete_authorization_v5_for_testing(
        &mut root,
        &config,
        authorization,
        soul_id,
    );

    assert!(commerce::root_complete_output_count_v5(&root) == 1);
    assert!(commerce::complete_output_exists_v5(&root, output_seal_id));
    let output =
        commerce::complete_output_record_v5(&root, output_seal_id);
    assert!(
        commerce::complete_output_seal_id_v5(output) == &output_seal_id
    );
    assert!(commerce::complete_output_payer_v5(output) == ctx.sender());
    assert!(
        commerce::complete_output_recipe_hash_v5(output) == &recipe_hash
    );
    assert!(
        commerce::complete_output_nonce_v5(output) == &output_nonce
    );
    assert!(
        commerce::complete_output_digest_v5(output) == &output_digest
    );
    assert!(
        commerce::complete_output_ciphertext_blob_id_v5(output)
            == &b"walrus-seal-ciphertext-blob".to_string()
    );
    assert!(commerce::complete_output_is_soul_bound_v5(output));
    assert!(
        commerce::complete_output_bound_soul_id_v5(output).borrow()
            == &soul_id,
    );
    assert!(!check_complete_output_access_v5(
        output_seal_id,
        &root,
        ctx.sender(),
    ));
    commerce::pause_maker_v5(&mut root, &cap, &ctx);
    assert!(!check_complete_output_access_v5(
        output_seal_id,
        &root,
        ctx.sender(),
    ));

    sui::clock::destroy_for_testing(clock);
    destroy_policy_for_testing(policy);
    std::unit_test::destroy(profile);
    std::unit_test::destroy(maker);
    std::unit_test::destroy(legacy_treasury);
    std::unit_test::destroy(legacy_config);
    std::unit_test::destroy(legacy_protocol_treasury);
    std::unit_test::destroy(protocol_admin);
    std::unit_test::destroy(config);
    std::unit_test::destroy(protocol_treasury);
    std::unit_test::destroy(root);
    std::unit_test::destroy(treasury);
    std::unit_test::destroy(vault);
    std::unit_test::destroy(cap);
}

#[test_only]
fun repeated_byte_for_testing(byte: u8): vector<u8> {
    let mut result = vector[];
    let mut index = 0;
    while (index < SHA2_256_BYTES) {
        result.push_back(byte);
        index = index + 1;
    };
    result
}
