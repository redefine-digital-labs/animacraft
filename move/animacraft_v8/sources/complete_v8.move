module animacraft_v8::complete_v8;

use animacraft_v8::composition_v8::{
    Self as composition,
    CompositionRegistryV8,
    OwnedLoadoutV8,
};
use animacraft_v8::expansion_pack_v8::{Self as pack, PackStyleAccessProofV8};
use animacraft_v8::maker_v8::{
    Self as maker,
    MakerAdminCapV8,
    MakerRootV8,
    MakerTreasuryV8,
};
use animacraft_v8::protocol_config_v8::{ProtocolConfigV8, ProtocolTreasuryV8};
use animacraft_v8::seal_v8::{Self as seal, SealRegistryV8};
use std::bcs;
use std::hash;
use std::string::String;
use sui::clock::Clock;
use sui::coin::Coin;
use sui::event;
use sui::table::{Self as table, Table};

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;
const MAX_KEY_BYTES: u64 = 256;

const EInvalidBinding: u64 = 0;
const EInvalidCommitment: u64 = 1;
const EInvalidCount: u64 = 2;
const EInvalidSequence: u64 = 3;
const EInvalidKey: u64 = 4;
const EDuplicate: u64 = 5;
const ERegistrySealed: u64 = 6;
const ERegistryNotSealed: u64 = 7;
const EOutputMissing: u64 = 8;
const EOutputMismatch: u64 = 9;
const EAuthorizationSealed: u64 = 10;
const EAuthorizationNotSealed: u64 = 11;
const EAuthorizationMismatch: u64 = 12;
const EWalletQuotaExceeded: u64 = 13;
const ETotalCapExceeded: u64 = 14;
const EWrongPayer: u64 = 15;

public struct CompleteOutputKeyV8 has copy, drop, store {
    output_key: String,
}

public struct CompleteOutputPolicyV8 has copy, drop, store {
    output_key: String,
    recipe_commitment: vector<u8>,
    output_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
}

public struct CompleteRegistryV8 has key {
    id: UID,
    version: u64,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    expected_count: u64,
    observed_count: u64,
    expected_commitment: vector<u8>,
    rolling_commitment: vector<u8>,
    sealed: bool,
    total_completes: u64,
    outputs: Table<CompleteOutputKeyV8, CompleteOutputPolicyV8>,
    wallet_complete_counts: Table<address, u64>,
}

public struct PackSelectionCommitmentV8 has copy, drop, store {
    release_id: ID,
    release_content_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
}

/// One-transaction authorization. No ability is intentional.
public struct CompleteAuthorizationV8 {
    version: u64,
    registry_id: ID,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    payer: address,
    paid_atomic: u64,
    output_key: String,
    loadout_id: ID,
    loadout_revision: u64,
    loadout_commitment: vector<u8>,
    recipe_commitment: vector<u8>,
    output_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
    pack_selections: vector<PackSelectionCommitmentV8>,
    authorization_commitment: vector<u8>,
    sealed: bool,
}

public struct CompleteReceiptV8 has key {
    id: UID,
    version: u64,
    registry_id: ID,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    holder: address,
    paid_atomic: u64,
    output_key: String,
    loadout_id: ID,
    loadout_revision: u64,
    loadout_commitment: vector<u8>,
    recipe_commitment: vector<u8>,
    output_commitment: vector<u8>,
    seal_id: vector<u8>,
    pack_selection_commitment: vector<u8>,
    authorization_commitment: vector<u8>,
    completed_at_ms: u64,
}

public struct CompleteEmptyHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
}

public struct CompleteOutputHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    output_key: String,
    recipe_commitment: vector<u8>,
    output_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
}

public struct CompleteAuthorizationHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    registry_id: ID,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    payer: address,
    paid_atomic: u64,
    output_key: String,
    loadout_id: ID,
    loadout_revision: u64,
    loadout_commitment: vector<u8>,
    recipe_commitment: vector<u8>,
    output_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
    pack_selections: vector<PackSelectionCommitmentV8>,
}

public struct CompleteOutputAppendedV8 has copy, drop {
    registry_id: ID,
    sequence: u64,
    output_key: String,
    protected: bool,
    rolling_commitment: vector<u8>,
}

public struct CompleteRegistrySealedV8 has copy, drop {
    registry_id: ID,
    output_count: u64,
    commitment: vector<u8>,
}

public struct CompleteCreatedV8 has copy, drop {
    receipt_id: ID,
    registry_id: ID,
    maker_root_id: ID,
    holder: address,
    paid_atomic: u64,
    output_key: String,
    authorization_commitment: vector<u8>,
    completed_at_ms: u64,
}

public fun version_v8(): u64 { VERSION }

public(package) fun new_complete_registry_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    expected_count: u64,
    expected_commitment: vector<u8>,
    ctx: &mut TxContext,
): CompleteRegistryV8 {
    maker::assert_draft_admin_v8(root, admin);
    assert_digest(&expected_commitment);
    let maker_root_id = maker::root_id_v8(root);
    let ownership_epoch = maker::ownership_epoch_v8(root);
    let root_content_commitment = *maker::content_commitment_v8(root);
    let rolling_commitment = empty_commitment(
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
    );
    if (expected_count == 0) {
        assert!(expected_commitment == rolling_commitment, EInvalidCommitment);
    };
    CompleteRegistryV8 {
        id: object::new(ctx),
        version: VERSION,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
        expected_count,
        observed_count: 0,
        expected_commitment,
        rolling_commitment,
        sealed: false,
        total_completes: 0,
        outputs: table::new(ctx),
        wallet_complete_counts: table::new(ctx),
    }
}

public(package) fun share_complete_registry_v8(registry: CompleteRegistryV8) {
    transfer::share_object(registry);
}

public fun append_complete_output_v8<PaymentCoin>(
    registry: &mut CompleteRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    seal_registry: &SealRegistryV8,
    sequence: u64,
    output_key: String,
    recipe_commitment: vector<u8>,
    output_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_binding(registry, root);
    assert!(!registry.sealed, ERegistrySealed);
    assert!(sequence == registry.observed_count, EInvalidSequence);
    assert!(registry.observed_count < registry.expected_count, EInvalidCount);
    assert_key(&output_key);
    assert_digest(&recipe_commitment);
    assert_digest(&output_commitment);
    let key = CompleteOutputKeyV8 { output_key };
    assert!(!registry.outputs.contains(key), EDuplicate);
    if (protected) {
        assert_digest(&seal_id);
        seal::assert_asset_covered_v8(
            seal_registry,
            root,
            seal::scope_complete_v8(),
            object::id(registry),
            output_key,
            &output_commitment,
            &seal_id,
        );
    } else {
        assert!(seal_id.is_empty(), EOutputMismatch);
    };
    registry.rolling_commitment = hash::sha2_256(bcs::to_bytes(&CompleteOutputHashInputV8 {
        domain: b"animacraft.v8/complete/output",
        version: VERSION,
        maker_root_id: registry.maker_root_id,
        ownership_epoch: registry.ownership_epoch,
        root_content_commitment: registry.root_content_commitment,
        sequence,
        prior_commitment: registry.rolling_commitment,
        output_key,
        recipe_commitment,
        output_commitment,
        protected,
        seal_id,
    }));
    registry.outputs.add(key, CompleteOutputPolicyV8 {
        output_key,
        recipe_commitment,
        output_commitment,
        protected,
        seal_id,
    });
    registry.observed_count = registry.observed_count + 1;
    event::emit(CompleteOutputAppendedV8 {
        registry_id: object::id(registry),
        sequence,
        output_key,
        protected,
        rolling_commitment: registry.rolling_commitment,
    });
}

public fun seal_complete_registry_v8<PaymentCoin>(
    registry: &mut CompleteRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_binding(registry, root);
    assert!(!registry.sealed, ERegistrySealed);
    assert!(registry.observed_count == registry.expected_count, EInvalidCount);
    assert!(registry.rolling_commitment == registry.expected_commitment, EInvalidCommitment);
    registry.sealed = true;
    event::emit(CompleteRegistrySealedV8 {
        registry_id: object::id(registry),
        output_count: registry.observed_count,
        commitment: registry.rolling_commitment,
    });
}

public(package) fun assert_activation_ready_v8<PaymentCoin>(
    registry: &CompleteRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
): (ID, vector<u8>, u64) {
    assert_registry_binding(registry, root);
    assert!(registry.sealed, ERegistryNotSealed);
    assert!(registry.observed_count == registry.expected_count, EInvalidCount);
    assert!(registry.rolling_commitment == registry.expected_commitment, EInvalidCommitment);
    (object::id(registry), registry.rolling_commitment, registry.observed_count)
}

public(package) fun rebind_ownership_epoch_v8<PaymentCoin>(
    registry: &mut CompleteRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    next_epoch: u64,
) {
    maker::assert_current_admin_v8(root, admin);
    assert_registry_binding(registry, root);
    assert!(registry.sealed, ERegistryNotSealed);
    assert!(next_epoch == maker::ownership_epoch_v8(root) + 1, EInvalidBinding);
    registry.ownership_epoch = next_epoch;
}

public fun begin_free_complete_v8<PaymentCoin>(
    registry: &CompleteRegistryV8,
    composition_registry: &CompositionRegistryV8,
    loadout: &OwnedLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    output_key: String,
    ctx: &TxContext,
): CompleteAuthorizationV8 {
    maker::assert_active_root_v8(root);
    maker::assert_complete_free_v8(root);
    new_authorization(
        registry,
        composition_registry,
        loadout,
        root,
        output_key,
        0,
        ctx,
    )
}

public fun begin_paid_complete_v8<PaymentCoin>(
    registry: &CompleteRegistryV8,
    composition_registry: &CompositionRegistryV8,
    loadout: &OwnedLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_treasury: &mut MakerTreasuryV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    output_key: String,
    ctx: &mut TxContext,
): CompleteAuthorizationV8 {
    let paid_atomic = maker::collect_complete_payment_v8(
        root,
        maker_treasury,
        protocol_config,
        protocol_treasury,
        payment,
        ctx,
    );
    new_authorization(
        registry,
        composition_registry,
        loadout,
        root,
        output_key,
        paid_atomic,
        ctx,
    )
}

public fun append_pack_style_to_complete_v8(
    authorization: &mut CompleteAuthorizationV8,
    proof: PackStyleAccessProofV8,
) {
    assert!(!authorization.sealed, EAuthorizationSealed);
    let (
        release_id,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
        release_content_commitment,
        holder,
        part_key,
        item_key,
        style_key,
        asset_commitment,
        protected,
        seal_id,
    ) = pack::consume_style_access_proof_v8(proof);
    assert!(maker_root_id == authorization.maker_root_id, EAuthorizationMismatch);
    assert!(ownership_epoch == authorization.ownership_epoch, EAuthorizationMismatch);
    assert!(root_content_commitment == authorization.root_content_commitment, EAuthorizationMismatch);
    assert!(holder == authorization.payer, EWrongPayer);
    authorization.pack_selections.push_back(PackSelectionCommitmentV8 {
        release_id,
        release_content_commitment,
        part_key,
        item_key,
        style_key,
        asset_commitment,
        protected,
        seal_id,
    });
}

public fun seal_complete_authorization_v8(
    authorization: &mut CompleteAuthorizationV8,
): vector<u8> {
    assert!(!authorization.sealed, EAuthorizationSealed);
    authorization.authorization_commitment = hash::sha2_256(bcs::to_bytes(
        &CompleteAuthorizationHashInputV8 {
            domain: b"animacraft.v8/complete/authorization",
            version: VERSION,
            registry_id: authorization.registry_id,
            maker_root_id: authorization.maker_root_id,
            ownership_epoch: authorization.ownership_epoch,
            root_content_commitment: authorization.root_content_commitment,
            payer: authorization.payer,
            paid_atomic: authorization.paid_atomic,
            output_key: authorization.output_key,
            loadout_id: authorization.loadout_id,
            loadout_revision: authorization.loadout_revision,
            loadout_commitment: authorization.loadout_commitment,
            recipe_commitment: authorization.recipe_commitment,
            output_commitment: authorization.output_commitment,
            protected: authorization.protected,
            seal_id: authorization.seal_id,
            pack_selections: authorization.pack_selections,
        },
    ));
    authorization.sealed = true;
    authorization.authorization_commitment
}

public fun complete_v8<PaymentCoin>(
    registry: &mut CompleteRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    authorization: CompleteAuthorizationV8,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    maker::assert_active_root_v8(root);
    assert_registry_binding(registry, root);
    assert!(registry.sealed, ERegistryNotSealed);
    let CompleteAuthorizationV8 {
        version,
        registry_id,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
        payer,
        paid_atomic,
        output_key,
        loadout_id,
        loadout_revision,
        loadout_commitment,
        recipe_commitment,
        output_commitment,
        protected: _,
        seal_id,
        pack_selections,
        authorization_commitment,
        sealed,
    } = authorization;
    assert!(version == VERSION && sealed, EAuthorizationNotSealed);
    assert!(registry_id == object::id(registry), EAuthorizationMismatch);
    assert!(maker_root_id == maker::root_id_v8(root), EAuthorizationMismatch);
    assert!(ownership_epoch == maker::ownership_epoch_v8(root), EAuthorizationMismatch);
    assert!(root_content_commitment == *maker::content_commitment_v8(root), EAuthorizationMismatch);
    assert!(payer == ctx.sender(), EWrongPayer);
    assert_digest(&authorization_commitment);
    let economics = maker::root_economics_v8(root);
    let per_wallet_quota = maker::economics_complete_per_wallet_quota_v8(&economics);
    let total_cap = maker::economics_complete_total_cap_v8(&economics);
    let wallet_count = if (registry.wallet_complete_counts.contains(payer)) {
        *registry.wallet_complete_counts.borrow(payer)
    } else {
        0
    };
    if (per_wallet_quota > 0) {
        assert!(wallet_count < per_wallet_quota, EWalletQuotaExceeded);
    };
    if (total_cap > 0) {
        assert!(registry.total_completes < total_cap, ETotalCapExceeded);
    };
    if (registry.wallet_complete_counts.contains(payer)) {
        *registry.wallet_complete_counts.borrow_mut(payer) = wallet_count + 1;
    } else {
        registry.wallet_complete_counts.add(payer, 1);
    };
    registry.total_completes = registry.total_completes + 1;
    let pack_selection_commitment = hash::sha2_256(bcs::to_bytes(&pack_selections));
    let completed_at_ms = clock.timestamp_ms();
    let receipt = CompleteReceiptV8 {
        id: object::new(ctx),
        version: VERSION,
        registry_id,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
        holder: payer,
        paid_atomic,
        output_key,
        loadout_id,
        loadout_revision,
        loadout_commitment,
        recipe_commitment,
        output_commitment,
        seal_id,
        pack_selection_commitment,
        authorization_commitment,
        completed_at_ms,
    };
    let receipt_id = object::id(&receipt);
    event::emit(CompleteCreatedV8 {
        receipt_id,
        registry_id,
        maker_root_id,
        holder: payer,
        paid_atomic,
        output_key,
        authorization_commitment,
        completed_at_ms,
    });
    transfer::transfer(receipt, payer);
}

public fun registry_id_v8(self: &CompleteRegistryV8): ID { object::id(self) }
public fun registry_commitment_v8(self: &CompleteRegistryV8): &vector<u8> {
    &self.rolling_commitment
}
public fun registry_output_count_v8(self: &CompleteRegistryV8): u64 { self.observed_count }
public fun registry_total_completes_v8(self: &CompleteRegistryV8): u64 { self.total_completes }
public fun registry_sealed_v8(self: &CompleteRegistryV8): bool { self.sealed }
public fun wallet_complete_count_v8(self: &CompleteRegistryV8, wallet: address): u64 {
    if (self.wallet_complete_counts.contains(wallet)) {
        *self.wallet_complete_counts.borrow(wallet)
    } else {
        0
    }
}
public fun receipt_holder_v8(self: &CompleteReceiptV8): address { self.holder }
public fun receipt_root_id_v8(self: &CompleteReceiptV8): ID { self.maker_root_id }
public fun receipt_output_commitment_v8(self: &CompleteReceiptV8): &vector<u8> {
    &self.output_commitment
}
public fun receipt_authorization_commitment_v8(self: &CompleteReceiptV8): &vector<u8> {
    &self.authorization_commitment
}

fun new_authorization<PaymentCoin>(
    registry: &CompleteRegistryV8,
    composition_registry: &CompositionRegistryV8,
    loadout: &OwnedLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    output_key: String,
    paid_atomic: u64,
    ctx: &TxContext,
): CompleteAuthorizationV8 {
    assert_registry_binding(registry, root);
    assert!(registry.sealed, ERegistryNotSealed);
    assert_key(&output_key);
    assert!(registry.outputs.contains(CompleteOutputKeyV8 { output_key }), EOutputMissing);
    let output = registry.outputs.borrow(CompleteOutputKeyV8 { output_key });
    let (loadout_id, loadout_revision, loadout_commitment) =
        composition::assert_loadout_ready_v8(loadout, composition_registry, root);
    CompleteAuthorizationV8 {
        version: VERSION,
        registry_id: object::id(registry),
        maker_root_id: maker::root_id_v8(root),
        ownership_epoch: maker::ownership_epoch_v8(root),
        root_content_commitment: *maker::content_commitment_v8(root),
        payer: ctx.sender(),
        paid_atomic,
        output_key,
        loadout_id,
        loadout_revision,
        loadout_commitment,
        recipe_commitment: output.recipe_commitment,
        output_commitment: output.output_commitment,
        protected: output.protected,
        seal_id: output.seal_id,
        pack_selections: vector[],
        authorization_commitment: vector[],
        sealed: false,
    }
}

fun assert_registry_binding<PaymentCoin>(
    registry: &CompleteRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(registry.version == VERSION, EInvalidBinding);
    assert!(registry.maker_root_id == maker::root_id_v8(root), EInvalidBinding);
    assert!(registry.ownership_epoch == maker::ownership_epoch_v8(root), EInvalidBinding);
    assert!(registry.root_content_commitment == *maker::content_commitment_v8(root), EInvalidBinding);
}

fun empty_commitment(
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&CompleteEmptyHashInputV8 {
        domain: b"animacraft.v8/complete/empty",
        version: VERSION,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
    }))
}

fun assert_key(value: &String) {
    assert!(value.length() > 0 && value.length() <= MAX_KEY_BYTES, EInvalidKey);
}

fun assert_digest(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
}
