module animacraft::animacraft;

use std::string::{Self as string, String};
use sui::clock::Clock;
use sui::event;
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
    part_count: u64,
    item_count: u64,
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

public struct OCCharacterMinted has copy, drop {
    oc_id: ID,
    maker_id: ID,
    maker_creator: address,
    owner: address,
    recipe_hash: vector<u8>,
    license_kind: u8,
    royalty_bps: u16,
}

fun init(_otw: ANIMACRAFT, _ctx: &mut TxContext) {
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
        part_count: 0,
        item_count: 0,
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
    assert_non_empty(&walrus_blob_id);

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

public fun publish_maker(
    maker: &mut OCMaker,
    manifest_blob_id: String,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_maker_creator(maker, ctx);
    assert!(maker.part_count > 0, ENoParts);

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
    recipe_hash: vector<u8>,
    recipe: vector<RecipeSlot>,
    clock: &Clock,
    ctx: &mut TxContext,
): OCCharacter {
    assert!(maker.published, EMakerNotPublished);
    assert_non_empty(&name);
    assert!(recipe.length() > 0, EEmptyRecipe);

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
