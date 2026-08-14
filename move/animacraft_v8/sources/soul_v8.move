/// Native Canonical Soul issuance for the fresh v8 TypeOrigin.
///
/// A Soul can be minted only in the same PTB that consumes a successful
/// Complete authorization. It binds the exact activated Root/Complete tuple
/// and never imports a legacy Soul or Maker type.
module animacraft_v8::soul_v8;

use animacraft_v8::complete_v8::{Self as complete, SoulMintAuthorizationV8};
use animacraft_v8::maker_v8::{Self as maker, MakerAdminCapV8, MakerRootV8};
use std::bcs;
use std::hash;
use std::string::String;
use sui::event;
use sui::table::{Self as table, Table};

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;

const EInvalidBinding: u64 = 0;
const EInvalidCommitment: u64 = 1;
const EWrongHolder: u64 = 2;
const EReceiptReplay: u64 = 3;

public struct SoulRegistryV8 has key {
    id: UID,
    version: u64,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    commitment: vector<u8>,
    minted_count: u64,
    consumed_receipts: Table<ID, bool>,
}

/// Canonical v8 Soul. The missing `store` ability prevents generic transfer;
/// its holder and Root epoch remain immutable provenance.
public struct CanonicalSoulV8 has key {
    id: UID,
    version: u64,
    soul_registry_id: ID,
    complete_registry_id: ID,
    complete_receipt_id: ID,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    holder: address,
    output_key: String,
    recipe_commitment: vector<u8>,
    render_commitment: vector<u8>,
    complete_authorization_commitment: vector<u8>,
    completed_at_ms: u64,
    minted_at_ms: u64,
}

public struct SoulRegistryCommitmentInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
}

public struct CanonicalSoulV8Minted has copy, drop {
    soul_id: ID,
    soul_registry_id: ID,
    complete_registry_id: ID,
    complete_receipt_id: ID,
    maker_root_id: ID,
    ownership_epoch: u64,
    holder: address,
    output_key: String,
    recipe_commitment: vector<u8>,
    render_commitment: vector<u8>,
    complete_authorization_commitment: vector<u8>,
}

public fun version_v8(): u64 { VERSION }

/// Stable pre-publication commitment. It intentionally excludes every object
/// ID and ownership epoch created by begin_maker_v8.
public fun registry_commitment_v8(
    root_content_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    hash::sha2_256(bcs::to_bytes(&SoulRegistryCommitmentInputV8 {
        domain: b"animacraft.v8/soul/registry",
        version: VERSION,
        root_content_commitment,
    }))
}

public(package) fun new_soul_registry_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    expected_commitment: vector<u8>,
    ctx: &mut TxContext,
): SoulRegistryV8 {
    maker::assert_draft_admin_v8(root, admin);
    let root_content_commitment = *maker::content_commitment_v8(root);
    assert!(
        expected_commitment == registry_commitment_v8(root_content_commitment),
        EInvalidCommitment,
    );
    SoulRegistryV8 {
        id: object::new(ctx),
        version: VERSION,
        maker_root_id: maker::root_id_v8(root),
        ownership_epoch: maker::ownership_epoch_v8(root),
        root_content_commitment,
        commitment: expected_commitment,
        minted_count: 0,
        consumed_receipts: table::new(ctx),
    }
}

public(package) fun share_soul_registry_v8(registry: SoulRegistryV8) {
    transfer::share_object(registry);
}

public(package) fun assert_activation_ready_v8<PaymentCoin>(
    registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
): (ID, vector<u8>) {
    assert_registry_binding(registry, root);
    assert!(
        registry.commitment == registry_commitment_v8(registry.root_content_commitment),
        EInvalidCommitment,
    );
    (object::id(registry), registry.commitment)
}

public(package) fun rebind_ownership_epoch_v8<PaymentCoin>(
    registry: &mut SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    next_epoch: u64,
) {
    maker::assert_current_admin_v8(root, admin);
    assert_registry_binding(registry, root);
    assert!(next_epoch == maker::ownership_epoch_v8(root) + 1, EInvalidBinding);
    registry.ownership_epoch = next_epoch;
}

/// Consumes the non-ability Complete proof and transfers one immutable
/// CanonicalSoulV8 to the exact completing holder.
public fun mint_canonical_soul_v8<PaymentCoin>(
    registry: &mut SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    authorization: SoulMintAuthorizationV8,
    ctx: &mut TxContext,
) {
    maker::assert_active_root_v8(root);
    assert_registry_binding(registry, root);
    maker::assert_soul_registry_bound_v8(root, object::id(registry));
    let (
        version,
        complete_registry_id,
        complete_receipt_id,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
        holder,
        output_key,
        recipe_commitment,
        render_commitment,
        complete_authorization_commitment,
        completed_at_ms,
    ) = complete::consume_soul_mint_authorization_v8(authorization);
    assert!(version == VERSION, EInvalidBinding);
    maker::assert_complete_registry_bound_v8(root, complete_registry_id);
    assert!(maker_root_id == maker::root_id_v8(root), EInvalidBinding);
    assert!(ownership_epoch == maker::ownership_epoch_v8(root), EInvalidBinding);
    assert!(root_content_commitment == *maker::content_commitment_v8(root), EInvalidBinding);
    assert!(holder == ctx.sender(), EWrongHolder);
    assert_digest(&recipe_commitment);
    assert_digest(&render_commitment);
    assert_digest(&complete_authorization_commitment);
    assert!(!registry.consumed_receipts.contains(complete_receipt_id), EReceiptReplay);
    registry.consumed_receipts.add(complete_receipt_id, true);
    registry.minted_count = registry.minted_count + 1;
    let soul = CanonicalSoulV8 {
        id: object::new(ctx),
        version: VERSION,
        soul_registry_id: object::id(registry),
        complete_registry_id,
        complete_receipt_id,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
        holder,
        output_key,
        recipe_commitment,
        render_commitment,
        complete_authorization_commitment,
        completed_at_ms,
        minted_at_ms: completed_at_ms,
    };
    event::emit(CanonicalSoulV8Minted {
        soul_id: object::id(&soul),
        soul_registry_id: object::id(registry),
        complete_registry_id,
        complete_receipt_id,
        maker_root_id,
        ownership_epoch,
        holder,
        output_key,
        recipe_commitment,
        render_commitment,
        complete_authorization_commitment,
    });
    transfer::transfer(soul, holder);
}

public fun soul_registry_id_v8(registry: &SoulRegistryV8): ID { object::id(registry) }
public fun soul_registry_root_id_v8(registry: &SoulRegistryV8): ID { registry.maker_root_id }
public fun soul_registry_ownership_epoch_v8(registry: &SoulRegistryV8): u64 {
    registry.ownership_epoch
}
public fun soul_registry_commitment_v8(registry: &SoulRegistryV8): &vector<u8> {
    &registry.commitment
}
public fun soul_registry_minted_count_v8(registry: &SoulRegistryV8): u64 {
    registry.minted_count
}
public fun soul_holder_v8(soul: &CanonicalSoulV8): address { soul.holder }
public fun soul_root_id_v8(soul: &CanonicalSoulV8): ID { soul.maker_root_id }
public fun soul_ownership_epoch_v8(soul: &CanonicalSoulV8): u64 { soul.ownership_epoch }
public fun soul_complete_receipt_id_v8(soul: &CanonicalSoulV8): ID {
    soul.complete_receipt_id
}
public fun soul_recipe_commitment_v8(soul: &CanonicalSoulV8): &vector<u8> {
    &soul.recipe_commitment
}
public fun soul_render_commitment_v8(soul: &CanonicalSoulV8): &vector<u8> {
    &soul.render_commitment
}

fun assert_registry_binding<PaymentCoin>(
    registry: &SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(registry.version == VERSION, EInvalidBinding);
    assert!(registry.maker_root_id == maker::root_id_v8(root), EInvalidBinding);
    assert!(registry.ownership_epoch == maker::ownership_epoch_v8(root), EInvalidBinding);
    assert!(
        registry.root_content_commitment == *maker::content_commitment_v8(root),
        EInvalidBinding,
    );
}

fun assert_digest(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
}
