# Animacraft

**The Fully onchain Character Maker & Creator.**

Animacraft is a standalone, backendless Character Maker editor for artists and OC users. Creators build reusable Makers from layered PNG assets; users combine those Makers into an OC and continue to Soulidity for the single canonical Soul mint. Walrus stores creative files and Living Content, while Sui records Maker provenance, rules, rights, and revenue.

Animacraft and Soulidity are separate products, repositories, and Sui packages. They integrate through a reviewed mint authorization ABI; neither duplicates the other's asset model.

## Product Loop

1. Anyone can browse the public Template Plaza without a wallet.
2. A creator connects a Sui wallet, creates a local Maker draft, and defines `Part -> Item -> Variant -> LayerBinding` assets on global LayerTracks.
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

Public configuration lives in `public/config.js`; `config.example.js` documents every field. The source-verified Mainnet package is `0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea`; its transaction, package digest, source tree, and custody objects are recorded in `deployments/mainnet.json`.

Before promoting the invited-creator release:

1. Verify `deployments/mainnet.json` against the explorer transaction and source-verification result.
2. Put the `UpgradeCap`, `Publisher`, and `Display<OCMaker>` under a documented custodian or multisig policy.
3. Run `npm run preflight:integration` against the production runtime.
4. Verify a Vercel Preview, wallet connection, Walrus WASM upload, public Maker discovery, and disconnected browsing.
5. Publish one small real Maker and verify its Maker, Treasury, Cap, archive/restore, and withdrawal lifecycle with separate wallets.
6. Publish the separately reviewed Soulidity adapter against the pinned Animacraft original package ID.
7. Run one free and one paid canonical Soul mint plus resale evidence before enabling those claims in the UI.

## Versioned Outputs

- `animacraft.maker.v4`: authoritative versioned Maker graph, fixed Canvas transforms, LayerTracks, ColorChannels, rules, ExpansionPack metadata, and Walrus asset index.
- `animacraft.oc-package.v2`: finished OC profile with the full v4 Recipe, immutable Maker version, Living Content, and its deterministic Sui RecipeSlot projection.
- `animacraft.creator-template.v3` and `animacraft.oc-package.v1`: read/migration compatibility for Makers and recovery drafts created before the v4 editor.
- `animacraft.living-content.v1`: editable Maker defaults for `soul.md`, `memory.md`, and `SKILL.md`.
- `animacraft.soulidity-import.v1`: exact Soulidity content-kind and slot-name mapping.
- Recipe JSON: exact selected Part, Item, registered Color, and published Part order. Move recomputes its SHA-256 BCS hash at mint.
- Rendered PNG: final composition stored on Walrus before mint.

## Current Boundary

Animacraft uses separate Creator Studio and Player Editor surfaces backed by one Maker v4 model, rule engine, and Canvas renderer. The full requires, hierarchy, and visibility graph is authoritative in the versioned Walrus manifest; the current Move object keeps an explicitly labelled compatibility projection of the subset it can index. Animacraft enforces Maker publication, Cap-based administration, recipe validity, optional exact native-USDC fees, Treasury withdrawals, and immutable policy snapshots. Soulidity creates and owns the only finished Soul, mandatory initial Living Content, Kiosk ownership, social identity, listings, resale, and settlement. Its dedicated integration route consumes Animacraft's non-droppable authorization in the same PTB as the canonical Soul mint; production keeps this route fail-closed until both reviewed upgrades and shared fee objects are configured.

See [CREATOR_ASSET_SPEC_V4.zh-CN.md](./CREATOR_ASSET_SPEC_V4.zh-CN.md), [CREATOR_GUIDE.md](./CREATOR_GUIDE.md), [DEPLOYMENT.md](./DEPLOYMENT.md), [PRODUCTION_STATUS.md](./PRODUCTION_STATUS.md), [SOULIDITY_ADAPTER_HANDOFF.md](./SOULIDITY_ADAPTER_HANDOFF.md), [MAINNET_SMOKE_TEST.md](./MAINNET_SMOKE_TEST.md), and [move/animacraft/README.md](./move/animacraft/README.md).
