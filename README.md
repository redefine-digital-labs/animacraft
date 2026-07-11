# Animacraft

**The Fully onchain Character Maker & Creator.**

Animacraft is a standalone, backendless Character Maker editor for artists and OC users. Creators build reusable Makers from layered PNG assets; users combine those Makers into an OC and continue to Soulidity for the single canonical Soul mint. Walrus stores creative files and Living Content, while Sui records Maker provenance, rules, rights, and revenue.

Animacraft and Soulidity are separate products, repositories, and Sui packages. They integrate through a reviewed mint authorization ABI; neither duplicates the other's asset model.

## Product Loop

1. Anyone can browse the public Template Plaza without a wallet.
2. A creator connects a Sui wallet, creates a local Maker draft, and defines `Part -> Item -> Layer x Color PNG` assets.
3. The browser persists draft metadata, source files, and upload checkpoints in IndexedDB.
4. The creator stores one immutable Maker quilt on Walrus and publishes `OCMaker + MakerTreasury<USDC> + MakerAdminCap` on Sui.
5. Every Maker includes editable Soul Character, Memory, and Skills & Docs defaults compatible with Soulidity content slots.
6. A user makes an OC, stores its rendered image and package on Walrus, and enters Soulidity's canonical mint flow. The final asset is a Soul, not a second Animacraft token.
7. Published art and composition rules cannot be silently edited. The current Cap owner may update future mint economics, withdraw revenue, archive/restore the Maker, or transfer the Cap through Soulidity.

## Bundled Creator Packs

Animacraft ships two first-party, AI-assisted original creator packs for launch QA and later on-chain publication:

- `Astral Courier · 星夜信使`
- `Hanamori Spirit · 花守灵契`

Each pack contains 25 public Items across six Parts and 5,120 default-rule combinations. Source atlases, prompt disclosure, and reproducible build notes live in `creator-packs/`; validated runtime manifests and `1024 x 1024` alpha PNG layers live in `public/makers/`. They appear as **Creator pack** entries in the Template Plaza. Canonical Soul mint remains locked until the pack is published as a real Sui `OCMaker` and hydrated from its certified Walrus manifest.

## Architecture

- **Vercel:** static Vite frontend, security headers, and route rewrites.
- **Sui Mainnet:** `CreatorProfile`, shared `OCMaker`, shared USDC `MakerTreasury`, transferable `MakerAdminCap`, registered recipe rules, and ephemeral `SoulMintAuthorization` values consumed by Soulidity.
- **Walrus Mainnet:** source PNGs, icons, Maker cover, manifest, rendered OC image, profile JSON, and Soulidity-compatible Living Content.
- **Sui GraphQL:** public discovery of `OCMakerPublished` events. No application database is required.
- **Wallet Standard:** every write and storage payment is signed by the creator or user. No private application signer exists.

## Local Development

Requires Node.js `20.19+` and a Mainnet-compatible Sui CLI for Move tests.

```bash
npm ci
npm run check
npm run move:test
npm run dev
```

`npm run check` runs config preflight, JavaScript syntax checks, the web/config integrity suite, and the Vite production build. `npm run move:test` runs the Move contract suite. Both suites pin the same canonical BCS recipe bytes and SHA-256 fixture.

## Runtime Configuration

Public configuration lives in `public/config.js`; `config.example.js` documents every field. Publishing and minting intentionally remain disabled while `packageId` contains `TODO`.

Before Mainnet activation:

1. Publish and verify `move/animacraft` on Sui Mainnet.
2. Put the `UpgradeCap` under a documented custodian or multisig policy.
3. Set the verified package id in `public/config.js`.
4. Run `npm run preflight:mainnet`.
5. Publish the reviewed Soulidity adapter against the pinned Animacraft package ID.
6. Run one free and one paid canonical Soul mint, then withdraw a small Treasury balance with the Cap wallet.
7. Redeploy and verify public event discovery, Walrus hydration, Cap discovery, archive/restore, and Soulidity collection handoff.

## Versioned Outputs

- `animacraft.creator-template.v3`: Maker manifest and Walrus asset index.
- `animacraft.oc-package.v1`: finished OC profile, recipe, policy, and chain intent.
- `animacraft.living-content.v1`: editable Maker defaults for `soul.md`, `memory.md`, and `SKILL.md`.
- `animacraft.soulidity-import.v1`: exact Soulidity content-kind and slot-name mapping.
- Recipe JSON: exact selected Part, Item, registered Color, and published Part order. Move recomputes its SHA-256 BCS hash at mint.
- Rendered PNG: final composition stored on Walrus before mint.

## Current Boundary

Animacraft enforces Maker publication, Cap-based administration, recipe validity, optional exact native-USDC fees, Treasury withdrawals, and immutable policy snapshots. Soulidity creates and owns the only finished Soul, mandatory initial Living Content, Kiosk ownership, social identity, listings, resale, and settlement. Paid mint remains disabled in the temporary file handoff until Soulidity consumes Animacraft's non-droppable authorization in one PTB.

See [CREATOR_GUIDE.md](./CREATOR_GUIDE.md), [DEPLOYMENT.md](./DEPLOYMENT.md), [PRODUCTION_STATUS.md](./PRODUCTION_STATUS.md), and [move/animacraft/README.md](./move/animacraft/README.md).
