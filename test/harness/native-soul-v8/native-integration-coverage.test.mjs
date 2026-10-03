import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Original scenario names captured from the source-verified dEr3q0 graph before
// moving cross-package fixtures upstairs. This guards coverage inventory only;
// matching a name is never proof of equivalent assertions or actual VM success.
const baseline = {
  physical: [
    'exact_policy_term_matrix_is_fail_closed',
    'proof_policy_rejects_removed_receipt_only_mode',
    'paid_policy_rejects_zero_price',
    'free_policy_rejects_nonzero_price',
    'unknown_issuance_kind_is_rejected',
    'proof_policy_rejects_missing_proof',
    'supply_must_be_bounded_and_nonzero',
    'zero_policy_registry_seals_and_is_ready',
    'zero_policy_registry_rejects_nonempty_commitment',
    'readiness_rejects_unsealed_registry',
    'base_policy_is_derived_from_exact_live_style',
    'seal_rejects_missing_expected_row',
    'append_rejects_wrong_row_commitment',
    'append_rejects_out_of_order_sequence',
    'duplicate_base_style_policy_is_rejected',
    'readiness_rejects_nonzero_future_runtime_lane',
    'pack_policy_registers_from_live_witness_and_free_issues_exact_asset',
    'duplicate_pack_policy_registration_is_rejected',
    'pack_policy_registration_requires_exact_registry_revision',
    'revoked_pack_admission_blocks_new_issuance',
    'paused_pack_blocks_new_issuance',
    'archived_pack_blocks_new_issuance',
    'paused_root_blocks_new_issuance',
    'pack_control_epoch_change_does_not_invalidate_registered_content',
    'free_claim_replay_is_stable_across_loadout_revisions',
    'stale_runtime_selection_witness_is_rejected',
    'paid_base_purchase_splits_exact_protocol_and_maker_residual',
    'paid_pack_purchase_splits_exact_protocol_and_pack_residual',
    'soul_proof_issuance_records_exact_provenance_and_counter',
    'paid_purchase_rejects_wrong_exact_payment',
    'paid_purchase_rejects_another_roots_maker_treasury',
    'paid_pack_purchase_rejects_another_releases_pack_treasury',
    'physical_role_rejects_a_core_package_type_origin',
    'supply_cas_blocks_after_exact_max_without_reopening_consumed_supply',
    'physical_payment_share_rejects_nonzero_rounding_to_zero',
    'direct_transfer_remains_available_after_root_pause',
    'consume_remains_available_after_root_and_pack_archive',
    'nontransferable_asset_rejects_direct_transfer',
    'wrong_holder_cannot_direct_transfer',
    'direct_transfer_requires_exact_asset_ownership_epoch',
    'cross_transaction_base_market_return_preserves_exact_state',
    'cross_transaction_pack_market_purchase_changes_only_owner_state',
    'cross_transaction_wrong_listing_parent_cannot_receive_custodied_asset',
    'cross_transaction_wrong_receiving_asset_is_rejected',
    'cross_transaction_seller_cannot_purchase_own_custodied_asset',
    'market_return_authority_survives_pause_archive_and_protocol_drift',
    'market_custody_rejects_nontransferable_asset',
    'typed_base_custody_rejects_pack_source_substitution',
    'market_custody_binding_exact_matrix_accepts_live_asset',
    'market_custody_rejects_wrong_binding_version',
    'market_custody_rejects_wrong_asset_id',
    'market_custody_rejects_wrong_physical_registry',
    'market_custody_rejects_wrong_root_id',
    'market_custody_rejects_wrong_maker_version',
    'market_custody_rejects_wrong_root_content',
    'market_custody_rejects_wrong_source_kind',
    'market_custody_rejects_wrong_source_identity',
    'market_custody_rejects_wrong_source_content',
    'market_custody_rejects_wrong_source_treasury',
    'market_custody_rejects_wrong_stored_holder',
    'market_custody_rejects_wrong_ownership_epoch',
    'market_custody_rejects_wrong_transferable_readback',
    'market_custody_rejects_wrong_provenance',
  ],
  market: [
    'maker_child_custody_purchase_cancel_and_disabled_recovery_are_exact',
    'soul_bundle_listing_purchase_is_indivisible_and_exact',
    'soul_cancel_and_disabled_recovery_never_mutate_ownership',
    'base_physical_listing_purchase_preserves_provenance_and_exact_split',
    'pack_physical_listing_purchase_uses_exact_pack_treasury',
    'zero_market_state_seals_and_certifies_readiness',
    'maker_and_soul_quotes_use_frozen_fee_and_rights_terms',
    'any_pre_activation_listing_state_is_rejected',
    'cross_root_market_treasury_is_rejected',
    'zero_price_quote_is_rejected',
    'zero_purchase_payment_is_rejected',
    'underpayment_is_rejected',
    'overpayment_is_rejected',
    'nonzero_fee_cannot_round_to_zero',
    'readiness_rejects_unsealed_registry',
  ],
};

function scenarioNames(source) {
  // Move allows nested block comments. Mask both comments and string literals
  // before looking for attributes so dead text cannot satisfy the inventory.
  let code = '';
  let depth = 0;
  let lineComment = false;
  let string = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      code += char === '\n' ? '\n' : ' ';
    } else if (depth > 0) {
      if (char === '/' && next === '*') { depth++; i++; code += '  '; }
      else if (char === '*' && next === '/') { depth--; i++; code += '  '; }
      else code += char === '\n' ? '\n' : ' ';
    } else if (string) {
      if (char === '\\' && next !== undefined) { i++; code += '  '; }
      else {
        if (char === '"') string = false;
        code += char === '\n' ? '\n' : ' ';
      }
    } else if (char === '/' && next === '/') {
      lineComment = true; i++; code += '  ';
    } else if (char === '/' && next === '*') {
      depth = 1; i++; code += '  ';
    } else if (char === '"') {
      string = true; code += ' ';
    } else code += char;
  }
  return [...code.matchAll(/#\[test(?:\s*,[^\]]*)?\]\s*(?:#\[[^\]]*\]\s*)*fun\s+(\w+)\s*\(/g)]
    .map(match => match[1]);
}

test('inventory scanner does not count helpers or commented-out cases', () => {
  assert.deepEqual(scenarioNames(`
    // #[test] fun removed() {}
    /* #[test] fun also_removed() {} */
    #[test_only] fun helper() {}
    #[test, expected_failure(abort_code = 18, location = a::b)] fun negative() {}
    #[test]
    fun positive() {}
  `), ['negative', 'positive']);
});

test('inventory scanner excludes nested comments and escaped string literals', () => {
  assert.deepEqual(scenarioNames(String.raw`
    /* outer /* inner */ #[test] fun removed() {} */
    let text = b"#[test] fun string_only() {}";
    let escaped = b"quote: \" /* #[test] fun escaped_only() {} */";
    // #[test] fun line_only() {}
    #[test] fun real_case() {}
  `), ['real_case']);
});

for (const [kind, expected] of Object.entries(baseline)) {
  test(`${kind} original scenarios each exist once across local and upper modules`, async () => {
    const paths = [
      `../../../move/animacraft_v8_${kind}/sources/${kind}_v8.move`,
      `full/tests/${kind}_integration.move`,
    ];
    const sources = await Promise.all(paths.map(path => readFile(new URL(path, import.meta.url), 'utf8')));
    const actual = sources.flatMap(scenarioNames);
    for (const name of expected) {
      assert.equal(actual.filter(value => value === name).length, 1,
        `${kind} scenario omitted or duplicated: ${name}`);
    }
    assert.equal(new Set(actual).size, actual.length, `${kind} duplicate test name across modules`);
  });
}
