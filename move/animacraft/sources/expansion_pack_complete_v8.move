module animacraft::expansion_pack_complete_v8;

use animacraft::commerce_v5::{
    CommerceProtocolConfigV5,
    CommerceV5SoulMintAuthorization,
    MakerRootV5,
};
use animacraft::expansion_pack_v8::{Self as expansion, ExpansionPackReleaseV8};
use std::string::String;

const VERSION: u64 = 8;
const EBridgeDisabled: u64 = 17;

/// Exact immutable v8 Style identity included in one finished OC. It carries
/// both the independently published Pack release commitments and the exact
/// registered asset row; no manifest-only or client-only identity is trusted.
public struct ExpansionPackCompleteStyleSelectionV8 has copy, drop, store {
    release_id: ID,
    pack_id: String,
    namespace: String,
    pack_version: String,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    style_registry_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    asset_seal_id: vector<u8>,
}

/// Canonical BCS preimage for the staged Pack selection. The Base hash is the
/// exact hash later borrowed from CommerceV5SoulMintAuthorization; therefore
/// the proof cannot be moved to another Base recipe.
public struct ExpansionPackSelectionHashInputV8 has copy, drop, store {
    version: u64,
    parent_root_id: ID,
    payer: address,
    base_recipe_hash: vector<u8>,
    selections: vector<ExpansionPackCompleteStyleSelectionV8>,
}

/// Canonical BCS preimage for one exact Complete attempt. The Commerce output
/// Seal ID commits root, payer, recipe, nonce and rendered-output digest.
public struct ExpansionPackCompleteHashInputV8 has copy, drop, store {
    version: u64,
    commerce_config_id: ID,
    parent_root_id: ID,
    payer: address,
    base_recipe_hash: vector<u8>,
    complete_output_seal_id: vector<u8>,
    pack_selection_commitment: vector<u8>,
}

/// Non-copyable, non-storable and non-droppable staged authorization. Anyone
/// may assemble it from their live Pack entitlements, but it can leave the
/// transaction only through the exact Commerce-authentication path below.
public struct ExpansionPackCompleteAuthorizationV8 {
    version: u64,
    parent_root_id: ID,
    payer: address,
    base_recipe_hash: vector<u8>,
    selections: vector<ExpansionPackCompleteStyleSelectionV8>,
    pack_selection_commitment: vector<u8>,
    sealed: bool,
}

/// Non-droppable bridge produced only after an actual Commerce v5 Complete
/// authorization has authenticated the same root, payer and Base recipe. It
/// must be bound to a Soul with the governance-pinned private Soulidity proof.
public struct ExpansionPackCompleteSoulBindingV8 {
    version: u64,
    commerce_config_id: ID,
    parent_root_id: ID,
    payer: address,
    base_recipe_hash: vector<u8>,
    complete_output_seal_id: vector<u8>,
    pack_selection_commitment: vector<u8>,
    complete_authorization_commitment: vector<u8>,
    selections: vector<ExpansionPackCompleteStyleSelectionV8>,
}

/// Immutable, discoverable companion provenance bound to the canonical Soul.
/// It does not replace Soulidity provenance; a reviewed Soulidity upgrade must
/// persist this object's ID/commitment as part of its own canonical mint state.
public struct ExpansionPackCompleteProvenanceV8 has key {
    id: UID,
    version: u64,
    commerce_config_id: ID,
    parent_root_id: ID,
    soul_id: ID,
    payer: address,
    base_recipe_hash: vector<u8>,
    complete_output_seal_id: vector<u8>,
    pack_selection_commitment: vector<u8>,
    complete_authorization_commitment: vector<u8>,
    selections: vector<ExpansionPackCompleteStyleSelectionV8>,
}

public struct ExpansionPackCompleteAuthenticatedV8 has copy, drop {
    parent_root_id: ID,
    payer: address,
    complete_output_seal_id: vector<u8>,
    pack_selection_commitment: vector<u8>,
    complete_authorization_commitment: vector<u8>,
    selection_count: u64,
}

public struct ExpansionPackCompleteBoundToSoulV8 has copy, drop {
    provenance_id: ID,
    parent_root_id: ID,
    soul_id: ID,
    payer: address,
    complete_output_seal_id: vector<u8>,
    pack_selection_commitment: vector<u8>,
    complete_authorization_commitment: vector<u8>,
    selection_count: u64,
}

public fun companion_proof_version_v8(): u64 { VERSION }

/// The proof format is staged in this package, but no public proof may be
/// assembled until the reviewed Soulidity adapter can consume and persist it
/// atomically with canonical Soul minting. This must advance together with
/// `complete_bridge_enabled_v8()` after the cross-package upgrade is audited.
public fun companion_proof_available_v8(): bool { false }

public fun begin_expansion_pack_complete_authorization_v8(
    _parent_root: &MakerRootV5,
    _base_recipe_hash: vector<u8>,
    _ctx: &TxContext,
): ExpansionPackCompleteAuthorizationV8 {
    abort EBridgeDisabled
}

/// Appends one exact Style after the live v8 release, parent binding, Base
/// entitlement, Pack entitlement and asset record have all been verified.
public fun append_expansion_pack_complete_style_v8(
    _authorization: &mut ExpansionPackCompleteAuthorizationV8,
    _release: &ExpansionPackReleaseV8,
    _parent_root: &MakerRootV5,
    _part_key: String,
    _item_key: String,
    _style_key: String,
    _ctx: &TxContext,
) {
    abort EBridgeDisabled
}

public fun seal_expansion_pack_complete_authorization_v8(
    _authorization: &mut ExpansionPackCompleteAuthorizationV8,
) {
    abort EBridgeDisabled
}

/// Consumes the staged proof only after borrowing the exact, non-storable
/// Commerce authorization. The returned binding also has no abilities, so an
/// untrusted caller cannot extract the Base authorization and ignore Pack
/// provenance: the whole PTB remains unfinishable without Soulidity's proof.
public fun authenticate_expansion_pack_complete_v8(
    _authorization: ExpansionPackCompleteAuthorizationV8,
    _base_authorization: &CommerceV5SoulMintAuthorization,
    _parent_root: &MakerRootV5,
    _config: &CommerceProtocolConfigV5,
    _ctx: &TxContext,
): ExpansionPackCompleteSoulBindingV8 {
    abort EBridgeDisabled
}

/// Reviewed Soulidity adapter endpoint. The private-constructor proof type is
/// pinned in CommerceProtocolConfigV5. Returning the proof lets the adapter
/// reuse the same value for Commerce's Complete-output-to-Soul binding after
/// this companion provenance has been created.
public fun bind_expansion_pack_complete_to_soul_v8<Proof: drop>(
    _binding: ExpansionPackCompleteSoulBindingV8,
    _config: &CommerceProtocolConfigV5,
    _soul_id: ID,
    proof: Proof,
    _ctx: &mut TxContext,
): Proof {
    let _proof = proof;
    abort EBridgeDisabled
}

#[test_only]
public fun bind_expansion_pack_complete_to_soul_v8_for_testing<Proof: drop>(
    _binding: ExpansionPackCompleteSoulBindingV8,
    _config: &CommerceProtocolConfigV5,
    _soul_id: ID,
    _proof: Proof,
    _ctx: &mut TxContext,
): (ExpansionPackCompleteProvenanceV8, Proof) {
    abort EBridgeDisabled
}

public fun authorization_pack_selection_commitment_v8(
    authorization: &ExpansionPackCompleteAuthorizationV8,
): &vector<u8> {
    &authorization.pack_selection_commitment
}

public fun authorization_selection_count_v8(
    authorization: &ExpansionPackCompleteAuthorizationV8,
): u64 {
    authorization.selections.length()
}

// Complete provenance remains durable on-chain, but its public read adapter is
// intentionally deferred while Complete is disabled to retain Mainnet package
// size headroom. TypeOrigin and fail-closed gate readback remain mandatory.

#[test_only]
public fun destroy_provenance_v8_for_testing(
    provenance: ExpansionPackCompleteProvenanceV8,
) {
    let ExpansionPackCompleteProvenanceV8 {
        id,
        version: _,
        commerce_config_id: _,
        parent_root_id: _,
        soul_id: _,
        payer: _,
        base_recipe_hash: _,
        complete_output_seal_id: _,
        pack_selection_commitment: _,
        complete_authorization_commitment: _,
        selections: _,
    } = provenance;
    id.delete();
}

#[test]
fun complete_companion_is_staged_fail_closed() {
    assert!(!companion_proof_available_v8());
    assert!(!expansion::complete_bridge_enabled_v8());
}
