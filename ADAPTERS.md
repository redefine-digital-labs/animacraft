# Animacraft ↔ Soulidity Integration Contract

Animacraft is the Character Maker editor and Maker protocol. Soulidity is the canonical finished-character, Living Content, social, and marketplace protocol. There is one finished asset: a Soulidity `Soul`. Animacraft does not mint a parallel `OCCharacter`.

## Ownership Boundary

- Animacraft is a separate package because `OCMaker`, `MakerAdminCap`, and `MakerTreasury<USDC>` are durable Maker infrastructure with their own ownership and economics.
- `authorize_soul_mint*` validates a frozen Maker recipe and, when enabled, settles its exact fee. It returns an ephemeral value; it creates no character object and grants no standalone ownership.
- Soulidity is the only package that creates the finished `Soul`, its required `SoulContent`, `SoulState`, and personal-Kiosk ownership.
- The production adapter belongs in Soulidity so it can call Soulidity's package-scoped mint internals. It depends on Animacraft's published original package ID and consumes the authorization in the same PTB.
- If authorization validation, payment, content creation, or Soul minting fails, the entire PTB aborts. There is no paid authorization or Treasury deposit without the corresponding Soul.

## Stable Animacraft Inputs

- Shared `OCMaker`, shared `MakerTreasury<USDC>`, and transferable `MakerAdminCap` object IDs.
- An `animacraft.creator-template.v3` Walrus manifest with Parts, Items, Layers, Colors, rules, and default Living Content. The browser certifies its Quilt before Maker publication; v3 stores bounded locator strings rather than a `Blob` object attestation.
- `animacraft.oc-package.v1` with rendered image reference, profile, canonical recipe/hash, and `animacraft.soulidity-import.v1` content mapping.
- `SoulMintAuthorization`, an ephemeral Move value with no abilities. It cannot be copied, stored, transferred, or dropped.
- Public `authorize_soul_mint`, `authorize_soul_mint_paid`, and `consume_soul_mint_authorization` functions. Soulidity must not parse private BCS layout as an API.

## Living Content ABI

The Maker manifest contains editable defaults. The final OC package resolves `{{OC_NAME}}`, `{{OC_WORLD}}`, and `{{OC_DESCRIPTION}}` and maps files to Soulidity's existing invariant slots:

| File | Soulidity kind | Slot name |
| --- | ---: | --- |
| `soul.md` | `KIND_SOUL_DOC` (`0`) | `soul` |
| `memory.md` | `KIND_MEMORY` (`1`) | `default` |
| `skills.zip` containing root `SKILL.md` | `KIND_SKILL` (`2`) | `SKILL.md` frontmatter `name` |

The editor creates valid defaults automatically. An OC-only creator can leave the page untouched. Editing Living Content changes the Maker manifest and therefore requires a new unpublished release.

## Canonical Mint PTB

The audited Soulidity adapter must build one programmable transaction:

1. Certify the rendered image, OC package, `soul.md`, `memory.md`, and `skills.zip` on Walrus. Soulidity consumes actual `Blob` objects for mandatory Living Content; Animacraft v3 binds image/profile Quilt patch locators as strings.
2. Call Animacraft `authorize_soul_mint` or `authorize_soul_mint_paid<USDC>` with the Maker recipe and those bounded locators.
3. For a paid Maker, exact native USDC moves into its Treasury. A later failure rolls the entire PTB back.
4. Consume the returned authorization through `consume_soul_mint_authorization`.
5. Call Soulidity's dedicated Animacraft mint entry, creating exactly one Soul and its mandatory initial content.
6. Store Maker ID, recipe hash, policy snapshot, and Treasury royalty destination as verified Animacraft provenance.
7. Finalize the Soul inside the user's personal Kiosk.

The current generic Soulidity `mint_imported_in_personal_kiosk` stores an unverified string origin. It is suitable for the temporary free Import Kit handoff, but it is not the final paid-Maker adapter and must not be presented as verified Animacraft provenance. The ZIP must be extracted first: `00-profile.json` enters Soulidity's generic parser, while the cover, Soul Character, Memory, and Skills files are uploaded in its Map Fields step.

The Import Kit intentionally supports free Makers only. It bypasses `SoulMintAuthorization`, so it cannot prove recipe validation on chain, collect a Maker fee, or establish verified royalty routing. Those capabilities switch on only after the dedicated Soulidity adapter is deployed.

## Royalty And Maker Rights

Soulidity Marketplace consumes the authorization's `RoyaltyPolicySnapshot` and calls Animacraft `deposit_resale_royalty` in the purchase PTB. Animacraft recomputes the exact 0%–5% amount from gross native-USDC sale value and deposits it into the Maker Treasury.

Soulidity may separately list `MakerAdminCap` as the transferable Maker management right. Cap escrow prevents settings changes and withdrawals while listed. Original creator provenance remains unchanged; current Cap ownership controls future settings and Treasury withdrawals.

## Deployment Order

1. Pin the published Animacraft original package ID, verify its recorded source tree, and secure its `UpgradeCap`.
2. Pin that original package ID in the Soulidity adapter dependency.
3. Implement the canonical Mint PTB, verified provenance, Cap escrow, and resale royalty settlement in Soulidity with its developers.
4. Run both repositories' tests and an independent Move review.
5. Publish Soulidity separately and secure its own `UpgradeCap`.
6. Configure both package IDs and run `npm run preflight:integration`.
7. Execute two-wallet Mainnet smoke tests for free mint, paid mint, Cap transfer, listing, purchase, and royalty withdrawal.

The exact Soulidity source changes, provenance schema, no-double-royalty rule, v3 limitations, and required tests are specified in [SOULIDITY_ADAPTER_HANDOFF.md](./SOULIDITY_ADAPTER_HANDOFF.md). Signed acceptance evidence follows [MAINNET_SMOKE_TEST.md](./MAINNET_SMOKE_TEST.md).

## Explicit Non-Goals

- Animacraft does not duplicate Soulidity Soul ownership, Kiosk, Marketplace, or social graphs.
- Soulidity does not edit Maker art, Parts, Items, Layers, palettes, or recipes.
- A browser redirect or Import Kit ZIP is a temporary free-Maker handoff, not proof of the audited paid adapter.
- No adapter receives a private key or backend signer.
