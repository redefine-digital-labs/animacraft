# Animacraft Move Protocol

This independent Sui Move package implements the minimum fully on-chain Character Maker lifecycle. Walrus stores large files; Move stores canonical creator authority, Maker structure, publication state, recipe rules, policy snapshots, and OC ownership.

## Objects

- `CreatorProfile`: wallet owner, display metadata, payout address, Maker count, and Maker IDs.
- `OCMaker`: non-transferable module-controlled Maker with Parts, public Items, allowed Colors, selection and palette rules, license policy, Walrus Quilt Blob ID, publication state, and archive state.
- `LicensePolicy`: license kind, royalty BPS, commercial/remix permission, and attribution requirement.
- `OCCharacter`: user-owned result with Maker provenance, Walrus image/profile references, 32-byte recipe hash, full recipe, and copied policy.

## Shared Maker Model

Published Makers must be shared so any wallet can pass an immutable `&OCMaker` to `mint_oc_character`. `OCMaker` intentionally has no `store` ability, so outside modules cannot transfer or publicly share it and bypass Animacraft lifecycle checks.

The production PTB calls:

1. `new_creator_profile` when the wallet has no profile, otherwise reuses its profile object.
2. `new_oc_maker`.
3. `add_part`, `add_color`, `add_item`, `add_selection_rule`, and `add_palette_link` for the validated public structure.
4. `publish_maker` with the certified Walrus Quilt Blob ID.
5. `share_published_maker` while the Maker is still fresh in the same transaction.
6. Calls `keep_creator_profile` for a newly created profile. `CreatorProfile` has no generic `store` ability, so its explicit owner cannot drift from Sui object ownership.

## Enforced Invariants

- Valid license, Part, and Item-gate enums.
- Royalty BPS from 0 to 10,000.
- At most 750 Parts, 5,000 Items, 1,000 rules, and 32 Colors per Part.
- Bounded names, descriptions, URIs, and Walrus identifiers.
- Unique Part keys and Item keys within each Part.
- Every published Part has at least one Item and at least one Part is menu-visible.
- Last Bastion Parts are required and cannot be targeted by selection rules.
- Publication locks metadata, policy, structure, and rules.
- Archive blocks new OC mints without changing existing OCs.
- Recipes reference real Parts, Items, and registered Colors, preserve published Part order, contain no duplicate Part, include every required Part, and satisfy selection and palette rules.
- OC recipe hashes are SHA-256 over the canonical BCS `vector<RecipeSlot>` and are recomputed by Move rather than trusted from the caller.

## Lifecycle

- Local draft deletion is frontend-only.
- `publish_maker` makes the current version immutable.
- `set_maker_archived` is creator-only and reversible.
- Existing `OCCharacter` ownership, recipe, provenance, and policy snapshots survive archive.
- Published Sui records and certified Walrus files are not erased by deleting local browser data.

## Build and Test

```bash
sui move build
sui move test
```

The current suite contains 20 tests covering constants, valid publication/mint, shared Maker creation, archive/restore, archived mint rejection, enum validation, duplicate Item and rule rejection, empty Part rejection, Last Bastion rules, forged hashes, unregistered Colors, forged order, linked palettes, selection rules, and the canonical web/Move BCS hash fixture.

One `share_owned` lint warning is intentionally suppressed on `share_published_maker`. It only succeeds for a freshly created published object in the same transaction; the runtime aborts attempts to share an older owned object.

## Explicit Boundary

This package records license and royalty policy but does not execute payments, premium-Part access, Kiosk listings, resale, or royalty settlement. Those require separate reviewed adapters.
