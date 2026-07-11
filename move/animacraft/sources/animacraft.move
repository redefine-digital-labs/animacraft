module animacraft::animacraft;

use std::bcs;
use std::hash;
use std::string::{Self as string, String};
use sui::clock::Clock;
use sui::display;
use sui::event;
use sui::package;
use sui::table::{Self as table, Table};

const VERSION: u64 = 1;
const MAX_BPS: u16 = 10_000;
const MAX_PARTS: u64 = 750;
const MAX_ITEMS: u64 = 5_000;
const MAX_RULES: u64 = 1_000;
const MAX_COLORS_PER_PART: u64 = 32;
const MAX_KEY_BYTES: u64 = 128;
const MAX_DESCRIPTION_BYTES: u64 = 2_000;
const MAX_URI_BYTES: u64 = 512;

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
const EMakerArchived: u64 = 17;
const EItemAlreadyExists: u64 = 18;
const ETooManyParts: u64 = 19;
const ETooManyItems: u64 = 20;
const ETooManyRules: u64 = 21;
const EStringTooLong: u64 = 22;
const EInvalidSelectionRule: u64 = 23;
const ENoVisibleParts: u64 = 24;
const EPartHasNoItems: u64 = 25;
const ERecipeTooLarge: u64 = 26;
const ELastBastionRule: u64 = 27;
const EInvalidRecipeHash: u64 = 28;
const EColorAlreadyExists: u64 = 29;
const ETooManyColors: u64 = 30;
const EPartHasNoColors: u64 = 31;
const EInvalidRenderOrder: u64 = 32;
const EPaletteLinkViolation: u64 = 33;

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
public struct CreatorProfile has key {
    id: UID,
    version: u64,
    owner: address,
    display_name: String,
    bio: String,
    avatar_url: String,
    payout_address: address,
    maker_count: u64,
    maker_ids: vector<ID>,
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
    colors: vector<String>,
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
public struct OCMaker has key {
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
    palette_links: vector<PaletteLink>,
    part_count: u64,
    item_count: u64,
    rule_count: u64,
    palette_link_count: u64,
    published: bool,
    archived: bool,
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

public struct PaletteLink has copy, drop, store {
    left_part_key: String,
    right_part_key: String,
}

/// User-owned OC output derived from an OCMaker. The rendered image and profile
/// JSON are Walrus blob ids; recipe_hash is the stable proof for the selected
/// part/item/color set.
public struct OCCharacter has key, store {
    id: UID,
    version: u64,
    maker_id: ID,
    maker_creator: address,
    minter: address,
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

public struct OCMakerArchiveChanged has copy, drop {
    maker_id: ID,
    creator: address,
    archived: bool,
}

public struct OCMakerRuleAdded has copy, drop {
    maker_id: ID,
    creator: address,
    left_part_key: String,
    right_part_key: String,
}

public struct OCMakerColorAdded has copy, drop {
    maker_id: ID,
    creator: address,
    part_key: String,
    color_hex: String,
}

public struct OCMakerPaletteLinked has copy, drop {
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

public fun maker_archived(self: &OCMaker): bool {
    self.archived
}

public fun maker_policy(self: &OCMaker): LicensePolicy {
    self.policy
}

public fun oc_minter(self: &OCCharacter): address {
    self.minter
}

public fun oc_maker_id(self: &OCCharacter): ID {
    self.maker_id
}

public fun creator_maker_ids(profile: &CreatorProfile): &vector<ID> {
    &profile.maker_ids
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
    assert_max_bytes(&display_name, MAX_KEY_BYTES);
    assert_max_bytes(&bio, MAX_DESCRIPTION_BYTES);
    assert_max_bytes(&avatar_url, MAX_URI_BYTES);

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
        maker_ids: vector[],
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
    transfer::transfer(profile, owner);
}

/// Keeps a profile returned from `new_creator_profile` under its creator's
/// address at the end of a programmable transaction block. CreatorProfile does
/// not have `store`, so generic transfers cannot silently desynchronize its
/// explicit owner field from Sui object ownership.
public fun keep_creator_profile(profile: CreatorProfile, ctx: &TxContext) {
    assert_owner(profile.owner, ctx);
    transfer::transfer(profile, ctx.sender());
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
    assert_max_bytes(&display_name, MAX_KEY_BYTES);
    assert_max_bytes(&bio, MAX_DESCRIPTION_BYTES);
    assert_max_bytes(&avatar_url, MAX_URI_BYTES);

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
    assert_max_bytes(&name, MAX_KEY_BYTES);
    assert_max_bytes(&description, MAX_DESCRIPTION_BYTES);
    assert_max_bytes(&cover_url, MAX_URI_BYTES);
    assert_max_bytes(&manifest_blob_id, MAX_URI_BYTES);
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
        palette_links: vector[],
        part_count: 0,
        item_count: 0,
        rule_count: 0,
        palette_link_count: 0,
        published: false,
        archived: false,
        created_at_ms: now_ms,
        updated_at_ms: now_ms,
    };
    let maker_id = object::id(&maker);
    profile.maker_count = profile.maker_count + 1;
    profile.maker_ids.push_back(maker_id);

    event::emit(OCMakerCreated {
        maker_id,
        creator,
        creator_profile_id: object::id(profile),
        license_kind,
        royalty_bps,
    });
    maker
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
    assert_editable(maker);
    assert_non_empty(&name);
    assert_max_bytes(&name, MAX_KEY_BYTES);
    assert_max_bytes(&description, MAX_DESCRIPTION_BYTES);
    assert_max_bytes(&cover_url, MAX_URI_BYTES);
    assert_max_bytes(&manifest_blob_id, MAX_URI_BYTES);

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
    assert_editable(maker);
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
    assert_max_bytes(&key, MAX_KEY_BYTES);
    assert_max_bytes(&label, MAX_KEY_BYTES);
    assert_valid_part_kind(part_kind);
    assert!(maker.part_count < MAX_PARTS, ETooManyParts);
    assert!(part_kind != PART_LAST_BASTION || required, EInvalidPartKind);

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
        colors: vector[],
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

public fun add_color(
    maker: &mut OCMaker,
    part_key_name: String,
    color_hex: String,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_maker_creator(maker, ctx);
    assert_editable(maker);
    assert_max_bytes(&part_key_name, MAX_KEY_BYTES);
    assert_color_hex(&color_hex);
    assert_part_exists(maker, &part_key_name);

    let part_key = PartKey { name: part_key_name };
    let record = maker.parts.borrow_mut(part_key);
    assert!(record.colors.length() < MAX_COLORS_PER_PART, ETooManyColors);
    let mut index = 0;
    while (index < record.colors.length()) {
        assert!(&record.colors[index] != &color_hex, EColorAlreadyExists);
        index = index + 1;
    };
    record.colors.push_back(color_hex);
    maker.updated_at_ms = clock.timestamp_ms();

    event::emit(OCMakerColorAdded {
        maker_id: object::id(maker),
        creator: ctx.sender(),
        part_key: part_key_name,
        color_hex,
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
    assert_non_empty(&label);
    assert_max_bytes(&part_key_name, MAX_KEY_BYTES);
    assert_max_bytes(&item_key, MAX_KEY_BYTES);
    assert_max_bytes(&label, MAX_KEY_BYTES);
    assert_blob_id(&walrus_blob_id);
    assert_max_bytes(&icon_blob_id, MAX_URI_BYTES);
    assert_valid_item_gate(gate_kind);
    assert!(maker.item_count < MAX_ITEMS, ETooManyItems);

    let part_key = PartKey { name: part_key_name };
    assert!(maker.parts.contains(part_key), EPartMissing);
    assert!(!item_exists(maker, &part_key_name, &item_key), EItemAlreadyExists);

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
    assert!(maker.rule_count < MAX_RULES, ETooManyRules);
    assert!(left_part_key != right_part_key, EInvalidSelectionRule);
    assert_max_bytes(&left_part_key, MAX_KEY_BYTES);
    assert_max_bytes(&left_item_key, MAX_KEY_BYTES);
    assert_max_bytes(&right_part_key, MAX_KEY_BYTES);
    assert_max_bytes(&right_item_key, MAX_KEY_BYTES);
    assert_part_exists(maker, &left_part_key);
    assert_part_exists(maker, &right_part_key);
    assert_rule_part(maker, &left_part_key);
    assert_rule_part(maker, &right_part_key);
    if (string::as_bytes(&left_item_key).length() > 0) {
        assert!(item_exists(maker, &left_part_key, &left_item_key), EPartMissing);
    };
    if (string::as_bytes(&right_item_key).length() > 0) {
        assert!(item_exists(maker, &right_part_key, &right_item_key), EPartMissing);
    };

    let mut index = 0;
    while (index < maker.selection_rules.length()) {
        let rule = &maker.selection_rules[index];
        let same_direction = &rule.left_part_key == &left_part_key
            && &rule.left_item_key == &left_item_key
            && &rule.right_part_key == &right_part_key
            && &rule.right_item_key == &right_item_key;
        let reverse_direction = &rule.left_part_key == &right_part_key
            && &rule.left_item_key == &right_item_key
            && &rule.right_part_key == &left_part_key
            && &rule.right_item_key == &left_item_key;
        assert!(!(same_direction || reverse_direction), EInvalidSelectionRule);
        index = index + 1;
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

public fun add_palette_link(
    maker: &mut OCMaker,
    left_part_key: String,
    right_part_key: String,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_maker_creator(maker, ctx);
    assert_editable(maker);
    assert!(maker.palette_link_count < MAX_RULES, ETooManyRules);
    assert!(left_part_key != right_part_key, EInvalidSelectionRule);
    assert_max_bytes(&left_part_key, MAX_KEY_BYTES);
    assert_max_bytes(&right_part_key, MAX_KEY_BYTES);
    assert_part_exists(maker, &left_part_key);
    assert_part_exists(maker, &right_part_key);
    let left = maker.parts.borrow(PartKey { name: left_part_key });
    let right = maker.parts.borrow(PartKey { name: right_part_key });
    assert!(part_colors_equal(left, right), EPaletteLinkViolation);

    let mut index = 0;
    while (index < maker.palette_links.length()) {
        let link = &maker.palette_links[index];
        let same_direction = &link.left_part_key == &left_part_key && &link.right_part_key == &right_part_key;
        let reverse_direction = &link.left_part_key == &right_part_key && &link.right_part_key == &left_part_key;
        assert!(!(same_direction || reverse_direction), EInvalidSelectionRule);
        index = index + 1;
    };

    maker.palette_links.push_back(PaletteLink {
        left_part_key,
        right_part_key,
    });
    maker.palette_link_count = maker.palette_link_count + 1;
    maker.updated_at_ms = clock.timestamp_ms();

    event::emit(OCMakerPaletteLinked {
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
    assert_editable(maker);
    assert!(maker.part_count > 0, ENoParts);
    assert!(maker.item_count > 0, ENoItems);
    assert_blob_id(&manifest_blob_id);
    assert_publishable_structure(maker);

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

/// Published Makers are shared so any wallet can borrow them as an immutable
/// input when minting an OC. Creator-only mutations still validate ctx.sender().
#[allow(lint(share_owned))]
public fun share_published_maker(maker: OCMaker, ctx: &TxContext) {
    assert_maker_creator(&maker, ctx);
    assert!(maker.published, EMakerNotPublished);
    transfer::share_object(maker);
}

public fun set_maker_archived(
    maker: &mut OCMaker,
    archived: bool,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_maker_creator(maker, ctx);
    assert!(maker.published, EMakerNotPublished);

    maker.archived = archived;
    maker.updated_at_ms = clock.timestamp_ms();

    event::emit(OCMakerArchiveChanged {
        maker_id: object::id(maker),
        creator: ctx.sender(),
        archived,
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
    assert!(!maker.archived, EMakerArchived);
    assert_non_empty(&name);
    assert_max_bytes(&name, MAX_KEY_BYTES);
    assert!(recipe.length() > 0, EEmptyRecipe);
    assert!(recipe.length() <= MAX_PARTS, ERecipeTooLarge);
    assert_blob_id(&profile_json_blob_id);
    assert_blob_id(&image_blob_id);
    assert_non_empty(&image_url);
    assert_max_bytes(&image_url, MAX_URI_BYTES);
    assert!(recipe_hash.length() == 32, EInvalidRecipeHash);
    assert_valid_recipe(maker, &recipe);
    assert!(recipe_hash == hash::sha2_256(bcs::to_bytes(&recipe)), EInvalidRecipeHash);

    let owner = ctx.sender();
    let oc = OCCharacter {
        id: object::new(ctx),
        version: VERSION,
        maker_id: object::id(maker),
        maker_creator: maker.creator,
        minter: owner,
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
    assert_max_bytes(value, MAX_URI_BYTES);
}

fun assert_max_bytes(value: &String, max: u64) {
    assert!(string::as_bytes(value).length() <= max, EStringTooLong);
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

fun assert_rule_part(maker: &OCMaker, part_key_name: &String) {
    let record = maker.parts.borrow(PartKey { name: *part_key_name });
    assert!(record.part_kind != PART_LAST_BASTION, ELastBastionRule);
}

fun assert_publishable_structure(maker: &OCMaker) {
    let mut index = 0;
    let mut has_visible_part = false;
    while (index < maker.part_keys.length()) {
        let key = &maker.part_keys[index];
        let record = maker.parts.borrow(PartKey { name: *key });
        assert!(record.item_count > 0, EPartHasNoItems);
        assert!(record.colors.length() > 0, EPartHasNoColors);
        if (record.menu_visible) has_visible_part = true;
        index = index + 1;
    };
    assert!(has_visible_part, ENoVisibleParts);
}

fun assert_color_hex(value: &String) {
    let bytes = string::as_bytes(value);
    assert!(bytes.length() == 7 && bytes[0] == 35, EInvalidRecipe);
    let mut index = 1;
    while (index < 7) {
        let byte = bytes[index];
        let is_digit = byte >= 48 && byte <= 57;
        let is_upper = byte >= 65 && byte <= 70;
        let is_lower = byte >= 97 && byte <= 102;
        assert!(is_digit || is_upper || is_lower, EInvalidRecipe);
        index = index + 1;
    };
}

fun part_has_color(record: &PartRecord, color_hex: &String): bool {
    let mut index = 0;
    while (index < record.colors.length()) {
        if (&record.colors[index] == color_hex) return true;
        index = index + 1;
    };
    false
}

fun part_colors_equal(left: &PartRecord, right: &PartRecord): bool {
    if (left.colors.length() != right.colors.length()) return false;
    let mut index = 0;
    while (index < left.colors.length()) {
        if (!part_has_color(right, &left.colors[index])) return false;
        index = index + 1;
    };
    true
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

fun linked_recipe_colors_match(
    recipe: &vector<RecipeSlot>,
    left_part_key: &String,
    right_part_key: &String,
): bool {
    let mut left_index = 0;
    while (left_index < recipe.length()) {
        let left = &recipe[left_index];
        if (&left.part_key == left_part_key) {
            let mut right_index = 0;
            while (right_index < recipe.length()) {
                let right = &recipe[right_index];
                if (&right.part_key == right_part_key) return &left.color_hex == &right.color_hex;
                right_index = right_index + 1;
            };
            return true
        };
        left_index = left_index + 1;
    };
    true
}

fun assert_valid_recipe(maker: &OCMaker, recipe: &vector<RecipeSlot>) {
    let mut index = 0;
    while (index < recipe.length()) {
        let slot = &recipe[index];
        assert_max_bytes(&slot.part_key, MAX_KEY_BYTES);
        assert_max_bytes(&slot.item_key, MAX_KEY_BYTES);
        assert_color_hex(&slot.color_hex);
        assert_part_exists(maker, &slot.part_key);
        assert!(item_exists(maker, &slot.part_key, &slot.item_key), EInvalidRecipe);
        let part = maker.parts.borrow(PartKey { name: slot.part_key });
        assert!(part_has_color(part, &slot.color_hex), EInvalidRecipe);
        assert!(part.render_order == slot.render_order, EInvalidRenderOrder);

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

    let mut palette_index = 0;
    while (palette_index < maker.palette_links.length()) {
        let link = &maker.palette_links[palette_index];
        assert!(
            linked_recipe_colors_match(recipe, &link.left_part_key, &link.right_part_key),
            EPaletteLinkViolation,
        );
        palette_index = palette_index + 1;
    };
}

#[test_only]
fun published_maker_for_testing(ctx: &mut TxContext, clock: &Clock): (CreatorProfile, OCMaker) {
    let mut profile = new_creator_profile(
        b"Creator".to_string(),
        b"".to_string(),
        b"".to_string(),
        ctx.sender(),
        ctx,
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
        clock,
        ctx,
    );
    add_part(&mut maker, b"eyes".to_string(), b"Eyes".to_string(), PART_STANDARD, 0, true, true, clock, ctx);
    add_color(&mut maker, b"eyes".to_string(), b"#2db7a3".to_string(), clock, ctx);
    add_item(&mut maker, b"eyes".to_string(), b"bright".to_string(), b"Bright".to_string(), b"item-blob".to_string(), b"".to_string(), ITEM_INCLUDED, clock, ctx);
    publish_maker(&mut maker, b"manifest".to_string(), clock, ctx);
    (profile, maker)
}

#[test_only]
fun test_recipe_hash(recipe: &vector<RecipeSlot>): vector<u8> {
    hash::sha2_256(bcs::to_bytes(recipe))
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

#[test]
fun recipe_hash_matches_web_bcs_fixture() {
    let recipe = vector[RecipeSlot {
        part_key: b"eyes".to_string(),
        item_key: b"bright".to_string(),
        color_hex: b"#2db7a3".to_string(),
        render_order: 0,
    }];
    let expected: vector<u8> = vector[
        23, 102, 33, 216, 45, 130, 184, 232,
        233, 6, 139, 205, 89, 222, 159, 219,
        182, 145, 112, 17, 94, 135, 96, 155,
        160, 151, 254, 62, 167, 56, 212, 109,
    ];
    assert!(test_recipe_hash(&recipe) == expected);
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

#[test, expected_failure(abort_code = EItemAlreadyExists)]
fun rejects_duplicate_item_keys() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut profile = new_creator_profile(b"Creator".to_string(), b"".to_string(), b"".to_string(), ctx.sender(), &mut ctx);
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
    add_part(&mut maker, b"eyes".to_string(), b"Eyes".to_string(), PART_STANDARD, 0, true, true, &clock, &ctx);
    add_item(&mut maker, b"eyes".to_string(), b"bright".to_string(), b"Bright".to_string(), b"blob-a".to_string(), b"".to_string(), ITEM_INCLUDED, &clock, &ctx);
    add_item(&mut maker, b"eyes".to_string(), b"bright".to_string(), b"Duplicate".to_string(), b"blob-b".to_string(), b"".to_string(), ITEM_INCLUDED, &clock, &ctx);
    abort 99
}

#[test, expected_failure(abort_code = ELastBastionRule)]
fun last_bastion_cannot_be_rule_target() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut profile = new_creator_profile(b"Creator".to_string(), b"".to_string(), b"".to_string(), ctx.sender(), &mut ctx);
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
    add_part(&mut maker, b"base".to_string(), b"Base".to_string(), PART_LAST_BASTION, 0, true, true, &clock, &ctx);
    add_part(&mut maker, b"hat".to_string(), b"Hat".to_string(), PART_STANDARD, 1, true, false, &clock, &ctx);
    add_selection_rule(&mut maker, b"base".to_string(), b"".to_string(), b"hat".to_string(), b"".to_string(), &clock, &ctx);
    abort 99
}

#[test, expected_failure(abort_code = EInvalidSelectionRule)]
fun duplicate_selection_rules_are_rejected_in_either_direction() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut profile = new_creator_profile(b"Creator".to_string(), b"".to_string(), b"".to_string(), ctx.sender(), &mut ctx);
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
    add_part(&mut maker, b"eyes".to_string(), b"Eyes".to_string(), PART_STANDARD, 0, true, false, &clock, &ctx);
    add_part(&mut maker, b"hat".to_string(), b"Hat".to_string(), PART_STANDARD, 1, true, false, &clock, &ctx);
    add_item(&mut maker, b"eyes".to_string(), b"bright".to_string(), b"Bright".to_string(), b"eyes".to_string(), b"".to_string(), ITEM_INCLUDED, &clock, &ctx);
    add_item(&mut maker, b"hat".to_string(), b"cap".to_string(), b"Cap".to_string(), b"hat".to_string(), b"".to_string(), ITEM_INCLUDED, &clock, &ctx);
    add_selection_rule(&mut maker, b"eyes".to_string(), b"bright".to_string(), b"hat".to_string(), b"cap".to_string(), &clock, &ctx);
    add_selection_rule(&mut maker, b"hat".to_string(), b"cap".to_string(), b"eyes".to_string(), b"bright".to_string(), &clock, &ctx);
    abort 99
}

#[test, expected_failure(abort_code = EPartHasNoItems)]
fun every_published_part_requires_an_item() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut profile = new_creator_profile(b"Creator".to_string(), b"".to_string(), b"".to_string(), ctx.sender(), &mut ctx);
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
    add_part(&mut maker, b"eyes".to_string(), b"Eyes".to_string(), PART_STANDARD, 0, true, true, &clock, &ctx);
    add_part(&mut maker, b"hat".to_string(), b"Hat".to_string(), PART_STANDARD, 1, true, false, &clock, &ctx);
    add_color(&mut maker, b"eyes".to_string(), b"#2db7a3".to_string(), &clock, &ctx);
    add_color(&mut maker, b"hat".to_string(), b"#ffffff".to_string(), &clock, &ctx);
    add_item(&mut maker, b"eyes".to_string(), b"bright".to_string(), b"Bright".to_string(), b"item-blob".to_string(), b"".to_string(), ITEM_INCLUDED, &clock, &ctx);
    publish_maker(&mut maker, b"manifest".to_string(), &clock, &ctx);
    abort 99
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
    assert!(creator_maker_ids(&profile).length() == 1);
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
    add_color(&mut maker, b"eyes".to_string(), b"#2db7a3".to_string(), &clock, &ctx);
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
    let recipe = vector[RecipeSlot {
        part_key: b"eyes".to_string(),
        item_key: b"bright".to_string(),
        color_hex: b"#2db7a3".to_string(),
        render_order: 0,
    }];
    let recipe_hash = test_recipe_hash(&recipe);
    let oc = new_oc_character(
        &maker,
        b"Mira".to_string(),
        b"profile-blob".to_string(),
        b"image-blob".to_string(),
        b"https://example.com/image.png".to_string(),
        recipe_hash,
        recipe,
        &clock,
        &mut ctx,
    );

    let sender = ctx.sender();
    transfer::transfer(profile, sender);
    transfer::transfer(maker, sender);
    transfer::public_transfer(oc, sender);
    clock.destroy_for_testing();
}

#[test]
fun published_maker_can_be_archived_and_restored() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (profile, mut maker) = published_maker_for_testing(&mut ctx, &clock);

    set_maker_archived(&mut maker, true, &clock, &ctx);
    assert!(maker_archived(&maker));
    set_maker_archived(&mut maker, false, &clock, &ctx);
    assert!(!maker_archived(&maker));

    let sender = ctx.sender();
    transfer::transfer(profile, sender);
    transfer::transfer(maker, sender);
    clock.destroy_for_testing();
}

#[test]
fun published_maker_can_be_shared() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (profile, maker) = published_maker_for_testing(&mut ctx, &clock);

    share_published_maker(maker, &ctx);

    transfer::transfer(profile, ctx.sender());
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = EInvalidRecipeHash)]
fun rejects_non_sha256_recipe_hash() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (profile, maker) = published_maker_for_testing(&mut ctx, &clock);
    let oc = new_oc_character(
        &maker,
        b"Invalid hash".to_string(),
        b"profile-blob".to_string(),
        b"image-blob".to_string(),
        b"https://example.com/image.png".to_string(),
        vector[1],
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
    transfer::transfer(profile, sender);
    transfer::transfer(maker, sender);
    transfer::public_transfer(oc, sender);
    clock.destroy_for_testing();
    abort 99
}

#[test, expected_failure(abort_code = EInvalidRecipe)]
fun rejects_invalid_recipe_color() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (profile, maker) = published_maker_for_testing(&mut ctx, &clock);
    let oc = new_oc_character(
        &maker,
        b"Invalid color".to_string(),
        b"profile-blob".to_string(),
        b"image-blob".to_string(),
        b"https://example.com/image.png".to_string(),
        vector[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
        vector[RecipeSlot {
            part_key: b"eyes".to_string(),
            item_key: b"bright".to_string(),
            color_hex: b"#zzzzzz".to_string(),
            render_order: 0,
        }],
        &clock,
        &mut ctx,
    );
    let sender = ctx.sender();
    transfer::transfer(profile, sender);
    transfer::transfer(maker, sender);
    transfer::public_transfer(oc, sender);
    clock.destroy_for_testing();
    abort 99
}

#[test, expected_failure(abort_code = EInvalidRecipeHash)]
fun rejects_forged_32_byte_recipe_hash() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (profile, maker) = published_maker_for_testing(&mut ctx, &clock);
    let oc = new_oc_character(
        &maker,
        b"Forged hash".to_string(),
        b"profile-blob".to_string(),
        b"image-blob".to_string(),
        b"https://example.com/image.png".to_string(),
        vector[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
        vector[RecipeSlot {
            part_key: b"eyes".to_string(),
            item_key: b"bright".to_string(),
            color_hex: b"#2db7a3".to_string(),
            render_order: 0,
        }],
        &clock,
        &mut ctx,
    );
    transfer::transfer(profile, ctx.sender());
    transfer::transfer(maker, ctx.sender());
    transfer::public_transfer(oc, ctx.sender());
    clock.destroy_for_testing();
    abort 99
}

#[test, expected_failure(abort_code = EInvalidRecipe)]
fun rejects_unregistered_recipe_color() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (profile, maker) = published_maker_for_testing(&mut ctx, &clock);
    let oc = new_oc_character(
        &maker,
        b"Unregistered color".to_string(),
        b"profile-blob".to_string(),
        b"image-blob".to_string(),
        b"https://example.com/image.png".to_string(),
        vector[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
        vector[RecipeSlot {
            part_key: b"eyes".to_string(),
            item_key: b"bright".to_string(),
            color_hex: b"#ffffff".to_string(),
            render_order: 0,
        }],
        &clock,
        &mut ctx,
    );
    transfer::transfer(profile, ctx.sender());
    transfer::transfer(maker, ctx.sender());
    transfer::public_transfer(oc, ctx.sender());
    clock.destroy_for_testing();
    abort 99
}

#[test, expected_failure(abort_code = EInvalidRenderOrder)]
fun rejects_forged_render_order() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (profile, maker) = published_maker_for_testing(&mut ctx, &clock);
    let oc = new_oc_character(
        &maker,
        b"Forged order".to_string(),
        b"profile-blob".to_string(),
        b"image-blob".to_string(),
        b"https://example.com/image.png".to_string(),
        vector[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
        vector[RecipeSlot {
            part_key: b"eyes".to_string(),
            item_key: b"bright".to_string(),
            color_hex: b"#2db7a3".to_string(),
            render_order: 99,
        }],
        &clock,
        &mut ctx,
    );
    transfer::transfer(profile, ctx.sender());
    transfer::transfer(maker, ctx.sender());
    transfer::public_transfer(oc, ctx.sender());
    clock.destroy_for_testing();
    abort 99
}

#[test, expected_failure(abort_code = EPaletteLinkViolation)]
fun rejects_recipe_that_breaks_palette_link() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut profile = new_creator_profile(b"Creator".to_string(), b"".to_string(), b"".to_string(), ctx.sender(), &mut ctx);
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
    add_part(&mut maker, b"hair".to_string(), b"Hair".to_string(), PART_STANDARD, 0, true, true, &clock, &ctx);
    add_part(&mut maker, b"brows".to_string(), b"Brows".to_string(), PART_STANDARD, 1, true, true, &clock, &ctx);
    add_color(&mut maker, b"hair".to_string(), b"#000000".to_string(), &clock, &ctx);
    add_color(&mut maker, b"hair".to_string(), b"#ffffff".to_string(), &clock, &ctx);
    add_color(&mut maker, b"brows".to_string(), b"#000000".to_string(), &clock, &ctx);
    add_color(&mut maker, b"brows".to_string(), b"#ffffff".to_string(), &clock, &ctx);
    add_item(&mut maker, b"hair".to_string(), b"normal".to_string(), b"Normal".to_string(), b"hair-blob".to_string(), b"".to_string(), ITEM_INCLUDED, &clock, &ctx);
    add_item(&mut maker, b"brows".to_string(), b"normal".to_string(), b"Normal".to_string(), b"brows-blob".to_string(), b"".to_string(), ITEM_INCLUDED, &clock, &ctx);
    add_palette_link(&mut maker, b"hair".to_string(), b"brows".to_string(), &clock, &ctx);
    publish_maker(&mut maker, b"manifest".to_string(), &clock, &ctx);
    let oc = new_oc_character(
        &maker,
        b"Mismatched palette".to_string(),
        b"profile".to_string(),
        b"image".to_string(),
        b"https://example.com/image.png".to_string(),
        vector[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
        vector[
            RecipeSlot { part_key: b"hair".to_string(), item_key: b"normal".to_string(), color_hex: b"#000000".to_string(), render_order: 0 },
            RecipeSlot { part_key: b"brows".to_string(), item_key: b"normal".to_string(), color_hex: b"#ffffff".to_string(), render_order: 1 },
        ],
        &clock,
        &mut ctx,
    );
    transfer::transfer(profile, ctx.sender());
    transfer::transfer(maker, ctx.sender());
    transfer::public_transfer(oc, ctx.sender());
    clock.destroy_for_testing();
    abort 99
}

#[test, expected_failure(abort_code = EMakerArchived)]
fun archived_maker_rejects_new_oc_mints() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (profile, mut maker) = published_maker_for_testing(&mut ctx, &clock);
    set_maker_archived(&mut maker, true, &clock, &ctx);

    let oc = new_oc_character(
        &maker,
        b"Blocked".to_string(),
        b"profile-blob".to_string(),
        b"image-blob".to_string(),
        b"https://example.com/image.png".to_string(),
        vector[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
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
    transfer::transfer(profile, sender);
    transfer::transfer(maker, sender);
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
    add_color(&mut maker, b"hair".to_string(), b"#000000".to_string(), &clock, &ctx);
    add_color(&mut maker, b"hat".to_string(), b"#ffffff".to_string(), &clock, &ctx);
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
        vector[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
        vector[
            RecipeSlot { part_key: b"hair".to_string(), item_key: b"tall".to_string(), color_hex: b"#000000".to_string(), render_order: 0 },
            RecipeSlot { part_key: b"hat".to_string(), item_key: b"crown".to_string(), color_hex: b"#ffffff".to_string(), render_order: 1 },
        ],
        &clock,
        &mut ctx,
    );
    let sender = ctx.sender();
    transfer::transfer(profile, sender);
    transfer::transfer(maker, sender);
    transfer::public_transfer(oc, sender);
    clock.destroy_for_testing();
    abort 99
}
