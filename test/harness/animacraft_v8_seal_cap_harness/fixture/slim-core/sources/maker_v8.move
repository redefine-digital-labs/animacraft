/// Minimal localnet fixture authority used only to construct the exact
/// production Base registry module for metered seal measurements.
module animacraft_v8_core::maker_v8;

use std::option::{Self as option, Option};

const VERSION: u64 = 8;
const DRAFT: u8 = 0;
const E_INVALID: u64 = 0;

public struct MakerRootV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    maker_version: u64,
    content_commitment: vector<u8>,
    expected_base_definition_count: u64,
    expected_base_registry_commitment: vector<u8>,
    base_registry_id: Option<ID>,
    admin_cap_id: ID,
    owner: address,
    lifecycle: u8,
}

public struct MakerAdminCapV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    owner: address,
    control_epoch: u64,
}

public(package) fun new_root_for_seal_cap<PaymentCoin>(
    expected_base_definition_count: u64,
    expected_base_registry_commitment: vector<u8>,
    content_commitment: vector<u8>,
    ctx: &mut TxContext,
): (MakerRootV8<PaymentCoin>, MakerAdminCapV8) {
    let root_uid = object::new(ctx);
    let root_id = root_uid.to_inner();
    let admin = MakerAdminCapV8 {
        id: object::new(ctx),
        version: VERSION,
        root_id,
        owner: ctx.sender(),
        control_epoch: 0,
    };
    let admin_cap_id = object::id(&admin);
    (
        MakerRootV8 {
            id: root_uid,
            version: VERSION,
            maker_version: 1,
            content_commitment,
            expected_base_definition_count,
            expected_base_registry_commitment,
            base_registry_id: option::none(),
            admin_cap_id,
            owner: ctx.sender(),
            lifecycle: DRAFT,
        },
        admin,
    )
}

public(package) fun finalize_base_registry_binding_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry_id: ID,
) {
    assert_draft_admin_v8(root, admin);
    assert!(root.base_registry_id.is_none(), E_INVALID);
    root.base_registry_id = option::some(base_registry_id);
}

public(package) fun share_maker_root_and_admin_v8<PaymentCoin>(
    root: MakerRootV8<PaymentCoin>,
    admin: MakerAdminCapV8,
    ctx: &TxContext,
) {
    assert_draft_admin_v8(&root, &admin);
    transfer::share_object(root);
    transfer::transfer(admin, ctx.sender());
}

public fun assert_draft_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>) {
    assert!(root.lifecycle == DRAFT, E_INVALID);
}

public fun assert_draft_admin_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    assert_draft_v8(root);
    assert!(admin.version == VERSION, E_INVALID);
    assert!(admin.root_id == object::id(root), E_INVALID);
    assert!(object::id(admin) == root.admin_cap_id, E_INVALID);
    assert!(admin.owner == root.owner, E_INVALID);
}

public fun assert_base_registry_identity_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: &vector<u8>,
) {
    assert!(root.base_registry_id.is_some(), E_INVALID);
    assert!(registry_id == *root.base_registry_id.borrow(), E_INVALID);
    assert_root_identity_v8(root, root_id, maker_version, root_content_commitment);
}

public fun assert_root_identity_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: &vector<u8>,
) {
    assert!(root_id == object::id(root), E_INVALID);
    assert!(maker_version == root.maker_version, E_INVALID);
    assert!(root_content_commitment == &root.content_commitment, E_INVALID);
}

public fun root_id_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): ID {
    object::id(root)
}

public fun root_maker_version_v8<PaymentCoin>(root: &MakerRootV8<PaymentCoin>): u64 {
    root.maker_version
}

public fun root_content_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> {
    &root.content_commitment
}

public fun root_expected_base_definition_count_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): u64 {
    root.expected_base_definition_count
}

public fun root_expected_base_registry_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): &vector<u8> {
    &root.expected_base_registry_commitment
}
