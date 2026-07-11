# Soulidity Adapter Handoff

This document is the implementation contract between the independently managed Animacraft and Soulidity repositories. It describes the production adapter that still has to land in Soulidity. It is not a second minting protocol.

## Pinned Mainnet Identities

| Component | Mainnet identity |
| --- | --- |
| Animacraft original package | `0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea` |
| Animacraft module | `animacraft::animacraft` |
| Animacraft protocol version | `3` |
| Circle native Sui USDC | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` |
| Current Soulidity package | `0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0` |

Soulidity must pin the Animacraft **original package ID** as the type identity. If Animacraft is upgraded later, review the new published-at package separately; never silently follow an unreviewed upgrade.

## Verified Current Soulidity Baseline

The read-only compatibility audit on 2026-07-11 used the local Soulidity package whose `Published.toml` binds Mainnet package `0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0`. A clean temporary copy passed:

```bash
sui client verify-source --force --build-env mainnet --json move/soulidity
```

with Sui CLI `1.74.1-8fc60f1fa966`. The verified baseline exposes `mint_imported_in_personal_kiosk`, the private `mint_soul_in_personal_kiosk_impl`, `InitialContentEntry` with actual Walrus `Blob` values, solo/collection fixed-price purchase entries, typed Soul content invariants, and personal Kiosk custody described below. This proves the handoff targets the current Mainnet source, not that the future adapter diff has been reviewed or deployed.

## Non-Negotiable Boundary

- Animacraft owns `OCMaker`, `MakerTreasury<USDC>`, `MakerAdminCap`, recipe validation, Maker fees, and Maker royalty snapshots.
- Soulidity owns the only finished character object: `Soul`, `SoulState`, `SoulContent`, personal Kiosk custody, social identity, and Marketplace settlement.
- Animacraft must not mint an `OCCharacter`, NFT, or other parallel finished asset.
- Soulidity must consume `SoulMintAuthorization` and mint the Soul in the same PTB. The authorization has no abilities and therefore cannot be stored, copied, transferred, or dropped.
- A paid authorization and its Treasury deposit must abort if Soul minting aborts later in the PTB.
- Walrus registration and certification happen before the mint PTB. Their earlier storage transactions do not roll back when a later Soul mint fails.

## Stable Animacraft ABI

Soulidity should call public functions rather than decode private BCS layouts.

### Authorization producers

- `authorize_soul_mint(&OCMaker, name, profile_patch_id, image_patch_id, image_url, recipe_hash, recipe, &Clock, &TxContext)`
- `authorize_soul_mint_paid<USDC>(&OCMaker, &mut MakerTreasury<USDC>, Coin<USDC>, name, profile_patch_id, image_patch_id, image_url, recipe_hash, recipe, &Clock, &TxContext)`

Both return `SoulMintAuthorization`. The paid path accepts exactly `mint_price_atomic`; overpayment and underpayment abort.

### Authorization consumer

`consume_soul_mint_authorization` returns this tuple in order:

1. Animacraft protocol version (`u64`)
2. Maker ID (`ID`)
3. Maker Treasury ID (`ID`)
4. original Maker creator (`address`)
5. payer / Soul minter (`address`)
6. Soul name (`String`)
7. profile Quilt patch ID (`String`)
8. image Quilt patch ID (`String`)
9. image URL (`String`)
10. canonical recipe SHA-256 (`vector<u8>`)
11. `LicensePolicy`
12. `RoyaltyPolicySnapshot`
13. payment coin type (`String`)
14. mint price in atomic units (`u64`)
15. canonical `vector<RecipeSlot>`
16. authorization timestamp in milliseconds (`u64`)

The adapter must also use `royalty_policy_maker_id`, `royalty_policy_treasury_id`, and `royalty_policy_bps` instead of reading private fields.

## Soulidity Source Changes

Implement these changes in the Soulidity repository after coordinating with its maintainers.

### 1. Pin Animacraft

Add the reviewed Animacraft source revision as a Move dependency and bind Mainnet deployment replacement to the original package ID above. Commit both `Move.toml` and the resolved lockfile. A floating branch or tag is not acceptable for production.

### 2. Add verified provenance kind

Add `PROVENANCE_ANIMACRAFT = 3` and a package-visible accessor in `soul.move`. Do not reuse `PROVENANCE_IMPORTED`; that path deliberately stores an unverified human-readable origin.

### 3. Add a provenance module

Create a Soulidity-owned `AnimacraftProvenance` object linked one-to-one to a Soul. Freeze it after construction so later Marketplace calls can borrow immutable evidence without trusting a mutable operator. Its minimum fields are:

- Soul ID, Animacraft version, Maker ID, and Maker Treasury ID
- original Maker creator and payer
- profile patch ID, image patch ID, and image URL
- recipe hash and canonical recipe
- opaque `LicensePolicy` and `RoyaltyPolicySnapshot`
- payment coin type, mint price snapshot, and authorization timestamp

Emit an event containing the provenance object ID, Soul ID, Maker ID, and Treasury ID so indexers can resolve the link without an application database. Provide public read helpers and an `assert_matches_soul` helper. Do not expose mutation functions.

Add a one-time typed-provenance binding to `SoulState` without changing the layout of existing Mainnet states. The preferred compatible design is a package-owned dynamic field on the state's UID keyed by provenance kind and containing the frozen provenance object ID. `soul.move` should expose package-only bind/assert helpers and a public read helper. The Animacraft mint path binds kind `3` exactly once before the state is shared; generic imported mint cannot create this binding.

The provenance module may import Animacraft types, but it must not import `market`; this keeps the module graph acyclic. `market` may import the provenance module.

### 4. Add the canonical mint entry in `market.move`

The existing `mint_soul_in_personal_kiosk_impl` is private. Keep the actual adapter in Soulidity by adding a dedicated `mint_animacraft_in_personal_kiosk` function inside `market.move`, or expose only the minimum helper as `public(package)` and call it from a same-package adapter.

The preferred entry must:

1. consume `SoulMintAuthorization`;
2. require authorization version `3`;
3. require `payer == tx_context::sender(ctx)`;
4. require the authorization payment coin to equal Circle native Sui USDC;
5. verify the returned Maker and Treasury IDs match `RoyaltyPolicySnapshot` getters;
6. pass the authorization name and image URL into the Soul mint;
7. pass the authorization profile patch ID as the Soul origin reference, or leave `origin_ref` empty and rely on the typed provenance event;
8. mint with Soulidity provenance kind `3`;
9. set Soulidity's ordinary creator royalty to `0` for this path;
10. retain Soulidity's existing requirement for exactly one Soul document and at least one founding Memory Blob;
11. create and freeze exactly one `AnimacraftProvenance`, then bind its ID to the returned SoulState under typed provenance kind `3` before state finalization;
12. return/finalize the existing `SoulState` exactly as other Soulidity mint paths do.

Setting Soulidity's ordinary creator royalty to zero is intentional. Animacraft royalties belong to the Maker Treasury and its current Cap owner. Reusing Soulidity's creator royalty would pay the OC minter and then charge the Maker royalty again, causing the wrong beneficiary or double collection.

### 5. Add an Animacraft-aware purchase path

The current Soulidity fixed-price purchase sends creator royalty to the Soul creator address. Animacraft Souls need a dedicated path that:

- proves provenance Soul ID equals the listing Soul ID;
- reads the immutable Maker royalty tier from `RoyaltyPolicySnapshot`;
- includes that amount once in the purchase quote;
- splits the exact native-USDC royalty coin;
- calls `deposit_resale_royalty<USDC>` with the shared Maker, matching Treasury, gross listing price, and Soul ID;
- skips the Animacraft call when the tier is 0%;
- rejects a nonzero-tier listing or purchase when `floor(gross_sale_amount * royalty_bps / 10_000)` is zero; protocol v3 deliberately rejects a zero-value royalty deposit, so the Marketplace must enforce the corresponding minimum atomic listing price;
- preserves platform and optional collection royalties;
- leaves exactly the listing price for the seller;
- emits the Maker ID, Treasury ID, basis points, and royalty amount in purchase evidence.

Do not call both the existing Soul creator royalty and Animacraft Maker royalty for the same right.

This path must not be optional. Update both existing generic purchase entries, `buy_soul_fixed_price` and `buy_soul_fixed_price_with_collection`, to abort when the SoulState carries typed Animacraft provenance. Add corresponding Animacraft-aware solo and collection purchase entries that require the frozen provenance object, matching shared Maker, and matching Treasury. Otherwise a buyer could deliberately call the generic path and bypass the Maker royalty.

Soulidity's current internal `bps_amount` rounds platform/creator/collection fees up. Animacraft v3 recomputes Maker royalty with floor division in `deposit_resale_royalty`. Do not reuse `bps_amount` for Maker royalty: quote and split exactly `floor(gross_sale_amount * maker_royalty_bps / 10_000)`, while preserving Soulidity's existing rounding for its own fees. Deposit the Maker amount even when the seller also controls the Maker Cap so Treasury accounting remains canonical.

### 6. Add MakerAdminCap trading separately

Trading a Maker is trading its `MakerAdminCap`, not changing `OCMaker.creator`. Soulidity may add a dedicated Cap escrow/listing flow. While listed, the Cap is escrowed, so neither seller nor buyer can change economics or withdraw. After purchase, the buyer receives the Cap and controls future settings and Treasury withdrawals; original creator provenance remains unchanged.

## Canonical Mint PTB

The browser constructs one Sui PTB after all required Walrus objects are certified:

1. create Soulidity `InitialContentEntry` values from owned Walrus `Blob` objects for `soul.md`, `memory.md`, and optional `skills.zip`;
2. create any allowed Soulidity state-config entries;
3. call free or paid Animacraft authorization with the exact Maker recipe;
4. pass the returned authorization directly into Soulidity's Animacraft mint entry;
5. Soulidity consumes it, mints one Soul, binds content, locks the Soul in the user's personal Kiosk, and shares state/provenance;
6. finalize the PTB with no remaining authorization value.

The UI must not label a browser redirect, downloaded Import Kit, or `mint_imported_in_personal_kiosk` as verified Animacraft provenance.

## Known Protocol v3 Limits

These limits are explicit and must not be hidden in product copy:

- `profile_json_blob_id`, `image_blob_id`, Maker manifest IDs, and Item IDs are bounded locator strings. Animacraft v3 does not receive Walrus `Blob` objects and does not itself attest certification or bind a locator to a Blob object.
- Soulidity still receives and owns actual certified `Blob` objects for mandatory Living Content. The first adapter may treat the profile/image locators as authorization-bound provenance, but not as an on-chain Walrus certification proof.
- `LicensePolicy` fields are private and v3 has no public license getters. Soulidity can store the opaque snapshot, and royalty getters are available, but another Move package cannot yet branch on commercial/remix/attribution flags.
- The authorization binds name, image locator/URL, recipe, policy, and price, but not Soulidity's display description. Treat description as user-authored display metadata.
- Animacraft's generic `PaymentCoin` enforces one coin type per Maker but does not globally forbid third parties from creating another-coin Maker. Production Animacraft rejects every discovered Maker whose on-chain payment type is not configured native USDC; Soulidity must repeat that check on chain.
- Browser clients reject atomic prices outside JavaScript's exact integer range. Soulidity must still use `u64`/Move arithmetic directly and must never derive settlement amounts from formatted browser text.
- Item gate values `1` (paid add-on) and `2` (creator-only) are reserved but not enforced by v3 recipe authorization. Production publication is restricted to gate `0` (included); Soulidity must not infer paid-item entitlement from those reserved values.
- Visual Layer matrices and per-Layer composition order are committed in the immutable Maker manifest. The canonical on-chain recipe intentionally records one Part/Item/Color selection and Part render order per Part, not an independent record for every image Layer.

An additive Animacraft upgrade may later introduce public license getters and Blob-aware authorization. Do not make those changes in a hurried Mainnet upgrade; specify them, test migration compatibility, review independently, and sign through protocol custody.

## Required Contract Tests

Soulidity's adapter PR is not release-ready without tests for:

- free authorization creates exactly one provenance-kind-3 Soul;
- paid authorization increases the matching Maker Treasury by the exact amount;
- any later Soul/content failure rolls back the paid Treasury deposit;
- wrong payer, version, Maker, Treasury, coin type, amount, recipe hash, or required content aborts;
- one authorization cannot mint twice and cannot remain at PTB end;
- Soulidity creator royalty is zero for Animacraft Souls;
- both generic solo and collection purchase entries reject an Animacraft-bound Soul, so Maker royalty cannot be bypassed by choosing another public function;
- only the typed adapter can create the one-time SoulState provenance binding; imported provenance text cannot forge it;
- 0%, 1%, 2%, 3%, 4%, and 5% resale behavior, including floor rounding and clean rejection when a nonzero tier would round to zero;
- Animacraft-aware solo and collection purchases preserve Soulidity platform/collection rounding while depositing the exact floor-rounded Maker royalty;
- Maker royalty is deposited once and the seller receives exactly the listing price;
- provenance cannot be substituted across Souls;
- Cap transfer changes administration/withdrawal authority without rewriting provenance;
- archived Maker rejects new authorization while existing Souls remain tradable;
- generic imported mint remains visibly unverified and cannot forge typed Animacraft provenance.

## Activation Gate

Paid mint, verified Animacraft provenance, Maker resale royalty, and Maker Cap trading remain **not live** until the Soulidity adapter PR passes both repositories' tests, independent Move review, Mainnet deployment, and the evidence run in [MAINNET_SMOKE_TEST.md](./MAINNET_SMOKE_TEST.md).
