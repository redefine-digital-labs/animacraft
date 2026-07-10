module animacraft::animacraft;

use std::string::{Self as string, String};
use sui::clock::Clock;
use sui::display;
use sui::event;
use sui::package;
use sui::table::{Self as table, Table};

const VERSION: u64 = 1;
const MAX_BPS: u16 = 10_000;

const ENotOwner: u64 = 0;
const ERoyaltyTooHigh: u64 = 1;
const EMakerPublished: u64 = 2;
const EMakerNotPublished: u64 = 3;
const EPartAlreadyExists: u64 = 4;
const EPartMissing: u64 = 5;
const ENoParts: u64 = 6;
const EEmptyRecipe: u64 = 7;
const EInvalidName: u64 = 8;
const EInvalidLicenseKind: u64 = 9;
const EInvalidPartKind: u64 = 10;
const EInvalidItemGate: u64 = 11;
const ENoItems: u64 = 12;
const EEmptyBlobId: u64 = 13;
const EInvalidRecipe: u64 = 14;
const EDuplicateRecipePart: u64 = 15;
const ESelectionRuleViolation: u64 = 16;

const LICENSE_PERSONAL: u8 = 0;
const LICENSE_FREE_REMIX: u8 = 1;
const LICENSE_PAID_COMMERCIAL: u8 = 2;
const LICENSE_EXCLUSIVE: u8 = 3;

const PART_STANDARD: u8 = 0;
const PART_LEFT_RIGHT_PAIR: u8 = 1;
const PART_LAST_BASTION: u8 = 2;

const ITEM_INCLUDED: u8 = 0;
const ITEM_PAID_ADDON: u8 = 1;
const ITEM_CREATOR_ONLY: u8 = 2;

public struct ANIMACRAFT has drop {}

/// Creator-owned profile used by the creator workshop. This object is kept
/// separate from OCMaker so creators can manage many maker templates from one
/// wallet while later adapters may link the same wallet to Soulidity identity.
public struct CreatorProfile has key, store {
    id: UID,
    version: u64,
    owner: address,
    display_name: String,
    bio: String,
    avatar_url: String,
    payout_address: address,
    maker_count: u64,
}

/// Snapshot of how a maker and derived OCs may be used. It is copied into every
/// minted OC so later maker policy edits cannot rewrite old user rights.
public struct LicensePolicy has copy, drop, store {
    license_kind: u8,
    royalty_bps: u16,
    commercial_allowed: bool,
    remix_allowed: bool,
    attribution_required: bool,
}

public struct PartKey has copy, drop, store {
    name: String,
}

public struct PartRecord has copy, drop, store {
    key: String,
    label: String,
    part_kind: u8,
    render_order: u64,
    item_count: u64,
    menu_visible: bool,
    required: bool,
}

public struct ItemRecord has copy, drop, store {
    part_key: String,
    item_key: String,
    label: String,
    walrus_blob_id: String,
    icon_blob_id: String,
    gate_kind: u8,
}

/// Creator template. Its manifest blob should contain the full off-chain / Walrus
/// index needed by the editor, while this object keeps canonical ownership,
/// publication state, licensing, parts and item references queryable on-chain.
public struct OCMaker has key, store {
    id: UID,
    version: u64,
    creator: address,
    creator_profile_id: ID,
    name: String,
    description: String,
    cover_url: String,
    manifest_blob_id: String,
    policy: LicensePolicy,
    parts: Table<PartKey, PartRecord>,
    items_by_part: Table<PartKey, vector<ItemRecord>>,
    part_keys: vector<String>,
    selection_rules: vector<SelectionRule>,
    part_count: u64,
    item_count: u64,
    rule_count: u64,
    published: bool,
    created_at_ms: u64,
    updated_at_ms: u64,
}

public struct RecipeSlot has copy, drop, store {
    part_key: String,
    item_key: String,
    color_hex: String,
    render_order: u64,
}

public struct SelectionRule has copy, drop, store {
    left_part_key: String,
    left_item_key: String,
    right_part_key: String,
    right_item_key: String,
}

/// User-owned OC output derived from an OCMaker. The rendered image and profile
/// JSON are Walrus blob ids; recipe_hash is the stable proof for the selected
/// part/item/color set.
public struct OCCharacter has key, store {
    id: UID,
    version: u64,
    maker_id: ID,
    maker_creator: address,
    owner: address,
    name: String,
    profile_json_blob_id: String,
    image_blob_id: String,
    image_url: String,
    recipe_hash: vector<u8>,
    license_snapshot: LicensePolicy,
    recipe: vector<RecipeSlot>,
    created_at_ms: u64,
}

public struct CreatorProfileCreated has copy, drop {
    profile_id: ID,
    owner: address,
    payout_address: address,
}

public struct OCMakerCreated has copy, drop {
    maker_id: ID,
    creator: address,
    creator_profile_id: ID,
    license_kind: u8,
    royalty_bps: u16,
}

public struct OCMakerMetadataUpdated has copy, drop {
    maker_id: ID,
    updater: address,
}

public struct OCMakerPartAdded has copy, drop {
    maker_id: ID,
    creator: address,
    part_key: String,
    part_kind: u8,
    render_order: u64,
}

public struct OCMakerItemAdded has copy, drop {
    maker_id: ID,
    creator: address,
    part_key: String,
    item_key: String,
    gate_kind: u8,
}

public struct OCMakerPublished has copy, drop {
    maker_id: ID,
    creator: address,
    manifest_blob_id: String,
    part_count: u64,
    item_count: u64,
}

public struct OCMakerRuleAdded has copy, drop {
    maker_id: ID,
    creator: address,
    left_part_key: String,
    right_part_key: String,
}

public struct OCCharacterMinted has copy, drop {
    oc_id: ID,
    maker_id: ID,
    maker_creator: address,
    owner: address,
    recipe_hash: vector<u8>,
    license_kind: u8,
    royalty_bps: u16,
}

fun init(otw: ANIMACRAFT, ctx: &mut TxContext) {
    let publisher = package::claim(otw, ctx);

    let mut maker_display = display::new<OCMaker>(&publisher, ctx);
    maker_display.add(b"name".to_string(), b"{name}".to_string());
    maker_display.add(b"description".to_string(), b"{description}".to_string());
    maker_display.add(b"image_url".to_string(), b"{cover_url}".to_string());
    maker_display.add(b"creator".to_string(), b"{creator}".to_string());
    maker_display.update_version();

    let mut oc_display = display::new<OCCharacter>(&publisher, ctx);
    oc_display.add(b"name".to_string(), b"{name}".to_string());
    oc_display.add(b"description".to_string(), b"OC created with Animacraft".to_string());
    oc_display.add(b"image_url".to_string(), b"{image_url}".to_string());
    oc_display.add(b"creator".to_string(), b"{maker_creator}".to_string());
    oc_display.update_version();

    transfer::public_transfer(publisher, ctx.sender());
    transfer::public_transfer(maker_display, ctx.sender());
    transfer::public_transfer(oc_display, ctx.sender());
}

public fun protocol_version(): u64 {
    VERSION
}

public fun license_personal(): u8 {
    LICENSE_PERSONAL
}

public fun license_free_remix(): u8 {
    LICENSE_FREE_REMIX
}

public fun license_paid_commercial(): u8 {
    LICENSE_PAID_COMMERCIAL
}

public fun license_exclusive(): u8 {
    LICENSE_EXCLUSIVE
}

public fun part_standard(): u8 {
    PART_STANDARD
}

public fun part_left_right_pair(): u8 {
    PART_LEFT_RIGHT_PAIR
}

public fun part_last_bastion(): u8 {
    PART_LAST_BASTION
}

public fun item_included(): u8 {
    ITEM_INCLUDED
}

public fun item_paid_addon(): u8 {
    ITEM_PAID_ADDON
}

public fun item_creator_only(): u8 {
    ITEM_CREATOR_ONLY
}

public fun profile_owner(self: &CreatorProfile): address {
    self.owner
}

public fun profile_id(self: &CreatorProfile): ID {
    object::id(self)
}

public fun maker_id(self: &OCMaker): ID {
    object::id(self)
}

public fun maker_creator(self: &OCMaker): address {
    self.creator
}

public fun maker_published(self: &OCMaker): bool {
    self.published
}

public fun maker_policy(self: &OCMaker): LicensePolicy {
    self.policy
}

public fun oc_owner(self: &OCCharacter): address {
    self.owner
}

public fun oc_maker_id(self: &OCCharacter): ID {
    self.maker_id
}

public fun recipe_slot_part_key(self: &RecipeSlot): &String {
    &self.part_key
}

public fun recipe_slot_item_key(self: &RecipeSlot): &String {
    &self.item_key
}

public fun recipe_slot_color_hex(self: &RecipeSlot): &String {
    &self.color_hex
}

public fun recipe_slot_render_order(self: &RecipeSlot): u64 {
    self.render_order
}

public fun new_creator_profile(
    display_name: String,
    bio: String,
    avatar_url: String,
    payout_address: address,
    ctx: &mut TxContext,
): CreatorProfile {
    assert_non_empty(&display_name);

    let owner = ctx.sender();
    let profile = CreatorProfile {
        id: object::new(ctx),
        version: VERSION,
        owner,
        display_name,
        bio,
        avatar_url,
        payout_address,
        maker_count: 0,
    };
    let profile_id = object::id(&profile);

    event::emit(CreatorProfileCreated {
        profile_id,
        owner,
        payout_address,
    });
    profile
}

entry fun create_creator_profile(
    display_name: String,
    bio: String,
    avatar_url: String,
    payout_address: address,
    ctx: &mut TxContext,
) {
    let owner = ctx.sender();
    let profile = new_creator_profile(display_name, bio, avatar_url, payout_address, ctx);
    transfer::public_transfer(profile, owner);
}

public fun update_creator_profile(
    profile: &mut CreatorProfile,
    display_name: String,
    bio: String,
    avatar_url: String,
    payout_address: address,
    ctx: &TxContext,
) {
    assert_owner(profile.owner, ctx);
    assert_non_empty(&display_name);

    profile.display_name = display_name;
    profile.bio = bio;
    profile.avatar_url = avatar_url;
    profile.payout_address = payout_address;
}

public fun new_oc_maker(
    profile: &mut CreatorProfile,
    name: String,
    description: String,
    cover_url: String,
    manifest_blob_id: String,
    license_kind: u8,
    royalty_bps: u16,
    commercial_allowed: bool,
    remix_allowed: bool,
    attribution_required: bool,
    clock: &Clock,
    ctx: &mut TxContext,
): OCMaker {
    assert_owner(profile.owner, ctx);
    assert_non_empty(&name);
    assert!(royalty_bps <= MAX_BPS, ERoyaltyTooHigh);
    assert_valid_license_kind(license_kind);

    let creator = ctx.sender();
    let now_ms = clock.timestamp_ms();
    let policy = LicensePolicy {
        license_kind,
        royalty_bps,
        commercial_allowed,
        remix_allowed,
        attribution_required,
    };
    let maker = OCMaker {
        id: object::new(ctx),
        version: VERSION,
        creator,
        creator_profile_id: object::id(profile),
        name,
        description,
        cover_url,
        manifest_blob_id,
        policy,
        parts: table::new(ctx),
        items_by_part: table::new(ctx),
        part_keys: vector[],
        selection_rules: vector[],
        part_count: 0,
        item_count: 0,
        rule_count: 0,
        published: false,
        created_at_ms: now_ms,
        updated_at_ms: now_ms,
    };
    let maker_id = object::id(&maker);
    profile.maker_count = profile.maker_count + 1;

    event::emit(OCMakerCreated {
        maker_id,
        creator,
        creator_profile_id: object::id(profile),
        license_kind,
        royalty_bps,
    });
    maker
}

entry fun create_oc_maker(
    profile: &mut CreatorProfile,
    name: String,
    description: String,
    cover_url: String,
    manifest_blob_id: String,
    license_kind: u8,
    royalty_bps: u16,
    commercial_allowed: bool,
    remix_allowed: bool,
    attribution_required: bool,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let creator = ctx.sender();
    let maker = new_oc_maker(
        profile,
        name,
        description,
        cover_url,
        manifest_blob_id,
        license_kind,
        royalty_bps,
        commercial_allowed,
        remix_allowed,
        attribution_required,
        clock,
        ctx,
    );
    transfer::public_transfer(maker, creator);
}

public fun update_maker_metadata(
    maker: &mut OCMaker,
    name: String,
    description: String,
    cover_url: String,
    manifest_blob_id: String,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_maker_creator(maker, ctx);
    assert_non_empty(&name);

    maker.name = name;
    maker.description = description;
    maker.cover_url = cover_url;
    maker.manifest_blob_id = manifest_blob_id;
    maker.updated_at_ms = clock.timestamp_ms();

    event::emit(OCMakerMetadataUpdated {
        maker_id: object::id(maker),
        updater: ctx.sender(),
    });
}

public fun update_maker_policy(
    maker: &mut OCMaker,
    license_kind: u8,
    royalty_bps: u16,
    commercial_allowed: bool,
    remix_allowed: bool,
    attribution_required: bool,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_maker_creator(maker, ctx);
    assert!(royalty_bps <= MAX_BPS, ERoyaltyTooHigh);
    assert_valid_license_kind(license_kind);

    maker.policy = LicensePolicy {
        license_kind,
        royalty_bps,
        commercial_allowed,
        remix_allowed,
        attribution_required,
    };
    maker.updated_at_ms = clock.timestamp_ms();
}

public fun add_part(
    maker: &mut OCMaker,
    key: String,
    label: String,
    part_kind: u8,
    render_order: u64,
    menu_visible: bool,
    required: bool,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_maker_creator(maker, ctx);
    assert_editable(maker);
    assert_non_empty(&key);
    assert_non_empty(&label);
    assert_valid_part_kind(part_kind);

    let part_key = PartKey { name: key };
    assert!(!maker.parts.contains(part_key), EPartAlreadyExists);
    maker.parts.add(part_key, PartRecord {
        key,
        label,
        part_kind,
        render_order,
        item_count: 0,
        menu_visible,
        required,
    });
    maker.items_by_part.add(part_key, vector[]);
    maker.part_keys.push_back(key);
    maker.part_count = maker.part_count + 1;
    maker.updated_at_ms = clock.timestamp_ms();

    event::emit(OCMakerPartAdded {
        maker_id: object::id(maker),
        creator: ctx.sender(),
        part_key: key,
        part_kind,
        render_order,
    });
}

public fun add_item(
    maker: &mut OCMaker,
    part_key_name: String,
    item_key: String,
    label: String,
    walrus_blob_id: String,
    icon_blob_id: String,
    gate_kind: u8,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_maker_creator(maker, ctx);
    assert_editable(maker);
    assert_non_empty(&part_key_name);
    assert_non_empty(&item_key);
    assert_blob_id(&walrus_blob_id);
    assert_valid_item_gate(gate_kind);

    let part_key = PartKey { name: part_key_name };
    assert!(maker.parts.contains(part_key), EPartMissing);

    let record = maker.parts.borrow_mut(part_key);
    record.item_count = record.item_count + 1;

    let items = maker.items_by_part.borrow_mut(part_key);
    items.push_back(ItemRecord {
        part_key: part_key_name,
        item_key,
        label,
        walrus_blob_id,
        icon_blob_id,
        gate_kind,
    });
    maker.item_count = maker.item_count + 1;
    maker.updated_at_ms = clock.timestamp_ms();

    event::emit(OCMakerItemAdded {
        maker_id: object::id(maker),
        creator: ctx.sender(),
        part_key: part_key_name,
        item_key,
        gate_kind,
    });
}

public fun add_selection_rule(
    maker: &mut OCMaker,
    left_part_key: String,
    left_item_key: String,
    right_part_key: String,
    right_item_key: String,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_maker_creator(maker, ctx);
    assert_editable(maker);
    assert_part_exists(maker, &left_part_key);
    assert_part_exists(maker, &right_part_key);
    if (string::as_bytes(&left_item_key).length() > 0) {
        assert!(item_exists(maker, &left_part_key, &left_item_key), EPartMissing);
    };
    if (string::as_bytes(&right_item_key).length() > 0) {
        assert!(item_exists(maker, &right_part_key, &right_item_key), EPartMissing);
    };

    maker.selection_rules.push_back(SelectionRule {
        left_part_key,
        left_item_key,
        right_part_key,
        right_item_key,
    });
    maker.rule_count = maker.rule_count + 1;
    maker.updated_at_ms = clock.timestamp_ms();

    event::emit(OCMakerRuleAdded {
        maker_id: object::id(maker),
        creator: ctx.sender(),
        left_part_key,
        right_part_key,
    });
}

public fun publish_maker(
    maker: &mut OCMaker,
    manifest_blob_id: String,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_maker_creator(maker, ctx);
    assert!(maker.part_count > 0, ENoParts);
    assert!(maker.item_count > 0, ENoItems);
    assert_blob_id(&manifest_blob_id);

    maker.manifest_blob_id = manifest_blob_id;
    maker.published = true;
    maker.updated_at_ms = clock.timestamp_ms();

    event::emit(OCMakerPublished {
        maker_id: object::id(maker),
        creator: ctx.sender(),
        manifest_blob_id,
        part_count: maker.part_count,
        item_count: maker.item_count,
    });
}

public fun new_oc_character(
    maker: &OCMaker,
    name: String,
    profile_json_blob_id: String,
    image_blob_id: String,
    image_url: String,
    recipe_hash: vector<u8>,
    recipe: vector<RecipeSlot>,
    clock: &Clock,
    ctx: &mut TxContext,
): OCCharacter {
    assert!(maker.published, EMakerNotPublished);
    assert_non_empty(&name);
    assert!(recipe.length() > 0, EEmptyRecipe);
    assert_blob_id(&profile_json_blob_id);
    assert_blob_id(&image_blob_id);
    assert_non_empty(&image_url);
    assert!(recipe_hash.length() > 0, EEmptyRecipe);
    assert_valid_recipe(maker, &recipe);

    let owner = ctx.sender();
    let oc = OCCharacter {
        id: object::new(ctx),
        version: VERSION,
        maker_id: object::id(maker),
        maker_creator: maker.creator,
        owner,
        name,
        profile_json_blob_id,
        image_blob_id,
        image_url,
        recipe_hash,
        license_snapshot: maker.policy,
        recipe,
        created_at_ms: clock.timestamp_ms(),
    };
    let oc_id = object::id(&oc);

    event::emit(OCCharacterMinted {
        oc_id,
        maker_id: object::id(maker),
        maker_creator: maker.creator,
        owner,
        recipe_hash,
        license_kind: maker.policy.license_kind,
        royalty_bps: maker.policy.royalty_bps,
    });
    oc
}

entry fun mint_oc_character(
    maker: &OCMaker,
    name: String,
    profile_json_blob_id: String,
    image_blob_id: String,
    image_url: String,
    recipe_hash: vector<u8>,
    recipe: vector<RecipeSlot>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let owner = ctx.sender();
    let oc = new_oc_character(
        maker,
        name,
        profile_json_blob_id,
        image_blob_id,
        image_url,
        recipe_hash,
        recipe,
        clock,
        ctx,
    );
    transfer::public_transfer(oc, owner);
}

fun assert_maker_creator(maker: &OCMaker, ctx: &TxContext) {
    assert_owner(maker.creator, ctx);
}

fun assert_owner(owner: address, ctx: &TxContext) {
    assert!(owner == ctx.sender(), ENotOwner);
}

fun assert_editable(maker: &OCMaker) {
    assert!(!maker.published, EMakerPublished);
}

fun assert_non_empty(value: &String) {
    assert!(string::as_bytes(value).length() > 0, EInvalidName);
}

fun assert_blob_id(value: &String) {
    assert!(string::as_bytes(value).length() > 0, EEmptyBlobId);
}

fun assert_valid_license_kind(value: u8) {
    assert!(value <= LICENSE_EXCLUSIVE, EInvalidLicenseKind);
}

fun assert_valid_part_kind(value: u8) {
    assert!(value <= PART_LAST_BASTION, EInvalidPartKind);
}

fun assert_valid_item_gate(value: u8) {
    assert!(value <= ITEM_CREATOR_ONLY, EInvalidItemGate);
}

fun assert_part_exists(maker: &OCMaker, part_key_name: &String) {
    assert!(maker.parts.contains(PartKey { name: *part_key_name }), EPartMissing);
}

fun item_exists(maker: &OCMaker, part_key_name: &String, item_key_name: &String): bool {
    let key = PartKey { name: *part_key_name };
    if (!maker.items_by_part.contains(key)) return false;
    let items = maker.items_by_part.borrow(key);
    let mut index = 0;
    while (index < items.length()) {
        if (&items[index].item_key == item_key_name) return true;
        index = index + 1;
    };
    false
}

fun recipe_contains(recipe: &vector<RecipeSlot>, part_key: &String, item_key: &String): bool {
    let mut index = 0;
    while (index < recipe.length()) {
        let slot = &recipe[index];
        let item_matches = string::as_bytes(item_key).length() == 0 || &slot.item_key == item_key;
        if (&slot.part_key == part_key && item_matches) return true;
        index = index + 1;
    };
    false
}

fun assert_valid_recipe(maker: &OCMaker, recipe: &vector<RecipeSlot>) {
    let mut index = 0;
    while (index < recipe.length()) {
        let slot = &recipe[index];
        assert_part_exists(maker, &slot.part_key);
        assert!(item_exists(maker, &slot.part_key, &slot.item_key), EInvalidRecipe);

        let mut duplicate_index = index + 1;
        while (duplicate_index < recipe.length()) {
            assert!(&recipe[duplicate_index].part_key != &slot.part_key, EDuplicateRecipePart);
            duplicate_index = duplicate_index + 1;
        };
        index = index + 1;
    };

    let mut part_index = 0;
    while (part_index < maker.part_keys.length()) {
        let part_key_name = &maker.part_keys[part_index];
        let record = maker.parts.borrow(PartKey { name: *part_key_name });
        if (record.required) {
            assert!(recipe_contains(recipe, part_key_name, &b"".to_string()), EInvalidRecipe);
        };
        part_index = part_index + 1;
    };

    let mut rule_index = 0;
    while (rule_index < maker.selection_rules.length()) {
        let rule = &maker.selection_rules[rule_index];
        let left_selected = recipe_contains(recipe, &rule.left_part_key, &rule.left_item_key);
        let right_selected = recipe_contains(recipe, &rule.right_part_key, &rule.right_item_key);
        assert!(!(left_selected && right_selected), ESelectionRuleViolation);
        rule_index = rule_index + 1;
    };
}

#[test]
fun protocol_constants_are_stable() {
    assert!(license_personal() == 0);
    assert!(license_exclusive() == 3);
    assert!(part_standard() == 0);
    assert!(part_last_bastion() == 2);
    assert!(item_included() == 0);
    assert!(item_creator_only() == 2);
}

#[test, expected_failure(abort_code = EInvalidLicenseKind)]
fun rejects_invalid_license_kind() {
    assert_valid_license_kind(4);
}

#[test, expected_failure(abort_code = EInvalidPartKind)]
fun rejects_invalid_part_kind() {
    assert_valid_part_kind(3);
}

#[test, expected_failure(abort_code = EInvalidItemGate)]
fun rejects_invalid_item_gate() {
    assert_valid_item_gate(3);
}

#[test]
fun publishes_and_mints_a_valid_recipe() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut profile = new_creator_profile(
        b"Creator".to_string(),
        b"Bio".to_string(),
        b"".to_string(),
        ctx.sender(),
        &mut ctx,
    );
    let mut maker = new_oc_maker(
        &mut profile,
        b"Maker".to_string(),
        b"Description".to_string(),
        b"https://example.com/cover.png".to_string(),
        b"manifest".to_string(),
        LICENSE_PERSONAL,
        300,
        false,
        false,
        true,
        &clock,
        &mut ctx,
    );
    add_part(
        &mut maker,
        b"eyes".to_string(),
        b"Eyes".to_string(),
        PART_STANDARD,
        0,
        true,
        true,
        &clock,
        &ctx,
    );
    add_item(
        &mut maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"Bright".to_string(),
        b"item-blob".to_string(),
        b"".to_string(),
        ITEM_INCLUDED,
        &clock,
        &ctx,
    );
    publish_maker(&mut maker, b"manifest".to_string(), &clock, &ctx);
    let oc = new_oc_character(
        &maker,
        b"Mira".to_string(),
        b"profile-blob".to_string(),
        b"image-blob".to_string(),
        b"https://example.com/image.png".to_string(),
        vector[1, 2, 3],
        vector[RecipeSlot {
            part_key: b"eyes".to_string(),
            item_key: b"bright".to_string(),
            color_hex: b"#2db7a3".to_string(),
            render_order: 0,
        }],
        &clock,
        &mut ctx,
    );

    let sender = ctx.sender();
    transfer::public_transfer(profile, sender);
    transfer::public_transfer(maker, sender);
    transfer::public_transfer(oc, sender);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = ESelectionRuleViolation)]
fun rejects_recipe_that_breaks_selection_rule() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut profile = new_creator_profile(
        b"Creator".to_string(),
        b"".to_string(),
        b"".to_string(),
        ctx.sender(),
        &mut ctx,
    );
    let mut maker = new_oc_maker(
        &mut profile,
        b"Maker".to_string(),
        b"".to_string(),
        b"".to_string(),
        b"manifest".to_string(),
        LICENSE_PERSONAL,
        0,
        false,
        false,
        true,
        &clock,
        &mut ctx,
    );
    add_part(&mut maker, b"hair".to_string(), b"Hair".to_string(), PART_STANDARD, 0, true, false, &clock, &ctx);
    add_part(&mut maker, b"hat".to_string(), b"Hat".to_string(), PART_STANDARD, 1, true, false, &clock, &ctx);
    add_item(&mut maker, b"hair".to_string(), b"tall".to_string(), b"Tall".to_string(), b"hair-blob".to_string(), b"".to_string(), ITEM_INCLUDED, &clock, &ctx);
    add_item(&mut maker, b"hat".to_string(), b"crown".to_string(), b"Crown".to_string(), b"hat-blob".to_string(), b"".to_string(), ITEM_INCLUDED, &clock, &ctx);
    add_selection_rule(
        &mut maker,
        b"hair".to_string(),
        b"tall".to_string(),
        b"hat".to_string(),
        b"crown".to_string(),
        &clock,
        &ctx,
    );
    publish_maker(&mut maker, b"manifest".to_string(), &clock, &ctx);
    let oc = new_oc_character(
        &maker,
        b"Invalid".to_string(),
        b"profile".to_string(),
        b"image".to_string(),
        b"https://example.com/image.png".to_string(),
        vector[1],
        vector[
            RecipeSlot { part_key: b"hair".to_string(), item_key: b"tall".to_string(), color_hex: b"#000000".to_string(), render_order: 0 },
            RecipeSlot { part_key: b"hat".to_string(), item_key: b"crown".to_string(), color_hex: b"#ffffff".to_string(), render_order: 1 },
        ],
        &clock,
        &mut ctx,
    );
    let sender = ctx.sender();
    transfer::public_transfer(profile, sender);
    transfer::public_transfer(maker, sender);
    transfer::public_transfer(oc, sender);
    clock.destroy_for_testing();
    abort 99
}
