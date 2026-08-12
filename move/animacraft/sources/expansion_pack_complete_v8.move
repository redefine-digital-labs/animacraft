module animacraft::expansion_pack_complete_v8;

use animacraft::commerce_v5::{
    Self as commerce,
    CommerceProtocolConfigV5,
    CommerceV5SoulMintAuthorization,
    MakerRootV5,
};
use animacraft::expansion_pack_v8::{Self as expansion, ExpansionPackReleaseV8};
use std::bcs;
use std::hash;
use std::string::String;
use sui::event;

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;
const MAX_SELECTED_PACK_STYLES: u64 = 750;

const EInvalidCommitment: u64 = 0;
const EInvalidRoot: u64 = 1;
const EInvalidPayer: u64 = 2;
const EAuthorizationNotSealed: u64 = 3;
const ESelectionEmpty: u64 = 4;
const EDuplicateSelection: u64 = 5;
const ETooManySelections: u64 = 6;
const EInvalidSoul: u64 = 7;
const EBaseAuthorizationMismatch: u64 = 8;

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
    parent_root: &MakerRootV5,
    base_recipe_hash: vector<u8>,
    ctx: &TxContext,
): ExpansionPackCompleteAuthorizationV8 {
    expansion::assert_complete_bridge_enabled_v8();
    assert_hash(&base_recipe_hash);
    ExpansionPackCompleteAuthorizationV8 {
        version: VERSION,
        parent_root_id: commerce::root_id_v5(parent_root),
        payer: ctx.sender(),
        base_recipe_hash,
        selections: vector[],
        pack_selection_commitment: vector[],
        sealed: false,
    }
}

/// Appends one exact Style after the live v8 release, parent binding, Base
/// entitlement, Pack entitlement and asset record have all been verified.
public fun append_expansion_pack_complete_style_v8(
    authorization: &mut ExpansionPackCompleteAuthorizationV8,
    release: &ExpansionPackReleaseV8,
    parent_root: &MakerRootV5,
    part_key: String,
    item_key: String,
    style_key: String,
    ctx: &TxContext,
) {
    assert!(!authorization.sealed, EAuthorizationNotSealed);
    assert!(authorization.version == VERSION, EInvalidCommitment);
    assert!(authorization.parent_root_id == commerce::root_id_v5(parent_root), EInvalidRoot);
    assert!(authorization.payer == ctx.sender(), EInvalidPayer);
    assert!(authorization.selections.length() < MAX_SELECTED_PACK_STYLES, ETooManySelections);

    let access = expansion::verify_style_access_v8(
        release,
        parent_root,
        *&part_key,
        *&item_key,
        *&style_key,
        ctx,
    );
    let release_id = expansion::style_access_proof_release_id_v8(&access);
    assert!(release_id == expansion::release_id_v8(release), EInvalidRoot);
    assert!(
        expansion::style_access_proof_parent_root_id_v8(&access)
            == authorization.parent_root_id,
        EInvalidRoot,
    );
    assert!(
        expansion::style_access_proof_holder_v8(&access) == authorization.payer,
        EInvalidPayer,
    );
    assert!(
        !selection_exists(
            &authorization.selections,
            release_id,
            &part_key,
            &item_key,
            &style_key,
        ),
        EDuplicateSelection,
    );
    let manifest_sha256 = *expansion::release_manifest_sha256_v8(release);
    let content_commitment = *expansion::release_content_commitment_v8(release);
    let style_registry_commitment =
        *expansion::release_style_registry_commitment_v8(release);
    let asset_sha256 = *expansion::style_access_proof_sha256_v8(&access);
    assert_hash(&manifest_sha256);
    assert_hash(&content_commitment);
    assert_hash(&style_registry_commitment);
    assert_hash(&asset_sha256);
    let asset_seal_id = *expansion::style_access_proof_seal_id_v8(&access);
    assert!(
        asset_seal_id.length() == 0 || asset_seal_id.length() == HASH_LENGTH,
        EInvalidCommitment,
    );
    authorization.selections.push_back(ExpansionPackCompleteStyleSelectionV8 {
        release_id,
        pack_id: *expansion::release_pack_id_v8(release),
        namespace: *expansion::release_namespace_v8(release),
        pack_version: *expansion::release_pack_version_v8(release),
        manifest_blob_id: *expansion::release_manifest_blob_id_v8(release),
        manifest_sha256,
        content_commitment,
        style_registry_commitment,
        part_key,
        item_key,
        style_key,
        asset_blob_id: *expansion::style_access_proof_blob_id_v8(&access),
        asset_sha256,
        asset_seal_id,
    });
    let _access = access;
}

public fun seal_expansion_pack_complete_authorization_v8(
    authorization: &mut ExpansionPackCompleteAuthorizationV8,
) {
    assert!(!authorization.sealed, EAuthorizationNotSealed);
    assert!(authorization.selections.length() > 0, ESelectionEmpty);
    authorization.pack_selection_commitment = selection_commitment(
        authorization.version,
        authorization.parent_root_id,
        authorization.payer,
        &authorization.base_recipe_hash,
        &authorization.selections,
    );
    authorization.sealed = true;
}

/// Consumes the staged proof only after borrowing the exact, non-storable
/// Commerce authorization. The returned binding also has no abilities, so an
/// untrusted caller cannot extract the Base authorization and ignore Pack
/// provenance: the whole PTB remains unfinishable without Soulidity's proof.
public fun authenticate_expansion_pack_complete_v8(
    authorization: ExpansionPackCompleteAuthorizationV8,
    base_authorization: &CommerceV5SoulMintAuthorization,
    parent_root: &MakerRootV5,
    config: &CommerceProtocolConfigV5,
    ctx: &TxContext,
): ExpansionPackCompleteSoulBindingV8 {
    commerce::assert_extension_operational_v5(parent_root, config);
    let ExpansionPackCompleteAuthorizationV8 {
        version,
        parent_root_id,
        payer,
        base_recipe_hash,
        selections,
        pack_selection_commitment,
        sealed,
    } = authorization;
    assert!(version == VERSION && sealed, EAuthorizationNotSealed);
    assert!(parent_root_id == commerce::root_id_v5(parent_root), EInvalidRoot);
    assert!(
        commerce::complete_authorization_root_id_v5(base_authorization)
            == parent_root_id,
        EBaseAuthorizationMismatch,
    );
    assert!(payer == ctx.sender(), EInvalidPayer);
    assert!(
        commerce::complete_authorization_payer_v5(base_authorization) == payer,
        EBaseAuthorizationMismatch,
    );
    assert!(
        commerce::complete_authorization_recipe_hash_v5(base_authorization)
            == &base_recipe_hash,
        EBaseAuthorizationMismatch,
    );
    assert!(selections.length() > 0, ESelectionEmpty);
    assert!(
        pack_selection_commitment == selection_commitment(
            version,
            parent_root_id,
            payer,
            &base_recipe_hash,
            &selections,
        ),
        EInvalidCommitment,
    );
    let complete_output_seal_id =
        *commerce::complete_authorization_output_seal_id_v5(base_authorization);
    assert_hash(&complete_output_seal_id);
    let commerce_config_id = commerce::protocol_config_id_v5(config);
    let complete_authorization_commitment = complete_commitment(
        version,
        commerce_config_id,
        parent_root_id,
        payer,
        &base_recipe_hash,
        &complete_output_seal_id,
        &pack_selection_commitment,
    );
    event::emit(ExpansionPackCompleteAuthenticatedV8 {
        parent_root_id,
        payer,
        complete_output_seal_id,
        pack_selection_commitment,
        complete_authorization_commitment,
        selection_count: selections.length(),
    });
    ExpansionPackCompleteSoulBindingV8 {
        version,
        commerce_config_id,
        parent_root_id,
        payer,
        base_recipe_hash,
        complete_output_seal_id,
        pack_selection_commitment,
        complete_authorization_commitment,
        selections,
    }
}

/// Reviewed Soulidity adapter endpoint. The private-constructor proof type is
/// pinned in CommerceProtocolConfigV5. Returning the proof lets the adapter
/// reuse the same value for Commerce's Complete-output-to-Soul binding after
/// this companion provenance has been created.
public fun bind_expansion_pack_complete_to_soul_v8<Proof: drop>(
    binding: ExpansionPackCompleteSoulBindingV8,
    config: &CommerceProtocolConfigV5,
    soul_id: ID,
    proof: Proof,
    ctx: &mut TxContext,
): Proof {
    let (provenance, proof) = new_bound_provenance(
        binding,
        config,
        soul_id,
        proof,
        ctx,
    );
    transfer::share_object(provenance);
    proof
}

fun new_bound_provenance<Proof: drop>(
    binding: ExpansionPackCompleteSoulBindingV8,
    config: &CommerceProtocolConfigV5,
    soul_id: ID,
    proof: Proof,
    ctx: &mut TxContext,
): (ExpansionPackCompleteProvenanceV8, Proof) {
    commerce::assert_extension_soul_binding_proof_type_v5<Proof>(config);
    let ExpansionPackCompleteSoulBindingV8 {
        version,
        commerce_config_id,
        parent_root_id,
        payer,
        base_recipe_hash,
        complete_output_seal_id,
        pack_selection_commitment,
        complete_authorization_commitment,
        selections,
    } = binding;
    assert!(version == VERSION, EInvalidCommitment);
    assert!(commerce_config_id == commerce::protocol_config_id_v5(config), EInvalidRoot);
    assert!(payer == ctx.sender(), EInvalidPayer);
    assert!(soul_id.to_address() != @0x0, EInvalidSoul);
    assert_hash(&base_recipe_hash);
    assert_hash(&complete_output_seal_id);
    assert_hash(&pack_selection_commitment);
    assert!(selections.length() > 0, ESelectionEmpty);
    assert!(
        complete_authorization_commitment == complete_commitment(
            version,
            commerce_config_id,
            parent_root_id,
            payer,
            &base_recipe_hash,
            &complete_output_seal_id,
            &pack_selection_commitment,
        ),
        EInvalidCommitment,
    );
    let provenance = ExpansionPackCompleteProvenanceV8 {
        id: object::new(ctx),
        version,
        commerce_config_id,
        parent_root_id,
        soul_id,
        payer,
        base_recipe_hash,
        complete_output_seal_id,
        pack_selection_commitment,
        complete_authorization_commitment,
        selections,
    };
    event::emit(ExpansionPackCompleteBoundToSoulV8 {
        provenance_id: object::id(&provenance),
        parent_root_id,
        soul_id,
        payer,
        complete_output_seal_id,
        pack_selection_commitment,
        complete_authorization_commitment,
        selection_count: provenance.selections.length(),
    });
    (provenance, proof)
}

#[test_only]
public fun bind_expansion_pack_complete_to_soul_v8_for_testing<Proof: drop>(
    binding: ExpansionPackCompleteSoulBindingV8,
    config: &CommerceProtocolConfigV5,
    soul_id: ID,
    proof: Proof,
    ctx: &mut TxContext,
): (ExpansionPackCompleteProvenanceV8, Proof) {
    new_bound_provenance(binding, config, soul_id, proof, ctx)
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

public fun provenance_id_v8(self: &ExpansionPackCompleteProvenanceV8): ID {
    object::id(self)
}

public fun provenance_soul_id_v8(self: &ExpansionPackCompleteProvenanceV8): ID {
    self.soul_id
}

public fun provenance_parent_root_id_v8(
    self: &ExpansionPackCompleteProvenanceV8,
): ID {
    self.parent_root_id
}

public fun provenance_payer_v8(self: &ExpansionPackCompleteProvenanceV8): address {
    self.payer
}

public fun provenance_base_recipe_hash_v8(
    self: &ExpansionPackCompleteProvenanceV8,
): &vector<u8> {
    &self.base_recipe_hash
}

public fun provenance_output_seal_id_v8(
    self: &ExpansionPackCompleteProvenanceV8,
): &vector<u8> {
    &self.complete_output_seal_id
}

public fun provenance_pack_selection_commitment_v8(
    self: &ExpansionPackCompleteProvenanceV8,
): &vector<u8> {
    &self.pack_selection_commitment
}

public fun provenance_complete_authorization_commitment_v8(
    self: &ExpansionPackCompleteProvenanceV8,
): &vector<u8> {
    &self.complete_authorization_commitment
}

public fun provenance_selection_count_v8(
    self: &ExpansionPackCompleteProvenanceV8,
): u64 {
    self.selections.length()
}

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

fun selection_commitment(
    version: u64,
    parent_root_id: ID,
    payer: address,
    base_recipe_hash: &vector<u8>,
    selections: &vector<ExpansionPackCompleteStyleSelectionV8>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&ExpansionPackSelectionHashInputV8 {
        version,
        parent_root_id,
        payer,
        base_recipe_hash: *base_recipe_hash,
        selections: *selections,
    }))
}

fun complete_commitment(
    version: u64,
    commerce_config_id: ID,
    parent_root_id: ID,
    payer: address,
    base_recipe_hash: &vector<u8>,
    complete_output_seal_id: &vector<u8>,
    pack_selection_commitment: &vector<u8>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&ExpansionPackCompleteHashInputV8 {
        version,
        commerce_config_id,
        parent_root_id,
        payer,
        base_recipe_hash: *base_recipe_hash,
        complete_output_seal_id: *complete_output_seal_id,
        pack_selection_commitment: *pack_selection_commitment,
    }))
}

fun selection_exists(
    selections: &vector<ExpansionPackCompleteStyleSelectionV8>,
    release_id: ID,
    part_key: &String,
    item_key: &String,
    style_key: &String,
): bool {
    let mut index = 0;
    while (index < selections.length()) {
        let selection = &selections[index];
        if (
            selection.release_id == release_id
                && &selection.part_key == part_key
                && &selection.item_key == item_key
                && &selection.style_key == style_key
        ) return true;
        index = index + 1;
    };
    false
}

fun assert_hash(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
}

#[test]
fun complete_companion_is_staged_fail_closed() {
    assert!(!companion_proof_available_v8());
    assert!(!expansion::complete_bridge_enabled_v8());
}
