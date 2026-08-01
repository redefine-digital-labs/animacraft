# Animacraft

**The Fully Onchain Character Maker & Creator.**

Animacraft is a standalone, backendless Character Maker editor for artists and OC users. Creators build reusable Makers from layered PNG assets; users combine those Makers into an OC and continue to Soulidity for the single canonical Soul mint. Walrus stores creative files and Living Content, while Sui records Maker provenance, rules, rights, and revenue.

Animacraft and Soulidity are separate products, repositories, and Sui packages. They integrate through a reviewed mint authorization ABI; neither duplicates the other's asset model.

## Product Loop

1. Anyone can browse the public Template Plaza without a wallet.
2. A creator connects a Sui wallet, creates a local Maker draft, and defines `Part -> Item -> Style`; every Style directly owns one PNG and its independent transform on a global LayerTrack.
3. The browser persists draft metadata, source files, and upload checkpoints in IndexedDB.
4. The creator stores one immutable Maker quilt on Walrus, publishes the v4
   `OCMaker + MakerTreasury<USDC> + MakerAdminCap`, and completes the resumable
   Commerce v5 migration that seals exact Style-to-Base/Pack bindings before
   activating that release.
5. Every Maker includes editable Soul Character, Memory, and Skills & Docs defaults compatible with Soulidity content slots.
6. A user makes an OC, stores its rendered image and package on Walrus, and enters Soulidity's canonical mint flow. The final asset is a Soul, not a second Animacraft token.
7. Published art and composition rules cannot be silently edited. The current
   v5 control-cap owner may pause/restore the release, update future access and
   Complete policies while it is not active, withdraw revenue, or list the
   paused Maker for sale after its Treasury has been emptied.

## Commerce & Rights v5

Commerce v5 is a per-release, on-chain policy layer. It is implemented in this
repository but remains production-gated until the reviewed Animacraft and
Soulidity packages, shared objects, and runtime IDs have all passed Mainnet
preflight.

- A creator declares either `ONCHAIN_NATIVE` or `LICENSE_WRAPPED` when
  publishing. The declaration records the rights origin; both modes use the
  same on-chain payment, entitlement, authorization, and resale enforcement.
- Base access is `FREE` or `ONE_TIME_PAID`. A paid access pass is wallet-bound
  and permanent for that immutable release.
- An Expansion Pack is `FREE`, `ONE_TIME_PAID`, or required core content in the
  authoring model. A paid Pack pass is wallet-bound and remains valid for the
  purchased release after Maker ownership changes.
- Base and each Pack independently choose `UNLIMITED_FREE`,
  `FREE_QUOTA_THEN_PAID`, `PAID_EVERY_TIME`, or
  `FREE_QUOTA_THEN_BLOCK`, with an optional global Complete cap.
- Primary Base/Pack/Complete creator charges split 90% to that release's Maker
  Treasury and 10% to the Animacraft protocol. Any fixed Complete protocol fee
  is displayed separately.
- Maker resale is allowed only while paused and only after the Maker Treasury
  balance is zero. The default split is seller 92.5%, protocol 2.5%, and
  original Maker creator 5%. That original-creator percentage is frozen when
  the release's exact Style registry is sealed, so a later operator cannot
  reduce it.
- The Soul creator and Maker-source resale royalties are frozen when the
  canonical Soul is first minted. Their defaults are 2.5% each, configurable
  from 0% to 5% in 0.5% steps before mint, and cannot be reduced by a later
  holder. Soul resale also pays Soulidity's fixed 2.5% protocol fee; the two
  rights shares may total at most 10%, so the seller always receives at least
  87.5%.
- Purchases are final on-chain entitlements for one immutable release. The
  protocol exposes no refund path; the wallet reviews the exact USDC amount,
  Sui gas, and Walrus cost before signing.

Every paid Complete authorization and canonical Soul mint is designed as one
Sui programmable transaction. If authorization, payment, or minting fails, the
whole transaction rolls back; there is no partially paid OC.

## Composable Assets v6 Preview

Commerce & Rights v5 remains Animacraft's current production publication and
commercial contract. Composable Assets v6 is an additive preview attached to
one exact immutable v5 Maker release; it never rewrites the v5 Maker graph,
Recipe, Complete output, rights or fee snapshots.

v6 is intentionally limited to:

- a Fixed or Composable Profile;
- Maker-local Canvas, Layer Track, Slot, Rule and Renderer compatibility;
- Official, Certified and Open Item Products, all of which require exact
  technical validation;
- immutable Genesis Appearance and revisioned Current Appearance companions;
- optional independent Item ownership.

Official and Certified identify Maker endorsement. Open identifies compatible
content without Maker endorsement; it never means unchecked. Rental,
consumables, durability, enhancement, game attributes and Bundle Sale are not
implemented and have no placeholder product enum. Only the opaque
`extensionsHash` is reserved for a future reviewed schema.

Every v6 Walrus and Sui write gate is currently **OFF**. The production app
must not publish, sell, claim or equip v6 content on Mainnet until the paired
Animacraft/Soulidity packages, negative gate tests, testnet evidence and
independent review are approved. See
[Composable Assets v6](./COMPOSABLE_ASSETS_V6.md) for the exact model and gate
matrix.

## Maker Lifecycle Management

Creators open lifecycle management from **Creator Library → Manage status** or from the lifecycle badge in Creator Studio. One Maker card owns one stable editing root and lists every immutable Sui publication under that root instead of exposing historical releases as duplicate library cards.

- **Draft:** local and editable; it may be permanently deleted from this browser.
- **Publishing / Recoverable:** a Walrus or Sui release operation is active or has a resumable checkpoint.
- **Active:** the selected immutable Sui publication accepts Base/Pack
  purchases and new Complete authorizations when the global v5 release gate is
  also enabled.
- **Paused:** new authorizations are disabled while existing OCs, provenance, royalties, and released assets remain valid. Resuming restores the captured pre-pause mint settings when that snapshot is available.
- **Sale pending:** the paused release is listed on-chain, its current
  `MakerControlCapV5` has been consumed, and no concurrent administration is
  possible until cancellation or purchase mints the next epoch-bound cap.
- **Archived:** the publication remains on Sui and Walrus but is intentionally
  removed from active use; its current `MakerControlCapV5` holder may restore
  it.
- **Version draft:** an editable successor derived from a published snapshot. Publishing creates another immutable version without modifying previous OCs.

Every on-chain action re-reads the target release and live authority before
requesting a wallet signature, then waits until the resulting chain state is
observable. Each new immutable Sui publication receives a separate
`MakerRootV5`; the sealed Style registry, purchases, quotas, and Recipes remain
pinned to that release. Version publication also refreshes the creator's
complete `CreatorProfile.maker_ids` lineage, including publications whose
authority has since moved, and rejects a competing successor by Sui object
identity before opening the wallet. Historical versions remain independently
manageable from the same lifecycle dialog. Existing sibling forks are locked
in the client; an atomic on-chain successor lock and permanent retirement
remain deliberately unavailable until a reviewed protocol upgrade defines
their semantics.

## Bundled Creator Packs

Animacraft ships two first-party, AI-assisted original creator packs for launch QA and later on-chain publication:

- `Astral Courier · 星夜信使`
- `Hanamori Spirit · 花守灵契`

Each pack contains 25 public Items across six Parts and 5,120 default-rule combinations. Source atlases, prompt disclosure, and reproducible build notes live in `creator-packs/`; validated runtime manifests and `1024 x 1024` alpha PNG layers live in `public/makers/`. They are available only when local UI-test mode is explicitly enabled. Production Template Plaza never lists bundled or starter data: a pack appears publicly only after it is published as a real Sui `OCMaker` and hydrated from its certified Walrus manifest.

## Architecture

- **Vercel:** static Vite frontend, security headers, and route rewrites.
- **Sui Mainnet:** v4 publication objects plus per-release
  `MakerRootV5`, `MakerTreasuryV5`, a sealed exact Style registry,
  wallet-bound Base/Pack entitlements, lifecycle/listing state, and ephemeral
  canonical authorizations consumed by Soulidity in the same transaction.
- **Walrus Mainnet:** free public artwork, paid Style ciphertext, public icons
  and covers, the immutable Maker manifest, protected final-OC ciphertext,
  separate public OC previews, profile JSON, and Soulidity-compatible Living
  Content. Paid plaintext never enters a public Quilt.
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

Public configuration lives in `public/config.js`; `config.example.js` documents every field. Mainnet now calls the source-verified v6 package `0x2221610b5513ef3f926433229b7f0b565e850d56020e344266737cdca078af3b`. Type identities remain deliberately layered: the stable v3 publication TypeOrigin is `0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea`, the v4 fee TypeOrigin is `0xc1bbfe03cc93e27903e1ffd1a712745384cd537d6edadfb0e759bf6e090e53cc`, the v5 Commerce/Seal TypeOrigin is `0xcf369b8b02ac1e997146fc3be3f03870db14eaccf3d2cb7a9b93724be463108e`, and the latest callable is also the v6 Composition TypeOrigin. The v5 and v6 cores are initialized but disabled; their Soul bind-once proofs, canonical Soul gate, and Seal endpoints remain empty or off. Upgrade and initialization transactions, source trees, package digests, custody objects, validator policy, and every disabled gate are recorded in `deployments/mainnet.json`.

Before promoting the invited-creator release:

1. Verify `deployments/mainnet.json` against the explorer transaction and source-verification result.
2. Put the `UpgradeCap`, `Publisher`, and `Display<OCMaker>` under a documented custodian or multisig policy.
3. Run `npm run preflight:integration` against the production runtime.
4. Verify a Vercel Preview, wallet connection, Walrus WASM upload, public Maker discovery, and disconnected browsing.
5. Publish one small real Maker and verify its v4 objects plus v5 Root,
   Treasury, ControlCap/Vault, sealed Style registry, Base/Pack purchase,
   Complete quota/price, pause/restore, withdrawal, and sale/cancel/purchase
   lifecycle with separate wallets.
6. Publish the separately reviewed Soulidity adapter with Animacraft's stable
   original ID as `original-id` and the reviewed v4 upgrade as `published-at`.
7. Run one free and one paid same-transaction canonical Soul mint, then verify
   repeated resale evidence still pays the frozen Soul creator and original
   Maker-source royalties before enabling those claims in the UI.

## Versioned Outputs

- `animacraft.maker.v5`: authoritative versioned Maker graph with direct Style PNGs, independent Canvas transforms, z-only LayerTracks, ColorChannels, rules, ExpansionPack metadata, and Walrus asset index.
- `animacraft.maker-commerce.v5`: rights origin, Base and Pack access,
  per-wallet/global Complete policy, and immutable royalty inputs.
- `animacraft.maker-composable.v6`: optional companion profile, Maker-local
  compatibility contract, Item Product catalog and fallback Loadout. This
  output is preview-only while every v6 Mainnet write gate is OFF.
- `animacraft.oc-package.v2`: finished OC profile with the full v5 Recipe, immutable Maker version, Living Content, and its deterministic Sui RecipeSlot projection.
- `animacraft.creator-template.v3`, `animacraft.maker.v4`, and their editor drafts are intentionally not migrated into the simplified v5 authoring graph.
- `animacraft.living-content.v1`: editable Maker defaults for `soul.md`, `memory.md`, and `SKILL.md`.
- `animacraft.soulidity-import.v1`: exact Soulidity content-kind and slot-name mapping.
- Recipe JSON: exact selected Part, Item, registered Color, and published Part order. Move recomputes its SHA-256 BCS hash at mint.
- Rendered PNG: for Commerce v5 the exact final composition is encrypted before
  Walrus upload. Only its separate public preview is displayed until the
  canonical Soul receipt and owner-following Seal entitlement are verified.

## Current Boundary

Animacraft uses separate Creator Studio and Player Editor surfaces backed by
one Maker v5 model, rule engine, and Canvas renderer. The full requires,
hierarchy, and visibility graph is authoritative in the versioned Walrus
manifest; Move stores the compiled publication graph plus the Commerce v5
exact Style product registry needed to prevent Pack-gating bypasses.
Animacraft enforces publication, capability-based administration, Base/Pack
entitlements, Complete quotas and payments, recipe validity, Treasury
withdrawals, and Maker resale. Soulidity creates and owns the only finished
Soul, mandatory initial Living Content, Kiosk ownership, social identity,
listings, resale, and settlement. Its dedicated v5 integration route consumes
Animacraft's non-droppable authorization in the same PTB as the canonical Soul
mint; production keeps this route fail-closed until both reviewed upgrades and
shared fee objects are configured.

Creator Studio keeps `Parts & Items` as the persistent artwork workspace. Layer Tracks, Smart Color, Rules, Expansion Packs, and Preflight open as bounded tool dialogs over that workspace and close without losing the selected Part or layer. Draft text is flushed before Save, Undo, tool switching, and publication review. The Maker workspace follows the MyPage language setting for English, Chinese, Japanese, Korean, and Vietnamese; unknown low-level protocol diagnostics use a localized category message rather than hiding an error.

The approved Creator Studio composition is frozen at [PR #15 and merge commit `e3ba4f5`](./UI_BASELINE.md). Release work should complete and verify the existing controls without moving or expanding the primary product surface.

As of this release candidate, Mainnet discovery returns zero published Makers. That is intentionally shown as an honest creator-first empty state. Users cannot enter Player Editor from hidden examples, and `Make OC` becomes available only after selecting a verified on-chain Maker. Creator `Player test` is a separate draft-only path and unlocks after at least one actual PNG is available.

See [CREATOR_ASSET_SPEC_V5.zh-CN.md](./CREATOR_ASSET_SPEC_V5.zh-CN.md), [CREATOR_GUIDE.md](./CREATOR_GUIDE.md), [Composable Assets v6](./COMPOSABLE_ASSETS_V6.md), [DEPLOYMENT.md](./DEPLOYMENT.md), [PRODUCTION_STATUS.md](./PRODUCTION_STATUS.md), [SOULIDITY_ADAPTER_HANDOFF.md](./SOULIDITY_ADAPTER_HANDOFF.md), [MAINNET_SMOKE_TEST.md](./MAINNET_SMOKE_TEST.md), and [move/animacraft/README.md](./move/animacraft/README.md).
