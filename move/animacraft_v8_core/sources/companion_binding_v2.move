/// One-transaction, exact-package companion identity assembly.
/// Maker owns live Root checks at begin and finish; this module intentionally
/// does not import Maker, so its immutable ID type can be nested in Root.
module animacraft_v8_core::companion_binding_v2;

use animacraft_v8_core::package_binding_v8::{
    Self as binding, ProductReleaseCatalogV8, FreshTupleReplacementBindingV2,
};
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;

const EStage: u64 = 0;
const EFacts: u64 = 1;
const EAlias: u64 = 2;

public struct MakerRuntimeCompanionRegistryIdsV2 has copy, drop, store {
    runtime_definition_registry_id: ID,
    pack_registry_id: ID,
    admission_authority_id: ID,
    seal_registry_id: ID,
    output_registry_id: ID,
    soul_registry_id: ID,
    physical_registry_id: ID,
    market_registry_id: ID,
}

public struct MakerCompanionBindingFactsV2 has copy, drop {
    catalog_id: ID,
    replacement_id: ID,
    package_tuple_commitment: vector<u8>,
    root_id: ID,
    maker_version: u64,
    root_control_epoch: u64,
    root_content_commitment: vector<u8>,
    maker_admin_id: ID,
    base_registry_id: ID,
    base_definition_commitment: vector<u8>,
    maker_treasury_id: ID,
    maker_signer: address,
}

/// No abilities: every stage must feed the next stage within this transaction.
public struct MakerRuntimeCompanionBindingBuilderV2<phantom PaymentCoin> {
    facts: MakerCompanionBindingFactsV2,
    ids: vector<ID>,
    next_role: u8,
}

/// Caller in Core must derive every argument from its live authenticated Root,
/// admin, Base registry and living-content certificate, never from PTB IDs.
public(package) fun new_builder_v2<PaymentCoin>(
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    root_id: ID,
    maker_version: u64,
    root_control_epoch: u64,
    root_content_commitment: vector<u8>,
    maker_admin_id: ID,
    base_registry_id: ID,
    base_definition_commitment: vector<u8>,
    maker_treasury_id: ID,
    ctx: &TxContext,
): MakerRuntimeCompanionBindingBuilderV2<PaymentCoin> {
    binding::assert_catalog_current_v8(protocol_config, catalog);
    binding::assert_replacement_current_v2(replacement, catalog);
    assert!(root_content_commitment.length() == 32
        && base_definition_commitment.length() == 32, EFacts);
    MakerRuntimeCompanionBindingBuilderV2 {
        facts: MakerCompanionBindingFactsV2 {
            catalog_id: object::id(catalog),
            replacement_id: object::id(replacement),
            package_tuple_commitment:
                *binding::product_binding_commitment_v8(binding::catalog_binding_v8(catalog)),
            root_id, maker_version, root_control_epoch, root_content_commitment,
            maker_admin_id, base_registry_id, base_definition_commitment,
            maker_treasury_id, maker_signer: ctx.sender(),
        },
        ids: vector[], next_role: 0,
    }
}

public fun builder_facts_v2<PaymentCoin>(
    builder: &MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
): &MakerCompanionBindingFactsV2 { &builder.facts }

public fun assert_facts_v2(
    facts: &MakerCompanionBindingFactsV2,
    root_id: ID,
    maker_version: u64,
    root_control_epoch: u64,
    root_content_commitment: &vector<u8>,
    maker_admin_id: ID,
    base_registry_id: ID,
    base_definition_commitment: &vector<u8>,
    maker_treasury_id: ID,
    ctx: &TxContext,
) {
    assert!(facts.root_id == root_id && facts.maker_version == maker_version
        && facts.root_control_epoch == root_control_epoch
        && &facts.root_content_commitment == root_content_commitment
        && facts.maker_admin_id == maker_admin_id
        && facts.base_registry_id == base_registry_id
        && &facts.base_definition_commitment == base_definition_commitment
        && facts.maker_treasury_id == maker_treasury_id
        && facts.maker_signer == ctx.sender(), EFacts);
}

fun assert_live(
    facts: &MakerCompanionBindingFactsV2,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    ctx: &TxContext,
) {
    binding::assert_catalog_current_v8(protocol_config, catalog);
    binding::assert_replacement_current_v2(replacement, catalog);
    assert!(facts.catalog_id == object::id(catalog)
        && facts.replacement_id == object::id(replacement)
        && &facts.package_tuple_commitment
            == binding::product_binding_commitment_v8(binding::catalog_binding_v8(catalog))
        && facts.maker_signer == ctx.sender(), EFacts);
}

fun assert_stage<PaymentCoin>(
    builder: &MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    stage: u8,
) {
    assert!(builder.next_role == stage, EStage);
    let expected_count = if (stage == 0) 0
        else if (stage == 1) 3
        else if (stage == 2) 4
        else if (stage == 3) 6
        else if (stage == 4) 7
        else if (stage == 5) 8
        else abort EStage;
    assert!(builder.ids.length() == expected_count, EStage);
}

fun append_id<PaymentCoin>(
    builder: &mut MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    id: ID,
) {
    let facts = &builder.facts;
    assert!(id != facts.root_id && id != facts.maker_admin_id
        && id != facts.base_registry_id && id != facts.maker_treasury_id
        && id != facts.catalog_id && id != facts.replacement_id
        && id != object::id_from_address(@0x0), EAlias);
    assert!(!builder.ids.contains(&id), EAlias);
    builder.ids.push_back(id);
}

/// Only the exact current runtime package can supply this stage's IDs.
public fun append_runtime_v2<PaymentCoin, Witness: drop>(
    mut builder: MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    witness: Witness,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    runtime_definition_registry_id: ID,
    pack_registry_id: ID,
    admission_authority_id: ID,
    ctx: &TxContext,
): MakerRuntimeCompanionBindingBuilderV2<PaymentCoin> {
    assert_live(&builder.facts, protocol_config, catalog, replacement, ctx);
    assert_stage(&builder, 0);
    binding::assert_exact_witness_type_v2<Witness>(
        binding::binding_at_v2(binding::catalog_binding_v8(catalog), 2),
        &b"runtime_v8", &b"MakerCompanionBindingWitnessV2");
    let _ = witness;
    append_id(&mut builder, runtime_definition_registry_id);
    append_id(&mut builder, pack_registry_id);
    append_id(&mut builder, admission_authority_id);
    builder.next_role = 1;
    builder
}

/// Only the exact current seal package can supply this stage's IDs.
public fun append_seal_v2<PaymentCoin, Witness: drop>(
    mut builder: MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    witness: Witness,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    seal_registry_id: ID,
    ctx: &TxContext,
): MakerRuntimeCompanionBindingBuilderV2<PaymentCoin> {
    assert_live(&builder.facts, protocol_config, catalog, replacement, ctx);
    assert_stage(&builder, 1);
    binding::assert_exact_witness_type_v2<Witness>(
        binding::binding_at_v2(binding::catalog_binding_v8(catalog), 1),
        &b"seal_v8", &b"MakerCompanionBindingWitnessV2");
    let _ = witness;
    append_id(&mut builder, seal_registry_id);
    builder.next_role = 2;
    builder
}

/// Only the exact current output package can supply this stage's IDs.
public fun append_output_v2<PaymentCoin, Witness: drop>(
    mut builder: MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    witness: Witness,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    output_registry_id: ID,
    soul_registry_id: ID,
    ctx: &TxContext,
): MakerRuntimeCompanionBindingBuilderV2<PaymentCoin> {
    assert_live(&builder.facts, protocol_config, catalog, replacement, ctx);
    assert_stage(&builder, 2);
    binding::assert_exact_witness_type_v2<Witness>(
        binding::binding_at_v2(binding::catalog_binding_v8(catalog), 3),
        &b"output_v8", &b"MakerCompanionBindingWitnessV2");
    let _ = witness;
    append_id(&mut builder, output_registry_id);
    append_id(&mut builder, soul_registry_id);
    builder.next_role = 3;
    builder
}

/// Only the exact current physical package can supply this stage's IDs.
public fun append_physical_v2<PaymentCoin, Witness: drop>(
    mut builder: MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    witness: Witness,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    physical_registry_id: ID,
    ctx: &TxContext,
): MakerRuntimeCompanionBindingBuilderV2<PaymentCoin> {
    assert_live(&builder.facts, protocol_config, catalog, replacement, ctx);
    assert_stage(&builder, 3);
    binding::assert_exact_witness_type_v2<Witness>(
        binding::binding_at_v2(binding::catalog_binding_v8(catalog), 4),
        &b"physical_v8", &b"MakerCompanionBindingWitnessV2");
    let _ = witness;
    append_id(&mut builder, physical_registry_id);
    builder.next_role = 4;
    builder
}

/// Only the exact current market package can supply this stage's IDs.
public fun append_market_v2<PaymentCoin, Witness: drop>(
    mut builder: MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    witness: Witness,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_registry_id: ID,
    ctx: &TxContext,
): MakerRuntimeCompanionBindingBuilderV2<PaymentCoin> {
    assert_live(&builder.facts, protocol_config, catalog, replacement, ctx);
    assert_stage(&builder, 4);
    binding::assert_exact_witness_type_v2<Witness>(
        binding::binding_at_v2(binding::catalog_binding_v8(catalog), 5),
        &b"market_v8", &b"MakerCompanionBindingWitnessV2");
    let _ = witness;
    append_id(&mut builder, market_registry_id);
    builder.next_role = 5;
    builder
}

/// Only Core can finish; Maker must then recheck facts and fill its empty slot.
public(package) fun finish_v2<PaymentCoin>(
    builder: MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    ctx: &TxContext,
): (MakerCompanionBindingFactsV2, MakerRuntimeCompanionRegistryIdsV2) {
    assert_live(&builder.facts, protocol_config, catalog, replacement, ctx);
    finish(builder)
}

fun finish<PaymentCoin>(
    builder: MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
): (MakerCompanionBindingFactsV2, MakerRuntimeCompanionRegistryIdsV2) {
    assert_stage(&builder, 5);
    let MakerRuntimeCompanionBindingBuilderV2 { facts, ids, next_role: _ } = builder;
    (facts, MakerRuntimeCompanionRegistryIdsV2 {
        runtime_definition_registry_id: ids[0], pack_registry_id: ids[1],
        admission_authority_id: ids[2], seal_registry_id: ids[3],
        output_registry_id: ids[4], soul_registry_id: ids[5],
        physical_registry_id: ids[6], market_registry_id: ids[7],
    })
}

public fun ids_v2(ids: &MakerRuntimeCompanionRegistryIdsV2): (ID, ID, ID, ID, ID, ID, ID, ID) {
    (ids.runtime_definition_registry_id, ids.pack_registry_id,
        ids.admission_authority_id, ids.seal_registry_id,
        ids.output_registry_id, ids.soul_registry_id,
        ids.physical_registry_id, ids.market_registry_id)
}

public fun runtime_definition_registry_id_v2(ids: &MakerRuntimeCompanionRegistryIdsV2): ID { ids.runtime_definition_registry_id }

public fun pack_registry_id_v2(ids: &MakerRuntimeCompanionRegistryIdsV2): ID { ids.pack_registry_id }

public fun admission_authority_id_v2(ids: &MakerRuntimeCompanionRegistryIdsV2): ID { ids.admission_authority_id }

public fun seal_registry_id_v2(ids: &MakerRuntimeCompanionRegistryIdsV2): ID { ids.seal_registry_id }

public fun output_registry_id_v2(ids: &MakerRuntimeCompanionRegistryIdsV2): ID { ids.output_registry_id }

public fun soul_registry_id_v2(ids: &MakerRuntimeCompanionRegistryIdsV2): ID { ids.soul_registry_id }

public fun physical_registry_id_v2(ids: &MakerRuntimeCompanionRegistryIdsV2): ID { ids.physical_registry_id }

public fun market_registry_id_v2(ids: &MakerRuntimeCompanionRegistryIdsV2): ID { ids.market_registry_id }

#[test_only]
fun test_builder(): MakerRuntimeCompanionBindingBuilderV2<u64> {
    MakerRuntimeCompanionBindingBuilderV2 {
        facts: MakerCompanionBindingFactsV2 {
            catalog_id: object::id_from_address(@0x1),
            replacement_id: object::id_from_address(@0x2),
            package_tuple_commitment: vector[1],
            root_id: object::id_from_address(@0x3),
            maker_version: 1, root_control_epoch: 0,
            root_content_commitment: vector[2],
            maker_admin_id: object::id_from_address(@0x4),
            base_registry_id: object::id_from_address(@0x5),
            base_definition_commitment: vector[3],
            maker_treasury_id: object::id_from_address(@0x6),
            maker_signer: @0xA,
        },
        ids: vector[], next_role: 0,
    }
}

#[test_only]
public fun new_registry_ids_for_testing(ids: vector<ID>): MakerRuntimeCompanionRegistryIdsV2 {
    assert!(ids.length() == 8, EStage);
    let mut index = 0u64;
    while (index < ids.length()) {
        assert!(ids[index] != object::id_from_address(@0x0), EAlias);
        let mut previous = 0u64;
        while (previous < index) {
            assert!(ids[previous] != ids[index], EAlias);
            previous = previous + 1;
        };
        index = index + 1;
    };
    MakerRuntimeCompanionRegistryIdsV2 {
        runtime_definition_registry_id: ids[0], pack_registry_id: ids[1],
        admission_authority_id: ids[2], seal_registry_id: ids[3],
        output_registry_id: ids[4], soul_registry_id: ids[5],
        physical_registry_id: ids[6], market_registry_id: ids[7],
    }
}

#[test_only]
fun destroy_test_builder(builder: MakerRuntimeCompanionBindingBuilderV2<u64>) {
    let MakerRuntimeCompanionBindingBuilderV2 { facts: _, ids: _, next_role: _ } = builder;
}

#[test]
fun companion_stage_counts_and_exact_id_order() {
    let mut builder = test_builder();
    assert_stage(&builder, 0);
    append_id(&mut builder, object::id_from_address(@0x10));
    append_id(&mut builder, object::id_from_address(@0x11));
    append_id(&mut builder, object::id_from_address(@0x12));
    builder.next_role = 1;
    assert_stage(&builder, 1);
    append_id(&mut builder, object::id_from_address(@0x13));
    builder.next_role = 2;
    assert_stage(&builder, 2);
    append_id(&mut builder, object::id_from_address(@0x14));
    append_id(&mut builder, object::id_from_address(@0x15));
    builder.next_role = 3;
    assert_stage(&builder, 3);
    append_id(&mut builder, object::id_from_address(@0x16));
    builder.next_role = 4;
    assert_stage(&builder, 4);
    append_id(&mut builder, object::id_from_address(@0x17));
    builder.next_role = 5;
    let (_, ids) = finish(builder);
    let (runtime, pack, admission, seal, output, soul, physical, market) = ids_v2(&ids);
    assert!(runtime == object::id_from_address(@0x10)
        && pack == object::id_from_address(@0x11)
        && admission == object::id_from_address(@0x12)
        && seal == object::id_from_address(@0x13)
        && output == object::id_from_address(@0x14)
        && soul == object::id_from_address(@0x15)
        && physical == object::id_from_address(@0x16)
        && market == object::id_from_address(@0x17), EFacts);
}

#[test, expected_failure(abort_code = EStage)]
fun companion_cannot_skip_stage() {
    let builder = test_builder();
    assert_stage(&builder, 1);
    destroy_test_builder(builder);
}

#[test, expected_failure(abort_code = EStage)]
fun companion_cannot_finish_incomplete() {
    let (_, _) = finish(test_builder());
}

#[test, expected_failure(abort_code = EAlias)]
fun companion_cannot_repeat_id() {
    let mut builder = test_builder();
    append_id(&mut builder, object::id_from_address(@0x10));
    append_id(&mut builder, object::id_from_address(@0x10));
    destroy_test_builder(builder);
}

#[test, expected_failure(abort_code = EAlias)]
fun companion_cannot_alias_root() {
    let mut builder = test_builder();
    append_id(&mut builder, object::id_from_address(@0x3));
    destroy_test_builder(builder);
}

#[test, expected_failure(abort_code = EAlias)]
fun companion_cannot_alias_admin() {
    let mut builder = test_builder();
    append_id(&mut builder, object::id_from_address(@0x4));
    destroy_test_builder(builder);
}

#[test, expected_failure(abort_code = EAlias)]
fun companion_cannot_alias_base() {
    let mut builder = test_builder();
    append_id(&mut builder, object::id_from_address(@0x5));
    destroy_test_builder(builder);
}

#[test, expected_failure(abort_code = EAlias)]
fun companion_cannot_alias_treasury() {
    let mut builder = test_builder();
    append_id(&mut builder, object::id_from_address(@0x6));
    destroy_test_builder(builder);
}

#[test, expected_failure(abort_code = EAlias)]
fun companion_cannot_alias_catalog() {
    let mut builder = test_builder();
    append_id(&mut builder, object::id_from_address(@0x1));
    destroy_test_builder(builder);
}

#[test, expected_failure(abort_code = EAlias)]
fun companion_cannot_alias_replacement() {
    let mut builder = test_builder();
    append_id(&mut builder, object::id_from_address(@0x2));
    destroy_test_builder(builder);
}

#[test, expected_failure(abort_code = EAlias)]
fun companion_cannot_alias_zero() {
    let mut builder = test_builder();
    append_id(&mut builder, object::id_from_address(@0x0));
    destroy_test_builder(builder);
}

#[test_only]
fun assert_test_facts(builder: &MakerRuntimeCompanionBindingBuilderV2<u64>, epoch: u64, sender: address) {
    let ctx = sui::tx_context::new_from_hint(sender, 1, 0, 0, 0);
    assert_facts_v2(builder_facts_v2(builder), object::id_from_address(@0x3), 1, epoch,
        &vector[2], object::id_from_address(@0x4), object::id_from_address(@0x5),
        &vector[3], object::id_from_address(@0x6), &ctx);
}

#[test]
fun companion_facts_accept_exact_control_and_signer() {
    let builder = test_builder();
    assert_test_facts(&builder, 0, @0xA);
    destroy_test_builder(builder);
}

#[test, expected_failure(abort_code = EFacts)]
fun companion_facts_reject_control_rotation() {
    let builder = test_builder();
    assert_test_facts(&builder, 1, @0xA);
    destroy_test_builder(builder);
}

#[test, expected_failure(abort_code = EFacts)]
fun companion_facts_reject_other_signer() {
    let builder = test_builder();
    assert_test_facts(&builder, 0, @0xB);
    destroy_test_builder(builder);
}

#[test, expected_failure(abort_code = EFacts)]
fun companion_facts_reject_other_root_even_with_same_signer_and_content() {
    let builder = test_builder();
    let ctx = sui::tx_context::new_from_hint(@0xA, 1, 0, 0, 0);
    assert_facts_v2(builder_facts_v2(&builder), object::id_from_address(@0x99), 1, 0,
        &vector[2], object::id_from_address(@0x4), object::id_from_address(@0x5),
        &vector[3], object::id_from_address(@0x6), &ctx);
    destroy_test_builder(builder);
}
