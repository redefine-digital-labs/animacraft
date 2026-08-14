# Animacraft v8 publication ABI

This is the compiler-facing ABI for the fresh `animacraft_v8` package. All
`String` values are `std::string::String`, all commitments are 32-byte
SHA-256 values unless explicitly empty, and `sequence` is the exact next
global row index for that registry. The package exposes pure `empty_*` and
`advance_*` helpers for byte-for-byte commitment parity.

## Begin

```move
publication_v8::begin_maker_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    maker_key: String,
    maker_version: String,
    previous_root_id: Option<ID>,
    previous_version_commitment: Option<vector<u8>>,
    renderer_commitment: vector<u8>,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    expected_counts: RowCountsV8,
    expected_registry_commitments: RegistryCommitmentsV8,
    expected_capability_commitments: CapabilityCommitmentsV8,
    expected_composition_item_count: u64,
    expected_composition_rule_count: u64,
    expected_complete_output_count: u64,
    expected_physical_policy_count: u64,
    declared_capabilities: u64,
    economics: EconomicsV8,
    rights: RightsV8,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

The call shares exactly one Root, Maker treasury, Composition registry, Pack
registry, Complete registry, Seal registry, Soul registry, and—when declared—
Physical registry, and transfers exactly one Maker AdminCap. The Complete
registry's expected Pack-policy count is the `RowCountsV8.pack_releases`
value. The Soul commitment is mandatory. Physical count and commitment must
both be present or both absent.

Compiler constructors are:

```move
maker_v8::new_row_counts_v8(
    tracks, parts, items, styles, colors, rules, slots, pack_releases,
    protected_assets,
): RowCountsV8
maker_v8::new_registry_commitments_v8(
    tracks, parts, items, styles, colors, rules, aggregate,
): RegistryCommitmentsV8
maker_v8::new_capability_commitments_v8(
    composition, pack, complete, seal, soul, physical,
): CapabilityCommitmentsV8
maker_v8::new_economics_v8(
    maker_access, maker_price_atomic, complete_mode, complete_price_atomic,
    complete_per_wallet_quota, complete_total_cap, protocol_fee_bps,
): EconomicsV8
maker_v8::new_rights_v8(
    origin, creator_confirmed, soul_creator_royalty_bps,
    maker_source_royalty_bps, maker_resale_royalty_bps,
): RightsV8
```

## Root rows

Rows are appended in category order Track, Part, Item, Style, Color, Rule.
Each call uses the next global Root sequence.

```move
maker_v8::append_track_v8<PaymentCoin>(
    root, admin, sequence, key, label, render_order, payload_commitment,
)
maker_v8::append_part_v8<PaymentCoin>(
    root, admin, sequence, key, label, kind, render_order, required, visible,
    payload_commitment,
)
maker_v8::append_item_v8<PaymentCoin>(
    root, admin, sequence, part_key, item_key, label, gate_kind,
    payload_commitment,
)
maker_v8::append_style_v8<PaymentCoin>(
    root, admin, sequence, part_key, item_key, style_key, layer_track_key,
    color_channel_key: Option<String>, default_swatch_key: Option<String>,
    label, asset_blob_id, asset_sha256, protected, payload_commitment,
)
maker_v8::append_color_v8<PaymentCoin>(
    root, admin, sequence, channel_key, swatch_key, label, rgba,
    payload_commitment,
)
maker_v8::append_rule_v8<PaymentCoin>(
    root, admin, sequence, key, kind, left_ref, right_ref,
    payload_commitment,
)
```

Track has no `required`; Part has no Track parent. Style always names an
existing Track. Its Color channel and default swatch are an all-or-none pair,
and activation proves the named Color row exists.

## Companion rows and seals

The Composition ABI is:

```move
composition_v8::append_wardrobe_slot_v8<PaymentCoin>(
    registry, root, admin, sequence, slot_key, behavior, capacity, required,
    slot_commitment,
)
composition_v8::append_composition_item_v8<PaymentCoin>(
    registry, root, admin, sequence, slot_key, item_key, source_kind,
    transferable, definition_commitment, asset_commitment,
)
composition_v8::append_loadout_rule_v8<PaymentCoin>(
    registry, root, admin, sequence, rule_kind, left_slot_key, left_item_key,
    right_slot_key, right_item_key, rule_commitment,
)
composition_v8::seal_composition_registry_v8<PaymentCoin>(
    registry, root, admin,
)
```

The Seal ABI is:

```move
seal_v8::append_protected_asset_v8<PaymentCoin>(
    registry, root, admin, sequence, scope_kind, scope_key,
    scope_commitment, asset_key, asset_commitment,
): vector<u8>
seal_v8::seal_registry_v8<PaymentCoin>(registry, root, admin)
```

The returned value is the derived Seal ID. Protected Pack, Complete, and
Physical rows consume exact Seal coverage, so the needed Seal rows are staged
first. The Seal registry itself remains unsealed until all coverage is added.

The Pack ABI is:

```move
expansion_pack_v8::create_expansion_pack_release_v8<PaymentCoin>(
    root, maker_admin, seal_registry, namespace, pack_key, manifest_blob_id,
    manifest_commitment, content_commitment, access_kind,
    purchase_price_atomic, complete_mode, complete_price_atomic,
    complete_free_quota_per_wallet, complete_total_cap,
    expected_style_count, expected_protected_style_count,
    expected_style_registry_commitment, ctx,
)
expansion_pack_v8::append_expansion_pack_style_v8<PaymentCoin>(
    release, root, maker_admin, pack_admin, seal_registry, sequence, part_key,
    item_key, style_key, asset_blob_id, asset_commitment, protected, seal_id,
    ctx,
)
expansion_pack_v8::seal_expansion_pack_release_v8<PaymentCoin>(
    release, root, maker_admin, pack_admin, seal_registry, ctx,
)
expansion_pack_v8::append_release_to_registry_v8<PaymentCoin>(
    registry, release, root, maker_admin, sequence,
)
expansion_pack_v8::seal_expansion_pack_registry_v8<PaymentCoin>(
    registry, root, maker_admin,
)
```

The Complete ABI is:

```move
complete_v8::append_complete_output_v8<PaymentCoin>(
    registry, root, admin, seal_registry, sequence, output_key,
    recipe_policy_commitment, renderer_schema_commitment, protected, seal_id,
    required_pack_selection_count, required_pack_selection_commitment,
)
complete_v8::append_complete_pack_policy_v8<PaymentCoin>(
    registry, pack_registry, release, root, admin, sequence,
)
complete_v8::seal_complete_registry_v8<PaymentCoin>(registry, root, admin)
```

All Complete output rows precede Pack-policy rows. There is exactly one
Pack-policy row per registered Pack release, copied and cross-checked from the
release's native policy.

The optional Physical ABI is:

```move
physical_v8::append_maker_style_policy_v8<PaymentCoin>(
    registry, root, admin, sequence, part_key, item_key, style_key,
    style_content_commitment, material_commitment, max_supply, transferable,
)
physical_v8::append_pack_style_policy_v8<PaymentCoin>(
    registry, pack_registry, root, admin, release, sequence, part_key,
    item_key, style_key, style_content_commitment, material_commitment,
    max_supply, transferable,
)
physical_v8::seal_physical_registry_v8<PaymentCoin>(registry, root, admin)
```

A Pack-backed Physical policy is accepted only after the exact release is in
this Root's Pack registry. The Pack registry need not yet be sealed.

## Activation

After every declared registry is sealed, call exactly one overload:

```move
publication_v8::seal_and_activate_maker_v8<PaymentCoin>(
    root, admin, treasury, config, composition_registry, pack_registry,
    complete_registry, seal_registry, soul_registry, clock, ctx,
)
publication_v8::seal_and_activate_physical_maker_v8<PaymentCoin>(
    root, admin, treasury, config, composition_registry, pack_registry,
    complete_registry, seal_registry, soul_registry, physical_registry,
    clock, ctx,
)
```

Only these routes can assemble the package-private activation tuple. They
verify exact counts, every commitment and registry ID, protocol snapshot,
PaymentCoin, protected coverage, required capabilities, and the concrete
Physical TypeOrigin before the sole `MakerV8Activated` event is emitted.

## Runtime Complete and Soul

```move
complete_v8::begin_complete_v8<PaymentCoin>(
    complete_registry, composition_registry, loadout, root, output_key, ctx,
): CompleteAuthorizationV8
complete_v8::append_pack_style_to_complete_v8(
    authorization, complete_registry, pack_style_access_proof,
)
complete_v8::seal_complete_authorization_v8(
    authorization,
): vector<u8>
complete_v8::complete_without_payment_v8<PaymentCoin>(
    complete_registry, root, config, authorization, clock, ctx,
): SoulMintAuthorizationV8
complete_v8::complete_with_payment_v8<PaymentCoin>(
    complete_registry, root, maker_treasury, config, protocol_treasury,
    payment, authorization, clock, ctx,
): SoulMintAuthorizationV8
soul_v8::mint_canonical_soul_v8<PaymentCoin>(
    soul_registry, root, soul_mint_authorization, ctx,
)
```

`recipe_policy_commitment` and `renderer_schema_commitment` are static
publication inputs. `seal_complete_authorization_v8` derives the exact
instance Recipe/render commitments from the current loadout and ordered Pack
selections; the receipt and Canonical Soul bind those derived values.
