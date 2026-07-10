# Animacraft Move Protocol

Animacraft is an independent Sui Move package for fully on-chain character maker ownership, licensing, and OC provenance.

It is intentionally separate from Soulidity. The two products can live in the same repository and cooperate through adapters, but Animacraft can be published, upgraded, and integrated on its own.

## Production Scope

This package owns the minimum on-chain loop:

1. Creator registers a `CreatorProfile`.
2. Creator creates an `OCMaker` template.
3. Creator adds maker parts and item metadata.
4. Creator publishes the maker with a Walrus manifest blob id.
5. User mints an `OCCharacter` from the published maker.
6. The OC stores its recipe hash, rendered image blob id, profile JSON blob id, and a snapshot of the maker license.

Large PNG layers, preview images, JSON manifests, and rendered OC files should live in Walrus. The Move objects keep canonical ownership, policy, provenance, and queryable references.

## Main Objects

- `CreatorProfile`: creator identity, payout address, and maker count.
- `OCMaker`: creator-owned maker template with part records, item records, manifest reference, and publication state.
- `LicensePolicy`: license/royalty rules copied into each OC at mint time.
- `OCCharacter`: user-owned finished OC created from a published maker.
- `RecipeSlot`: selected part, item, color, and render order in an OC recipe.

## Entry Flow

Simple frontends can call:

- `create_creator_profile`
- `create_oc_maker`
- `add_part`
- `add_item`
- `publish_maker`
- `mint_oc_character`

Composable PTB flows can call:

- `new_creator_profile`
- `new_oc_maker`
- `new_oc_character`

The `new_*` functions return objects instead of transferring them directly, so wallet flows can combine object creation with later actions such as Kiosk listing, Soulidity identity binding, or marketplace settlement.

## Boundaries

Animacraft does not directly own:

- Marketplace payment settlement.
- Kiosk listing policy.
- Soulidity agent/identity memory.
- Walrus upload execution.
- Creator fiat/off-chain onboarding.

Those should be integrated through adapters after the core creator/maker/OC loop is stable.

## Suggested Integration Layers

- `animacraft`: maker templates, licenses, recipe provenance, OC minting.
- `walrus`: files, layer PNGs, icons, manifests, rendered OC images.
- `soulidity`: optional agent identity, paid access, collections, broader marketplace rules.
- `frontend`: editor state, validation UX, upload pipeline, wallet PTBs.

## Build

```bash
sui move build
```
