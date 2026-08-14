module animacraft_v8::complete_v8;

use animacraft_v8::composition_v8::{
    Self as composition,
    CompositionRegistryV8,
    OwnedLoadoutV8,
};
use animacraft_v8::expansion_pack_v8::{
    Self as pack,
    ExpansionPackRegistryV8,
    ExpansionPackReleaseV8,
    PackStyleAccessProofV8,
};
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
const MAX_SCOPE_KEY_BYTES: u64 = 512;
const MAX_REQUIRED_PACK_SELECTIONS: u64 = 64;

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
const EWrongPayment: u64 = 16;

public struct CompleteOutputKeyV8 has copy, drop, store {
    output_key: String,
}

public struct CompletePackPolicyKeyV8 has copy, drop, store {
    pack_scope_key: String,
}

public struct PackWalletCompleteKeyV8 has copy, drop, store {
    pack_scope_key: String,
    wallet: address,
}

public struct CompleteOutputPolicyV8 has copy, drop, store {
    output_key: String,
    recipe_policy_commitment: vector<u8>,
    renderer_schema_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
    required_pack_selection_count: u64,
    required_pack_selection_commitment: vector<u8>,
}

public struct CompletePackPolicyV8 has copy, drop, store {
    release_id: ID,
    pack_scope_key: String,
    release_content_commitment: vector<u8>,
    mode: u8,
    price_atomic: u64,
    free_quota_per_wallet: u64,
    total_cap: u64,
}

public struct CompleteRegistryV8 has key {
    id: UID,
    version: u64,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    expected_output_count: u64,
    observed_output_count: u64,
    expected_pack_policy_count: u64,
    observed_pack_policy_count: u64,
    expected_count: u64,
    observed_count: u64,
    expected_commitment: vector<u8>,
    rolling_commitment: vector<u8>,
    sealed: bool,
    protected_output_count: u64,
    total_completes: u64,
    outputs: Table<CompleteOutputKeyV8, CompleteOutputPolicyV8>,
    pack_policies: Table<CompletePackPolicyKeyV8, CompletePackPolicyV8>,
    wallet_complete_counts: Table<address, u64>,
    pack_wallet_complete_counts: Table<PackWalletCompleteKeyV8, u64>,
    pack_total_complete_counts: Table<CompletePackPolicyKeyV8, u64>,
}

public struct PackSelectionCommitmentV8 has copy, drop, store {
    release_id: ID,
    pack_scope_key: String,
    release_content_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
}

public struct PackCompletionSnapshotV8 has copy, drop, store {
    pack_scope_key: String,
    wallet_count: u64,
    total_count: u64,
    content_payment_atomic: u64,
}

public struct StablePackSelectionHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    pack_scope_key: String,
    release_content_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
}

public struct StablePackSelectionEmptyHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
}

/// One-transaction authorization. No ability is intentional.
public struct CompleteAuthorizationV8 {
    version: u64,
    registry_id: ID,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    payer: address,
    base_wallet_count: u64,
    base_total_count: u64,
    base_content_payment_atomic: u64,
    output_key: String,
    loadout_id: ID,
    loadout_revision: u64,
    loadout_commitment: vector<u8>,
    recipe_commitment: vector<u8>,
    output_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
    required_pack_selection_count: u64,
    required_pack_selection_commitment: vector<u8>,
    pack_selections: vector<PackSelectionCommitmentV8>,
    pack_completion_snapshots: vector<PackCompletionSnapshotV8>,
    pack_selection_commitment: vector<u8>,
    required_content_payment_atomic: u64,
    authorization_commitment: vector<u8>,
    sealed: bool,
}

/// Same-PTB proof emitted only by successful Complete consumption. With no
/// abilities it cannot be stored, copied, dropped, or replayed in a later tx.
public struct SoulMintAuthorizationV8 {
    version: u64,
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
    root_content_commitment: vector<u8>,
}

public struct CompleteOutputHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    output_key: String,
    recipe_policy_commitment: vector<u8>,
    renderer_schema_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
    required_pack_selection_count: u64,
    required_pack_selection_commitment: vector<u8>,
}

public struct CompletePackPolicyHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    pack_scope_key: String,
    release_content_commitment: vector<u8>,
    mode: u8,
    price_atomic: u64,
    free_quota_per_wallet: u64,
    total_cap: u64,
}

public struct CompleteAuthorizationHashInputV8 has copy, drop, store {
    domain: vector<u8>,
    version: u64,
    registry_id: ID,
    maker_root_id: ID,
    ownership_epoch: u64,
    root_content_commitment: vector<u8>,
    payer: address,
    base_wallet_count: u64,
    base_total_count: u64,
    base_content_payment_atomic: u64,
    output_key: String,
    loadout_id: ID,
    loadout_revision: u64,
    loadout_commitment: vector<u8>,
    recipe_commitment: vector<u8>,
    output_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
    required_pack_selection_count: u64,
    required_pack_selection_commitment: vector<u8>,
    pack_selections: vector<PackSelectionCommitmentV8>,
    pack_completion_snapshots: vector<PackCompletionSnapshotV8>,
    pack_selection_commitment: vector<u8>,
    required_content_payment_atomic: u64,
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

/// Pure pre-publication helper. Object IDs and ownership epochs are checked
/// by the registry but intentionally excluded from semantic commitments.
public fun empty_registry_commitment_v8(
    root_content_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    hash::sha2_256(bcs::to_bytes(&CompleteEmptyHashInputV8 {
        domain: b"animacraft.v8/complete/empty",
        version: VERSION,
        root_content_commitment,
    }))
}

public fun advance_output_commitment_v8(
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    output_key: String,
    recipe_policy_commitment: vector<u8>,
    renderer_schema_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
    required_pack_selection_count: u64,
    required_pack_selection_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    assert_digest(&prior_commitment);
    assert_key(&output_key);
    assert_digest(&recipe_policy_commitment);
    assert_digest(&renderer_schema_commitment);
    if (protected) {
        assert_digest(&seal_id);
    } else {
        assert!(seal_id.is_empty(), EOutputMismatch);
    };
    assert!(required_pack_selection_count <= MAX_REQUIRED_PACK_SELECTIONS, EInvalidCount);
    assert_digest(&required_pack_selection_commitment);
    hash::sha2_256(bcs::to_bytes(&CompleteOutputHashInputV8 {
        domain: b"animacraft.v8/complete/output",
        version: VERSION,
        root_content_commitment,
        sequence,
        prior_commitment,
        output_key,
        recipe_policy_commitment,
        renderer_schema_commitment,
        protected,
        seal_id,
        required_pack_selection_count,
        required_pack_selection_commitment,
    }))
}

/// Stable publication commitment for the exact Complete policy copied from a
/// registered Pack release. The release object ID is verified and stored at
/// append time but intentionally excluded from this pre-publication hash.
public fun advance_pack_policy_commitment_v8(
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    pack_scope_key: String,
    release_content_commitment: vector<u8>,
    mode: u8,
    price_atomic: u64,
    free_quota_per_wallet: u64,
    total_cap: u64,
): vector<u8> {
    assert_digest(&root_content_commitment);
    assert_digest(&prior_commitment);
    assert_scope_key(&pack_scope_key);
    assert_digest(&release_content_commitment);
    maker::assert_valid_complete_policy_v8(
        mode,
        price_atomic,
        free_quota_per_wallet,
        total_cap,
    );
    hash::sha2_256(bcs::to_bytes(&CompletePackPolicyHashInputV8 {
        domain: b"animacraft.v8/complete/pack-policy",
        version: VERSION,
        root_content_commitment,
        sequence,
        prior_commitment,
        pack_scope_key,
        release_content_commitment,
        mode,
        price_atomic,
        free_quota_per_wallet,
        total_cap,
    }))
}

/// The stable Seal scope key for one Complete output. The recipe commitment
/// is the matching scope commitment passed to Seal coverage APIs.
public fun output_seal_scope_key_v8(output_key: String): String {
    assert_key(&output_key);
    output_key
}

public fun output_seal_scope_commitment_v8(
    recipe_policy_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&recipe_policy_commitment);
    recipe_policy_commitment
}

public fun empty_required_pack_selection_commitment_v8(
    root_content_commitment: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    hash::sha2_256(bcs::to_bytes(&StablePackSelectionEmptyHashInputV8 {
        domain: b"animacraft.v8/complete/pack-selection/empty",
        version: VERSION,
        root_content_commitment,
    }))
}

/// Pure ordered transition for the stable portion of a Pack selection.
/// Release object identity remains in the transaction-local proof only.
public fun advance_required_pack_selection_commitment_v8(
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    pack_scope_key: String,
    release_content_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
): vector<u8> {
    assert_digest(&root_content_commitment);
    assert_digest(&prior_commitment);
    assert_scope_key(&pack_scope_key);
    assert_digest(&release_content_commitment);
    assert_key(&part_key);
    assert_key(&item_key);
    assert_key(&style_key);
    assert_digest(&asset_commitment);
    if (protected) {
        assert_digest(&seal_id);
    } else {
        assert!(seal_id.is_empty(), EOutputMismatch);
    };
    hash::sha2_256(bcs::to_bytes(&StablePackSelectionHashInputV8 {
        domain: b"animacraft.v8/complete/pack-selection",
        version: VERSION,
        root_content_commitment,
        sequence,
        prior_commitment,
        pack_scope_key,
        release_content_commitment,
        part_key,
        item_key,
        style_key,
        asset_commitment,
        protected,
        seal_id,
    }))
}

public(package) fun new_complete_registry_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    expected_output_count: u64,
    expected_pack_policy_count: u64,
    expected_commitment: vector<u8>,
    ctx: &mut TxContext,
): CompleteRegistryV8 {
    maker::assert_draft_admin_v8(root, admin);
    assert_digest(&expected_commitment);
    let maker_root_id = maker::root_id_v8(root);
    let ownership_epoch = maker::ownership_epoch_v8(root);
    let root_content_commitment = *maker::content_commitment_v8(root);
    let rolling_commitment = empty_registry_commitment_v8(root_content_commitment);
    let expected_count = expected_output_count + expected_pack_policy_count;
    if (expected_count == 0) {
        assert!(expected_commitment == rolling_commitment, EInvalidCommitment);
    };
    CompleteRegistryV8 {
        id: object::new(ctx),
        version: VERSION,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
        expected_output_count,
        observed_output_count: 0,
        expected_pack_policy_count,
        observed_pack_policy_count: 0,
        expected_count,
        observed_count: 0,
        expected_commitment,
        rolling_commitment,
        sealed: false,
        protected_output_count: 0,
        total_completes: 0,
        outputs: table::new(ctx),
        pack_policies: table::new(ctx),
        wallet_complete_counts: table::new(ctx),
        pack_wallet_complete_counts: table::new(ctx),
        pack_total_complete_counts: table::new(ctx),
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
    recipe_policy_commitment: vector<u8>,
    renderer_schema_commitment: vector<u8>,
    protected: bool,
    seal_id: vector<u8>,
    required_pack_selection_count: u64,
    required_pack_selection_commitment: vector<u8>,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_binding(registry, root);
    assert!(!registry.sealed, ERegistrySealed);
    assert!(sequence == registry.observed_count, EInvalidSequence);
    assert!(registry.observed_output_count < registry.expected_output_count, EInvalidCount);
    assert_key(&output_key);
    assert_digest(&recipe_policy_commitment);
    assert_digest(&renderer_schema_commitment);
    assert!(required_pack_selection_count <= MAX_REQUIRED_PACK_SELECTIONS, EInvalidCount);
    assert_digest(&required_pack_selection_commitment);
    if (required_pack_selection_count == 0) {
        assert!(
            required_pack_selection_commitment
                == empty_required_pack_selection_commitment_v8(registry.root_content_commitment),
            EInvalidCommitment,
        );
    };
    let key = CompleteOutputKeyV8 { output_key };
    assert!(!registry.outputs.contains(key), EDuplicate);
    if (protected) {
        assert_digest(&seal_id);
        let scope_commitment = output_seal_scope_commitment_v8(recipe_policy_commitment);
        seal::assert_asset_covered_v8(
            seal_registry,
            root,
            seal::scope_complete_v8(),
            output_seal_scope_key_v8(output_key),
            &scope_commitment,
            output_key,
            &renderer_schema_commitment,
            &seal_id,
        );
        registry.protected_output_count = registry.protected_output_count + 1;
    } else {
        assert!(seal_id.is_empty(), EOutputMismatch);
    };
    registry.rolling_commitment = advance_output_commitment_v8(
        registry.root_content_commitment,
        sequence,
        registry.rolling_commitment,
        output_key,
        recipe_policy_commitment,
        renderer_schema_commitment,
        protected,
        seal_id,
        required_pack_selection_count,
        required_pack_selection_commitment,
    );
    registry.outputs.add(key, CompleteOutputPolicyV8 {
        output_key,
        recipe_policy_commitment,
        renderer_schema_commitment,
        protected,
        seal_id,
        required_pack_selection_count,
        required_pack_selection_commitment,
    });
    registry.observed_output_count = registry.observed_output_count + 1;
    registry.observed_count = registry.observed_count + 1;
}

/// Copies the exact native Complete policy of one concrete registered Pack
/// release. All output rows must be staged first, yielding one canonical
/// global chain `outputs -> pack policies`.
public fun append_complete_pack_policy_v8<PaymentCoin>(
    registry: &mut CompleteRegistryV8,
    pack_registry: &ExpansionPackRegistryV8,
    release: &ExpansionPackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_binding(registry, root);
    assert!(!registry.sealed, ERegistrySealed);
    assert!(registry.observed_output_count == registry.expected_output_count, EInvalidCount);
    assert!(registry.observed_pack_policy_count < registry.expected_pack_policy_count, EInvalidCount);
    assert!(sequence == registry.observed_count, EInvalidSequence);
    let (
        release_id,
        pack_scope_key,
        release_content_commitment,
        mode,
        price_atomic,
        free_quota_per_wallet,
        total_cap,
    ) = pack::registered_complete_policy_v8(pack_registry, release, root);
    let key = CompletePackPolicyKeyV8 { pack_scope_key };
    assert!(!registry.pack_policies.contains(key), EDuplicate);
    registry.rolling_commitment = advance_pack_policy_commitment_v8(
        registry.root_content_commitment,
        sequence,
        registry.rolling_commitment,
        pack_scope_key,
        release_content_commitment,
        mode,
        price_atomic,
        free_quota_per_wallet,
        total_cap,
    );
    registry.pack_policies.add(key, CompletePackPolicyV8 {
        release_id,
        pack_scope_key,
        release_content_commitment,
        mode,
        price_atomic,
        free_quota_per_wallet,
        total_cap,
    });
    registry.observed_pack_policy_count = registry.observed_pack_policy_count + 1;
    registry.observed_count = registry.observed_count + 1;
}

public fun seal_complete_registry_v8<PaymentCoin>(
    registry: &mut CompleteRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_binding(registry, root);
    assert!(!registry.sealed, ERegistrySealed);
    assert!(registry.observed_output_count == registry.expected_output_count, EInvalidCount);
    assert!(registry.observed_pack_policy_count == registry.expected_pack_policy_count, EInvalidCount);
    assert!(registry.observed_count == registry.expected_count, EInvalidCount);
    assert!(registry.rolling_commitment == registry.expected_commitment, EInvalidCommitment);
    registry.sealed = true;
}

public(package) fun assert_activation_ready_v8<PaymentCoin>(
    registry: &CompleteRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
): (ID, vector<u8>, u64, u64, u64) {
    assert_registry_binding(registry, root);
    assert!(registry.sealed, ERegistryNotSealed);
    assert!(registry.observed_count == registry.expected_count, EInvalidCount);
    assert!(registry.rolling_commitment == registry.expected_commitment, EInvalidCommitment);
    (
        object::id(registry),
        registry.rolling_commitment,
        registry.observed_output_count,
        registry.protected_output_count,
        registry.observed_pack_policy_count,
    )
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

/// Payment is deferred until all used Pack line items have been appended and
/// the exact base-plus-Pack subtotal has been sealed.
public fun begin_complete_v8<PaymentCoin>(
    registry: &CompleteRegistryV8,
    composition_registry: &CompositionRegistryV8,
    loadout: &OwnedLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    output_key: String,
    ctx: &TxContext,
): CompleteAuthorizationV8 {
    maker::assert_active_root_v8(root);
    maker::assert_maker_access_v8(root, ctx.sender());
    new_authorization(registry, composition_registry, loadout, root, output_key, ctx)
}

public fun append_pack_style_to_complete_v8(
    authorization: &mut CompleteAuthorizationV8,
    registry: &CompleteRegistryV8,
    proof: PackStyleAccessProofV8,
) {
    assert!(!authorization.sealed, EAuthorizationSealed);
    assert!(authorization.registry_id == object::id(registry), EAuthorizationMismatch);
    assert!(registry.sealed, ERegistryNotSealed);
    let (
        release_id,
        pack_scope_key,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
        release_content_commitment,
        complete_mode,
        complete_price_atomic,
        complete_free_quota_per_wallet,
        complete_total_cap,
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
    let policy_key = CompletePackPolicyKeyV8 { pack_scope_key };
    assert!(registry.pack_policies.contains(policy_key), EOutputMissing);
    let policy = registry.pack_policies.borrow(policy_key);
    assert!(policy.release_id == release_id, EAuthorizationMismatch);
    assert!(&policy.release_content_commitment == &release_content_commitment, EAuthorizationMismatch);
    assert!(policy.mode == complete_mode, EAuthorizationMismatch);
    assert!(policy.price_atomic == complete_price_atomic, EAuthorizationMismatch);
    assert!(policy.free_quota_per_wallet == complete_free_quota_per_wallet, EAuthorizationMismatch);
    assert!(policy.total_cap == complete_total_cap, EAuthorizationMismatch);
    assert!(
        authorization.pack_selections.length() < authorization.required_pack_selection_count,
        EInvalidCount,
    );
    assert_unique_pack_selection(
        &authorization.pack_selections,
        &pack_scope_key,
        &part_key,
        &item_key,
        &style_key,
    );
    if (!contains_pack_snapshot(&authorization.pack_completion_snapshots, &pack_scope_key)) {
        let wallet_count = pack_wallet_count(registry, pack_scope_key, authorization.payer);
        let total_count = pack_total_count(registry, pack_scope_key);
        authorization.pack_completion_snapshots.push_back(PackCompletionSnapshotV8 {
            pack_scope_key,
            wallet_count,
            total_count,
            content_payment_atomic: charge_for_policy(
                complete_mode,
                complete_price_atomic,
                complete_free_quota_per_wallet,
                complete_total_cap,
                wallet_count,
                total_count,
            ),
        });
    };
    authorization.pack_selections.push_back(PackSelectionCommitmentV8 {
        release_id,
        pack_scope_key,
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
    assert!(
        authorization.pack_selections.length() == authorization.required_pack_selection_count,
        EInvalidCount,
    );
    let mut selection_commitment = empty_required_pack_selection_commitment_v8(
        authorization.root_content_commitment,
    );
    let mut selection_index = 0;
    while (selection_index < authorization.pack_selections.length()) {
        let selection = authorization.pack_selections.borrow(selection_index);
        selection_commitment = advance_required_pack_selection_commitment_v8(
            authorization.root_content_commitment,
            selection_index,
            selection_commitment,
            selection.pack_scope_key,
            selection.release_content_commitment,
            selection.part_key,
            selection.item_key,
            selection.style_key,
            selection.asset_commitment,
            selection.protected,
            selection.seal_id,
        );
        selection_index = selection_index + 1;
    };
    assert!(
        selection_commitment == authorization.required_pack_selection_commitment,
        EInvalidCommitment,
    );
    authorization.pack_selection_commitment = selection_commitment;
    let mut content_atomic = authorization.base_content_payment_atomic;
    let mut pack_index = 0;
    while (pack_index < authorization.pack_completion_snapshots.length()) {
        let snapshot = authorization.pack_completion_snapshots.borrow(pack_index);
        content_atomic = content_atomic + snapshot.content_payment_atomic;
        pack_index = pack_index + 1;
    };
    authorization.required_content_payment_atomic = content_atomic;
    // The staged output row stores authoring policy/schema commitments. Once
    // all exact selections are known, these private fields are replaced by
    // canonical instance commitments used by the receipt and Soul proof.
    let recipe_policy_commitment = authorization.recipe_commitment;
    let renderer_schema_commitment = authorization.output_commitment;
    let mut recipe_bytes = b"animacraft.v8/complete/canonical-recipe";
    recipe_bytes.append(authorization.root_content_commitment);
    recipe_bytes.append(recipe_policy_commitment);
    recipe_bytes.append(authorization.loadout_commitment);
    recipe_bytes.append(authorization.pack_selection_commitment);
    recipe_bytes.append(authorization.output_key.into_bytes());
    authorization.recipe_commitment = hash::sha2_256(recipe_bytes);
    let mut render_bytes = b"animacraft.v8/complete/canonical-render";
    render_bytes.append(authorization.root_content_commitment);
    render_bytes.append(renderer_schema_commitment);
    render_bytes.append(authorization.recipe_commitment);
    render_bytes.append(authorization.output_key.into_bytes());
    authorization.output_commitment = hash::sha2_256(render_bytes);
    authorization.authorization_commitment = hash::sha2_256(bcs::to_bytes(
        &CompleteAuthorizationHashInputV8 {
            domain: b"animacraft.v8/complete/authorization",
            version: VERSION,
            registry_id: authorization.registry_id,
            maker_root_id: authorization.maker_root_id,
            ownership_epoch: authorization.ownership_epoch,
            root_content_commitment: authorization.root_content_commitment,
            payer: authorization.payer,
            base_wallet_count: authorization.base_wallet_count,
            base_total_count: authorization.base_total_count,
            base_content_payment_atomic: authorization.base_content_payment_atomic,
            output_key: authorization.output_key,
            loadout_id: authorization.loadout_id,
            loadout_revision: authorization.loadout_revision,
            loadout_commitment: authorization.loadout_commitment,
            recipe_commitment: authorization.recipe_commitment,
            output_commitment: authorization.output_commitment,
            protected: authorization.protected,
            seal_id: authorization.seal_id,
            required_pack_selection_count: authorization.required_pack_selection_count,
            required_pack_selection_commitment:
                authorization.required_pack_selection_commitment,
            pack_selections: authorization.pack_selections,
            pack_completion_snapshots: authorization.pack_completion_snapshots,
            pack_selection_commitment: authorization.pack_selection_commitment,
            required_content_payment_atomic: authorization.required_content_payment_atomic,
        },
    ));
    authorization.sealed = true;
    authorization.authorization_commitment
}

public fun complete_without_payment_v8<PaymentCoin>(
    registry: &mut CompleteRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    authorization: CompleteAuthorizationV8,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulMintAuthorizationV8 {
    maker::assert_complete_no_payment_v8(
        root,
        config,
        authorization.required_content_payment_atomic,
    );
    complete_authorization(registry, root, authorization, 0, clock, ctx)
}

public fun complete_with_payment_v8<PaymentCoin>(
    registry: &mut CompleteRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_treasury: &mut MakerTreasuryV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    authorization: CompleteAuthorizationV8,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulMintAuthorizationV8 {
    let content_atomic = authorization.required_content_payment_atomic;
    let paid_atomic = maker::collect_complete_payment_v8(
        root,
        maker_treasury,
        config,
        protocol_treasury,
        payment,
        content_atomic,
        ctx,
    );
    assert!(paid_atomic > 0, EWrongPayment);
    complete_authorization(registry, root, authorization, paid_atomic, clock, ctx)
}

fun complete_authorization<PaymentCoin>(
    registry: &mut CompleteRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    authorization: CompleteAuthorizationV8,
    paid_atomic: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulMintAuthorizationV8 {
    maker::assert_active_root_v8(root);
    assert_registry_binding(registry, root);
    maker::assert_complete_registry_bound_v8(root, object::id(registry));
    assert!(registry.sealed, ERegistryNotSealed);
    let CompleteAuthorizationV8 {
        version,
        registry_id,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
        payer,
        base_wallet_count,
        base_total_count,
        base_content_payment_atomic,
        output_key,
        loadout_id,
        loadout_revision,
        loadout_commitment,
        recipe_commitment,
        output_commitment,
        protected: _,
        seal_id,
        required_pack_selection_count,
        required_pack_selection_commitment,
        pack_selections: _,
        pack_completion_snapshots,
        pack_selection_commitment,
        required_content_payment_atomic,
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
    assert!(required_pack_selection_count <= MAX_REQUIRED_PACK_SELECTIONS, EInvalidCount);
    assert!(pack_selection_commitment == required_pack_selection_commitment, EAuthorizationMismatch);
    let wallet_count = wallet_count(registry, payer);
    assert_exact_count_snapshot(
        base_wallet_count,
        wallet_count,
        base_total_count,
        registry.total_completes,
    );
    let mut expected_content_atomic = base_content_payment_atomic;
    let mut pack_index = 0;
    while (pack_index < pack_completion_snapshots.length()) {
        let snapshot = pack_completion_snapshots.borrow(pack_index);
        assert_exact_count_snapshot(
            snapshot.wallet_count,
            pack_wallet_count(registry, snapshot.pack_scope_key, payer),
            snapshot.total_count,
            pack_total_count(registry, snapshot.pack_scope_key),
        );
        expected_content_atomic = expected_content_atomic + snapshot.content_payment_atomic;
        pack_index = pack_index + 1;
    };
    assert!(expected_content_atomic == required_content_payment_atomic, EAuthorizationMismatch);
    assert!(
        (paid_atomic == 0 && required_content_payment_atomic == 0)
            || paid_atomic >= required_content_payment_atomic,
        EAuthorizationMismatch,
    );
    if (registry.wallet_complete_counts.contains(payer)) {
        *registry.wallet_complete_counts.borrow_mut(payer) = wallet_count + 1;
    } else {
        registry.wallet_complete_counts.add(payer, 1);
    };
    registry.total_completes = registry.total_completes + 1;
    pack_index = 0;
    while (pack_index < pack_completion_snapshots.length()) {
        let snapshot = pack_completion_snapshots.borrow(pack_index);
        increment_pack_counts(registry, snapshot.pack_scope_key, payer);
        pack_index = pack_index + 1;
    };
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
    let soul_authorization = SoulMintAuthorizationV8 {
        version: VERSION,
        complete_registry_id: registry_id,
        complete_receipt_id: receipt_id,
        maker_root_id,
        ownership_epoch,
        root_content_commitment,
        holder: payer,
        output_key,
        recipe_commitment,
        render_commitment: output_commitment,
        complete_authorization_commitment: authorization_commitment,
        completed_at_ms,
    };
    transfer::transfer(receipt, payer);
    soul_authorization
}

public(package) fun consume_soul_mint_authorization_v8(
    authorization: SoulMintAuthorizationV8,
): (u64, ID, ID, ID, u64, vector<u8>, address, String, vector<u8>, vector<u8>, vector<u8>, u64) {
    let SoulMintAuthorizationV8 {
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
    } = authorization;
    (
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
    )
}

public fun registry_id_v8(self: &CompleteRegistryV8): ID { object::id(self) }
public fun registry_commitment_v8(self: &CompleteRegistryV8): &vector<u8> {
    &self.rolling_commitment
}
public fun registry_output_count_v8(self: &CompleteRegistryV8): u64 {
    self.observed_output_count
}
public fun registry_pack_policy_count_v8(self: &CompleteRegistryV8): u64 {
    self.observed_pack_policy_count
}
public fun registry_protected_output_count_v8(self: &CompleteRegistryV8): u64 {
    self.protected_output_count
}
public fun registry_total_completes_v8(self: &CompleteRegistryV8): u64 { self.total_completes }
public fun registry_sealed_v8(self: &CompleteRegistryV8): bool { self.sealed }
public fun wallet_complete_count_v8(self: &CompleteRegistryV8, wallet: address): u64 {
    wallet_count(self, wallet)
}
public fun pack_wallet_complete_count_v8(
    self: &CompleteRegistryV8,
    pack_scope_key: String,
    wallet: address,
): u64 {
    pack_wallet_count(self, pack_scope_key, wallet)
}
public fun pack_total_complete_count_v8(
    self: &CompleteRegistryV8,
    pack_scope_key: String,
): u64 {
    pack_total_count(self, pack_scope_key)
}
public fun authorization_required_content_payment_v8(
    authorization: &CompleteAuthorizationV8,
): u64 { authorization.required_content_payment_atomic }
public fun receipt_holder_v8(self: &CompleteReceiptV8): address { self.holder }
public fun receipt_root_id_v8(self: &CompleteReceiptV8): ID { self.maker_root_id }
public fun receipt_paid_atomic_v8(self: &CompleteReceiptV8): u64 { self.paid_atomic }
public fun receipt_canonical_recipe_commitment_v8(
    self: &CompleteReceiptV8,
): &vector<u8> {
    &self.recipe_commitment
}
public fun receipt_canonical_render_commitment_v8(
    self: &CompleteReceiptV8,
): &vector<u8> {
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
    ctx: &TxContext,
): CompleteAuthorizationV8 {
    assert_registry_binding(registry, root);
    maker::assert_complete_registry_bound_v8(root, object::id(registry));
    assert!(registry.sealed, ERegistryNotSealed);
    assert_key(&output_key);
    assert!(registry.outputs.contains(CompleteOutputKeyV8 { output_key }), EOutputMissing);
    let output = registry.outputs.borrow(CompleteOutputKeyV8 { output_key });
    let (loadout_id, loadout_revision, loadout_commitment) =
        composition::assert_loadout_ready_v8(loadout, composition_registry, root);
    let economics = maker::root_economics_v8(root);
    let payer = ctx.sender();
    let base_wallet_count = wallet_count(registry, payer);
    let base_total_count = registry.total_completes;
    CompleteAuthorizationV8 {
        version: VERSION,
        registry_id: object::id(registry),
        maker_root_id: maker::root_id_v8(root),
        ownership_epoch: maker::ownership_epoch_v8(root),
        root_content_commitment: *maker::content_commitment_v8(root),
        payer,
        base_wallet_count,
        base_total_count,
        base_content_payment_atomic: charge_for_policy(
            maker::economics_complete_mode_v8(&economics),
            maker::economics_complete_price_v8(&economics),
            maker::economics_complete_per_wallet_quota_v8(&economics),
            maker::economics_complete_total_cap_v8(&economics),
            base_wallet_count,
            base_total_count,
        ),
        output_key,
        loadout_id,
        loadout_revision,
        loadout_commitment,
        recipe_commitment: output.recipe_policy_commitment,
        output_commitment: output.renderer_schema_commitment,
        protected: output.protected,
        seal_id: output.seal_id,
        required_pack_selection_count: output.required_pack_selection_count,
        required_pack_selection_commitment: output.required_pack_selection_commitment,
        pack_selections: vector[],
        pack_completion_snapshots: vector[],
        pack_selection_commitment: vector[],
        required_content_payment_atomic: 0,
        authorization_commitment: vector[],
        sealed: false,
    }
}

fun charge_for_policy(
    mode: u8,
    price_atomic: u64,
    free_quota_per_wallet: u64,
    total_cap: u64,
    wallet_count: u64,
    total_count: u64,
): u64 {
    maker::assert_valid_complete_policy_v8(
        mode,
        price_atomic,
        free_quota_per_wallet,
        total_cap,
    );
    if (total_cap > 0) assert!(total_count < total_cap, ETotalCapExceeded);
    if (mode == maker::complete_unlimited_free_v8()) return 0;
    if (mode == maker::complete_paid_every_time_v8()) return price_atomic;
    if (wallet_count < free_quota_per_wallet) return 0;
    if (mode == maker::complete_free_quota_then_paid_v8()) return price_atomic;
    assert!(false, EWalletQuotaExceeded);
    0
}

fun assert_exact_count_snapshot(
    expected_wallet_count: u64,
    actual_wallet_count: u64,
    expected_total_count: u64,
    actual_total_count: u64,
) {
    assert!(expected_wallet_count == actual_wallet_count, EAuthorizationMismatch);
    assert!(expected_total_count == actual_total_count, EAuthorizationMismatch);
}

fun wallet_count(registry: &CompleteRegistryV8, wallet: address): u64 {
    if (registry.wallet_complete_counts.contains(wallet)) {
        *registry.wallet_complete_counts.borrow(wallet)
    } else {
        0
    }
}

fun pack_wallet_count(
    registry: &CompleteRegistryV8,
    pack_scope_key: String,
    wallet: address,
): u64 {
    let key = PackWalletCompleteKeyV8 { pack_scope_key, wallet };
    if (registry.pack_wallet_complete_counts.contains(key)) {
        *registry.pack_wallet_complete_counts.borrow(key)
    } else {
        0
    }
}

fun pack_total_count(registry: &CompleteRegistryV8, pack_scope_key: String): u64 {
    let key = CompletePackPolicyKeyV8 { pack_scope_key };
    if (registry.pack_total_complete_counts.contains(key)) {
        *registry.pack_total_complete_counts.borrow(key)
    } else {
        0
    }
}

fun increment_pack_counts(
    registry: &mut CompleteRegistryV8,
    pack_scope_key: String,
    wallet: address,
) {
    let wallet_key = PackWalletCompleteKeyV8 { pack_scope_key, wallet };
    let wallet_count = pack_wallet_count(registry, pack_scope_key, wallet);
    if (registry.pack_wallet_complete_counts.contains(wallet_key)) {
        *registry.pack_wallet_complete_counts.borrow_mut(wallet_key) = wallet_count + 1;
    } else {
        registry.pack_wallet_complete_counts.add(wallet_key, 1);
    };
    let total_key = CompletePackPolicyKeyV8 { pack_scope_key };
    let total_count = pack_total_count(registry, pack_scope_key);
    if (registry.pack_total_complete_counts.contains(total_key)) {
        *registry.pack_total_complete_counts.borrow_mut(total_key) = total_count + 1;
    } else {
        registry.pack_total_complete_counts.add(total_key, 1);
    };
}

fun contains_pack_snapshot(
    snapshots: &vector<PackCompletionSnapshotV8>,
    pack_scope_key: &String,
): bool {
    let mut index = 0;
    while (index < snapshots.length()) {
        if (&snapshots.borrow(index).pack_scope_key == pack_scope_key) return true;
        index = index + 1;
    };
    false
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

fun assert_unique_pack_selection(
    selections: &vector<PackSelectionCommitmentV8>,
    pack_scope_key: &String,
    part_key: &String,
    item_key: &String,
    style_key: &String,
) {
    let mut index = 0;
    while (index < selections.length()) {
        let selection = selections.borrow(index);
        assert!(
            &selection.pack_scope_key != pack_scope_key
                || &selection.part_key != part_key
                || &selection.item_key != item_key
                || &selection.style_key != style_key,
            EDuplicate,
        );
        index = index + 1;
    };
}

fun assert_key(value: &String) {
    assert!(value.length() > 0 && value.length() <= MAX_KEY_BYTES, EInvalidKey);
}

fun assert_scope_key(value: &String) {
    assert!(value.length() > 0 && value.length() <= MAX_SCOPE_KEY_BYTES, EInvalidKey);
}

fun assert_digest(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
}

#[test_only]
fun test_pack_selection_v8(style_key: String, release: address): PackSelectionCommitmentV8 {
    PackSelectionCommitmentV8 {
        release_id: object::id_from_address(release),
        pack_scope_key: b"scope".to_string(),
        release_content_commitment: maker::test_digest(50),
        part_key: b"face".to_string(),
        item_key: b"base".to_string(),
        style_key,
        asset_commitment: maker::test_digest(51),
        protected: false,
        seal_id: vector[],
    }
}

#[test_only]
fun advance_test_selection_v8(
    sequence: u64,
    prior: vector<u8>,
    selection: &PackSelectionCommitmentV8,
): vector<u8> {
    advance_required_pack_selection_commitment_v8(
        maker::test_digest(3),
        sequence,
        prior,
        selection.pack_scope_key,
        selection.release_content_commitment,
        selection.part_key,
        selection.item_key,
        selection.style_key,
        selection.asset_commitment,
        selection.protected,
        selection.seal_id,
    )
}

#[test_only]
fun test_authorization_v8(
    pack_selections: vector<PackSelectionCommitmentV8>,
    required_pack_selection_count: u64,
    required_pack_selection_commitment: vector<u8>,
): CompleteAuthorizationV8 {
    CompleteAuthorizationV8 {
        version: VERSION,
        registry_id: object::id_from_address(@0xC1),
        maker_root_id: object::id_from_address(@0xC2),
        ownership_epoch: 0,
        root_content_commitment: maker::test_digest(3),
        payer: @0xA11,
        base_wallet_count: 0,
        base_total_count: 0,
        base_content_payment_atomic: 0,
        output_key: b"final".to_string(),
        loadout_id: object::id_from_address(@0xC3),
        loadout_revision: 1,
        loadout_commitment: maker::test_digest(52),
        recipe_commitment: maker::test_digest(53),
        output_commitment: maker::test_digest(54),
        protected: false,
        seal_id: vector[],
        required_pack_selection_count,
        required_pack_selection_commitment,
        pack_selections,
        pack_completion_snapshots: vector[],
        pack_selection_commitment: vector[],
        required_content_payment_atomic: 0,
        authorization_commitment: vector[],
        sealed: false,
    }
}

#[test_only]
fun destroy_test_authorization_v8(authorization: CompleteAuthorizationV8) {
    let CompleteAuthorizationV8 {
        version: _,
        registry_id: _,
        maker_root_id: _,
        ownership_epoch: _,
        root_content_commitment: _,
        payer: _,
        base_wallet_count: _,
        base_total_count: _,
        base_content_payment_atomic: _,
        output_key: _,
        loadout_id: _,
        loadout_revision: _,
        loadout_commitment: _,
        recipe_commitment: _,
        output_commitment: _,
        protected: _,
        seal_id: _,
        required_pack_selection_count: _,
        required_pack_selection_commitment: _,
        pack_selections: _,
        pack_completion_snapshots: _,
        pack_selection_commitment: _,
        required_content_payment_atomic: _,
        authorization_commitment: _,
        sealed: _,
    } = authorization;
}

#[test_only]
public(package) fun new_sealed_authorization_for_soul_testing<PaymentCoin>(
    registry: &CompleteRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    holder: address,
): CompleteAuthorizationV8 {
    let economics = maker::root_economics_v8(root);
    let mode = maker::economics_complete_mode_v8(&economics);
    let price_atomic = maker::economics_complete_price_v8(&economics);
    let free_quota_per_wallet = maker::economics_complete_per_wallet_quota_v8(&economics);
    let total_cap = maker::economics_complete_total_cap_v8(&economics);
    let base_wallet_count = wallet_count(registry, holder);
    let base_total_count = registry.total_completes;
    let required_content_payment_atomic = charge_for_policy(
        mode,
        price_atomic,
        free_quota_per_wallet,
        total_cap,
        base_wallet_count,
        base_total_count,
    );
    CompleteAuthorizationV8 {
        version: VERSION,
        registry_id: object::id(registry),
        maker_root_id: maker::root_id_v8(root),
        ownership_epoch: maker::ownership_epoch_v8(root),
        root_content_commitment: *maker::content_commitment_v8(root),
        payer: holder,
        base_wallet_count,
        base_total_count,
        base_content_payment_atomic: required_content_payment_atomic,
        output_key: b"canonical-soul".to_string(),
        loadout_id: object::id_from_address(@0xC3),
        loadout_revision: 1,
        loadout_commitment: maker::test_digest(52),
        recipe_commitment: maker::test_digest(53),
        output_commitment: maker::test_digest(54),
        protected: false,
        seal_id: vector[],
        required_pack_selection_count: 0,
        required_pack_selection_commitment:
            empty_required_pack_selection_commitment_v8(*maker::content_commitment_v8(root)),
        pack_selections: vector[],
        pack_completion_snapshots: vector[],
        pack_selection_commitment:
            empty_required_pack_selection_commitment_v8(*maker::content_commitment_v8(root)),
        required_content_payment_atomic,
        authorization_commitment: maker::test_digest(60),
        sealed: true,
    }
}

#[test_only]
public(package) fun new_pack_authorization_for_testing<PaymentCoin>(
    registry: &CompleteRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    holder: address,
    required_pack_selection_commitment: vector<u8>,
): CompleteAuthorizationV8 {
    let economics = maker::root_economics_v8(root);
    let base_wallet_count = wallet_count(registry, holder);
    let base_total_count = registry.total_completes;
    CompleteAuthorizationV8 {
        version: VERSION,
        registry_id: object::id(registry),
        maker_root_id: maker::root_id_v8(root),
        ownership_epoch: maker::ownership_epoch_v8(root),
        root_content_commitment: *maker::content_commitment_v8(root),
        payer: holder,
        base_wallet_count,
        base_total_count,
        base_content_payment_atomic: charge_for_policy(
            maker::economics_complete_mode_v8(&economics),
            maker::economics_complete_price_v8(&economics),
            maker::economics_complete_per_wallet_quota_v8(&economics),
            maker::economics_complete_total_cap_v8(&economics),
            base_wallet_count,
            base_total_count,
        ),
        output_key: b"pack-complete".to_string(),
        loadout_id: object::id_from_address(@0xC3),
        loadout_revision: 1,
        loadout_commitment: maker::test_digest(52),
        recipe_commitment: maker::test_digest(53),
        output_commitment: maker::test_digest(54),
        protected: false,
        seal_id: vector[],
        required_pack_selection_count: 1,
        required_pack_selection_commitment,
        pack_selections: vector[],
        pack_completion_snapshots: vector[],
        pack_selection_commitment: vector[],
        required_content_payment_atomic: 0,
        authorization_commitment: vector[],
        sealed: false,
    }
}

#[test_only]
public(package) fun set_pack_policy_count_for_testing(
    registry: &mut CompleteRegistryV8,
    count: u64,
) {
    registry.expected_pack_policy_count = count;
    registry.observed_pack_policy_count = count;
    registry.expected_count = registry.expected_output_count + count;
    registry.observed_count = registry.observed_output_count + count;
}

#[test_only]
public(package) fun duplicate_soul_authorization_for_testing(
    authorization: SoulMintAuthorizationV8,
): (SoulMintAuthorizationV8, SoulMintAuthorizationV8) {
    let SoulMintAuthorizationV8 {
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
    } = authorization;
    (
        SoulMintAuthorizationV8 {
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
        },
        SoulMintAuthorizationV8 {
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
        },
    )
}

#[test_only]
public(package) fun set_soul_authorization_holder_for_testing(
    authorization: &mut SoulMintAuthorizationV8,
    holder: address,
) {
    authorization.holder = holder;
}

#[test_only]
public(package) fun set_soul_authorization_content_for_testing(
    authorization: &mut SoulMintAuthorizationV8,
    root_content_commitment: vector<u8>,
) {
    authorization.root_content_commitment = root_content_commitment;
}

#[test]
fun exact_ordered_pack_selection_commitment_seals() {
    let first = test_pack_selection_v8(b"alpha".to_string(), @0xA1);
    let second = test_pack_selection_v8(b"beta".to_string(), @0xA2);
    let empty = empty_required_pack_selection_commitment_v8(maker::test_digest(3));
    let first_commitment = advance_test_selection_v8(0, empty, &first);
    let expected = advance_test_selection_v8(1, first_commitment, &second);
    let mut authorization = test_authorization_v8(vector[first, second], 2, expected);
    let observed = seal_complete_authorization_v8(&mut authorization);
    assert!(observed.length() == HASH_LENGTH, EInvalidCommitment);
    destroy_test_authorization_v8(authorization);
}

#[test]
fun canonical_recipe_and_render_bind_exact_loadout() {
    let empty = empty_required_pack_selection_commitment_v8(maker::test_digest(3));
    let mut first = test_authorization_v8(vector[], 0, empty);
    let mut second = test_authorization_v8(vector[], 0, empty);
    second.loadout_commitment = maker::test_digest(99);
    seal_complete_authorization_v8(&mut first);
    seal_complete_authorization_v8(&mut second);
    assert!(first.recipe_commitment != second.recipe_commitment, EInvalidCommitment);
    assert!(first.output_commitment != second.output_commitment, EInvalidCommitment);
    destroy_test_authorization_v8(first);
    destroy_test_authorization_v8(second);
}

#[test, expected_failure(abort_code = EInvalidCount)]
fun missing_pack_selection_cannot_seal_authorization() {
    let expected = maker::test_digest(55);
    let mut authorization = test_authorization_v8(vector[], 1, expected);
    seal_complete_authorization_v8(&mut authorization);
    destroy_test_authorization_v8(authorization);
}

#[test, expected_failure(abort_code = EInvalidCount)]
fun extra_pack_selection_cannot_seal_authorization() {
    let first = test_pack_selection_v8(b"alpha".to_string(), @0xA1);
    let second = test_pack_selection_v8(b"beta".to_string(), @0xA2);
    let mut authorization = test_authorization_v8(
        vector[first, second],
        1,
        maker::test_digest(55),
    );
    seal_complete_authorization_v8(&mut authorization);
    destroy_test_authorization_v8(authorization);
}

#[test, expected_failure(abort_code = EInvalidCommitment)]
fun reordered_pack_selections_cannot_seal_authorization() {
    let first = test_pack_selection_v8(b"alpha".to_string(), @0xA1);
    let second = test_pack_selection_v8(b"beta".to_string(), @0xA2);
    let empty = empty_required_pack_selection_commitment_v8(maker::test_digest(3));
    let first_commitment = advance_test_selection_v8(0, empty, &first);
    let expected = advance_test_selection_v8(1, first_commitment, &second);
    let mut authorization = test_authorization_v8(vector[second, first], 2, expected);
    seal_complete_authorization_v8(&mut authorization);
    destroy_test_authorization_v8(authorization);
}

#[test, expected_failure(abort_code = EDuplicate)]
fun duplicate_pack_selection_identity_is_rejected() {
    let first = test_pack_selection_v8(b"alpha".to_string(), @0xA1);
    let selections = vector[first];
    assert_unique_pack_selection(
        &selections,
        &b"scope".to_string(),
        &b"face".to_string(),
        &b"base".to_string(),
        &b"alpha".to_string(),
    );
}

#[test]
fun four_complete_modes_compute_exact_charge() {
    assert!(
        charge_for_policy(maker::complete_unlimited_free_v8(), 0, 0, 0, 9, 9) == 0,
        EAuthorizationMismatch,
    );
    assert!(
        charge_for_policy(maker::complete_free_quota_then_paid_v8(), 700, 2, 0, 0, 0) == 0,
        EAuthorizationMismatch,
    );
    assert!(
        charge_for_policy(maker::complete_free_quota_then_paid_v8(), 700, 2, 0, 2, 2) == 700,
        EAuthorizationMismatch,
    );
    assert!(
        charge_for_policy(maker::complete_paid_every_time_v8(), 900, 0, 0, 0, 0) == 900,
        EAuthorizationMismatch,
    );
}

#[test, expected_failure(abort_code = EWalletQuotaExceeded)]
fun free_quota_then_block_is_hard_per_wallet_cap() {
    charge_for_policy(maker::complete_free_quota_then_block_v8(), 0, 1, 0, 1, 1);
}

#[test, expected_failure(abort_code = ETotalCapExceeded)]
fun complete_total_cap_is_checked_before_route() {
    charge_for_policy(maker::complete_unlimited_free_v8(), 0, 0, 3, 0, 3);
}

#[test, expected_failure(abort_code = EAuthorizationMismatch)]
fun stale_complete_count_snapshot_is_rejected() {
    assert_exact_count_snapshot(0, 1, 0, 0);
}

#[test]
fun base_and_unique_pack_line_item_sum_exactly() {
    let empty = empty_required_pack_selection_commitment_v8(maker::test_digest(3));
    let mut authorization = test_authorization_v8(vector[], 0, empty);
    authorization.base_content_payment_atomic = 400;
    authorization.pack_completion_snapshots.push_back(PackCompletionSnapshotV8 {
        pack_scope_key: b"scope".to_string(),
        wallet_count: 1,
        total_count: 1,
        content_payment_atomic: 600,
    });
    assert!(contains_pack_snapshot(
        &authorization.pack_completion_snapshots,
        &b"scope".to_string(),
    ), EAuthorizationMismatch);
    seal_complete_authorization_v8(&mut authorization);
    assert!(authorization.required_content_payment_atomic == 1_000, EWrongPayer);
    destroy_test_authorization_v8(authorization);
}

#[test]
fun pack_policy_commitment_is_stable_without_release_object_id() {
    let root_content = maker::test_digest(3);
    let empty = empty_registry_commitment_v8(root_content);
    let first = advance_pack_policy_commitment_v8(
        root_content,
        0,
        empty,
        b"namespace\x00pack".to_string(),
        maker::test_digest(50),
        maker::complete_unlimited_free_v8(),
        0,
        0,
        0,
    );
    let second = advance_pack_policy_commitment_v8(
        root_content,
        0,
        empty,
        b"namespace\x00pack".to_string(),
        maker::test_digest(50),
        maker::complete_unlimited_free_v8(),
        0,
        0,
        0,
    );
    assert!(first == second, EInvalidCommitment);
}
