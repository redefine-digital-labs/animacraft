# Animacraft Product Boundary

## Positioning

**Animacraft is The Fully onchain Character Maker & Creator.**

It serves two linked roles:

- **Maker creators:** artists package reusable Parts, Items, Layers, Colors, rules, and usage policy.
- **OC makers:** users choose a published Maker, combine its options, and mint the resulting character as a Soul in Soulidity.

## Public Without a Wallet

- Template Plaza and search/filter
- Published Maker covers, creators, structure counts, and policy labels
- Docs and creator workflow
- Visible Sui/Walrus runtime health

## Wallet-Owned Actions

- My Souls handoff
- Local creator drafts and source assets
- Maker Walrus storage and Sui publication
- Maker archive/restore
- OC Walrus storage and Soulidity mint handoff

The wallet is the account. There is no separate Animacraft password or backend session.

## What Animacraft Owns

- Character Maker editor and player
- Part -> Item -> Layer x Color asset model
- Draft persistence and upload recovery
- Public Maker discovery and manifest hydration
- CreatorProfile, OCMaker, MakerTreasury, MakerAdminCap, and SoulMintAuthorization Move types
- Walrus quilts for Maker and OC files
- Required Part, registered Color, published order, selection-rule, palette-rule, and BCS recipe-hash enforcement
- Immutable creator license notes carried by the Maker manifest and finished OC package
- Immutable publication, archive/restore, Maker provenance, and policy snapshots
- Editable default Soul Character, Memory, and Skills & Docs files
- Versioned Maker manifest and OC package export

## What Animacraft Does Not Yet Own

- Premium-Part purchases and secondary-market settlement (optional Maker-wide native-USDC mint fees are implemented)
- Marketplace/Kiosk listing and resale
- Royalty or platform-fee settlement
- Fiat creator onboarding
- Moderation adjudication backend
- Agent runtime and post-mint memory evolution
- Game runtime and animation logic
- Soulidity identity, grants, collections, or broader market rules

Those capabilities may integrate later through explicit adapters. They must not appear as active controls before their contracts and user flows exist.

## Product Architecture

```text
Animacraft web app
  |- Public Template Plaza
  |- Wallet-owned Creator Studio
  |- Character Maker player
  `- My Souls handoff

Sui Mainnet
  |- CreatorProfile
  |- shared OCMaker
  `- ephemeral SoulMintAuthorization

Walrus Mainnet
  |- Maker source quilt + manifest
  `- finished OC image + profile + Living Content

Optional adapters
  |- Soulidity
  |- marketplace / Kiosk
  |- games
  `- campaigns and other wallets
```

## Pilot Acceptance

- A disconnected visitor can discover real published Makers.
- An invited creator can build, reload, preview, validate, recover, publish, archive, and restore a Maker without application support.
- A second wallet can use the shared Maker, obey its rules, prepare a final OC, and complete one canonical Soulidity mint.
- Published content cannot be silently changed or locally deleted.
- Every policy and revenue statement distinguishes recorded metadata from active economic settlement.
