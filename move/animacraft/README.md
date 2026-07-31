# Animacraft Move Protocol

Animacraft is an independent Sui Move package for publishing Character Makers and authorizing canonical Soulidity mints. Walrus stores creative files; Sui stores Maker authority, pricing, revenue, composition rules, and policy snapshots. Soulidity owns the finished Soul.

Protocol version `4` preserves the v3 Maker/Treasury/AdminCap object layouts,
adds canonical Protocol Fee objects, and upgrades the non-droppable Soul mint
authorization ABI. The Commerce v5 module adds a per-release Root, exact Style
product registry, wallet-bound entitlements, completion policies, and Maker
resale without creating a finished-character object in this package.

## Three-Object Maker

- `OCMaker`: shared public template containing provenance, Walrus manifest, Parts, Items, Colors, rules, mint configuration, and license policy.
- `MakerTreasury<PaymentCoin>`: shared Maker-specific vault containing exact mint revenue, total collected, and total withdrawn.
- `MakerAdminCap`: transferable owned capability linked to exactly one Maker and Treasury. The holder can update economics, archive/restore, and withdraw revenue.

Production uses Circle native Sui Mainnet USDC as `PaymentCoin`. The generic type keeps unit tests independent of Mainnet and prevents a different coin from entering an existing typed Treasury. The contract can still instantiate another-coin Maker, so production discovery and the Soulidity adapter must reject any Maker whose stored payment type is not native USDC.

`CreatorProfile` records original creator provenance. It is not the source of current management authority after publication; Cap ownership is.

`SoulMintAuthorization` is an ephemeral value with no Move abilities. It contains validated Maker provenance, bounded Walrus Quilt patch locators, canonical recipe/hash, license/royalty snapshot, and mint-payment snapshot. It cannot be copied, stored, transferred, or dropped; a Soulidity adapter must consume it in the same PTB that creates the canonical Soul. Protocol v4 does not receive Walrus `Blob` objects and therefore does not independently attest locator certification.

## Commerce v5 Release Objects

After the immutable v4 publication is observable, the creator resumes a second,
checkpointed configuration sequence:

1. Consume the v4 `MakerAdminCap` into `MakerControlVaultV5` and create a paused
   `MakerRootV5`, `MakerTreasuryV5<PaymentCoin>`, and
   `MakerControlCapV5`.
2. Configure Base access and Base Complete policy.
3. Register every Expansion Pack and its access/Complete policy.
4. Register every exact `(Part, Item, Style)` as Base or as one Pack product.
5. Seal the Style registry permanently.
6. Activate the release.

The sequence is intentionally resumable and never reads mutable editor state
after the Walrus package has been prepared. Every new immutable Maker version
receives its own Root. Entitlements, counts, and Recipes stay pinned to that
release and survive ownership transfer of that release.

Before Commerce v5 can be enabled, protocol governance must bind exactly once:

- one independent, public, transparent Walrus Blob used only by logical
  `None` and Smart Color projection rows; it must not be a per-Maker Quilt
  patch;
- the defining `TypeName` of Soulidity's drop-only
  `AnimacraftSoulBindingProofV5`.

Enabling remains fail-closed until both dependencies are present. Each migrated
Root snapshots the canonical logical Blob, and publication recovery must read
it back exactly before the Root can become Active.

Exact Style rows have a Move-verified kind:

- `VISUAL` resolves its Blob from the immutable legacy Item. Its Seal
  requirement is derived from paid Base/Pack access and is never supplied by
  the browser.
- `LOGICAL_NONE` and `LOGICAL_COLOR` accept only their reserved identities,
  point to the canonical logical Blob, and are always public.

Sealing re-audits every stored row, Blob, Pack, row kind, and derived
protection bit before permanently freezing the registry.

## Publication PTB

1. Create or reuse `CreatorProfile`.
2. Call `new_managed_oc_maker<USDC>` to receive Maker, Treasury, and AdminCap.
3. Call the `admin_*` registration functions with that Cap.
4. Call `admin_publish_maker` with the certified Walrus Quilt Blob ID.
5. Call `share_managed_maker<USDC>` to share Maker and Treasury and return the Cap.
6. Transfer the returned Cap to the creator wallet and retain a newly created profile.

The old unguarded construction helpers are private to the module and unit tests. They cannot be called by browser PTBs.

## v4 Economics

- `minting_enabled` controls whether new Soulidity mint authorizations are accepted.
- `mint_fee_enabled` controls whether payment is required.
- `mint_price_atomic` is denominated in the Treasury coin's smallest unit. USDC uses six decimals.
- The canonical v4 paid authorization accepts an exact `Coin<PaymentCoin>`
  amount and splits it atomically between the Maker and Protocol Treasuries
  before Soulidity creates the Soul. This legacy path remains only for
  compatibility; production Commerce v5 uses the policy below.
- The canonical free authorization requires the same enabled `ProtocolFeeConfig`, so canonical minting is fail-closed until both packages are deployed and the protocol gate is explicitly enabled.
- The legacy v3 free and paid entries abort after upgrade, preventing callers from bypassing the integration gate or protocol split.
- If the later Soulidity mint fails, both Treasury deposits roll back with the whole PTB.
- Only the matching `MakerAdminCap` can withdraw Treasury funds.
- Resale royalty is `0` through `500` basis points in `50` basis-point steps.
- Every authorization snapshots the policy and mint price active at mint time.

Soulidity Marketplace calls `deposit_resale_royalty` in its Kiosk purchase PTB. Animacraft recomputes the exact amount from gross USDC price and the Maker tier, then deposits it into the same Treasury controlled by the current Cap holder. Arbitrary web metadata cannot enforce a royalty.

## Commerce v5 Economics

- Base access is free or one-time paid. Expansion Packs are free or one-time
  paid on-chain records; a free Pack needs no fake purchase receipt.
- Base and every used Pack independently enforce unlimited free,
  free-quota-then-paid, paid-every-time, or free-quota-then-block Complete
  behavior, plus an optional global cap.
- Primary creator charges split 90% to `MakerTreasuryV5` and 10% to
  `CommerceProtocolTreasuryV5`. A configured fixed Complete fee goes entirely
  to the protocol and is quoted separately.
- A Complete authorization commits the exact Recipe plus exact Style
  selections. Pack access cannot be bypassed by reusing an Item-level Recipe
  key with a different Style.
- The free entry aborts unless the recomputed total is zero. The paid entry
  requires an exact coin. Both mutate quotas and create the non-droppable
  authorization in the same transaction that Soulidity must consume.
- Maker resale requires `PAUSED`, no active listing, and an empty Maker
  Treasury. Listing consumes the current control cap; cancellation or purchase
  creates a new epoch-bound cap.
- Default Maker resale is seller 92.5%, protocol 2.5%, and original Maker
  creator 5%. Creator royalty is restricted to 0–5% in 0.5% steps and freezes
  when the exact Style registry is sealed; later operators cannot reduce it.
- Paid Base and Pack entitlements are permanent for their immutable
  `MakerRootV5`, wallet-bound, and remain valid after that Root is resold.

## Enforced Invariants

- Cap, Maker, and Treasury IDs must match.
- Payment coin type and exact amount must match the Maker configuration.
- Fee and mint-enabled flags cannot form an impossible state.
- Published art, Parts, Items, Colors, selection rules, palette rules, and Walrus manifest are immutable.
- A Commerce v5 Root cannot become active until at least one exact Style is
  registered and the registry is sealed; sealed bindings cannot be changed.
- A paid visual Style cannot be registered as public, while a real visual
  asset cannot enter through a logical-row entrypoint.
- A Complete output can bind to a Soul only once and only when the caller
  consumes the exact governance-bound Soulidity proof type in the same PTB.
- Base/Pack entitlements and Complete counts are stored on the Root, not trusted
  from browser state.
- Sale listing and administration cannot be active concurrently, and a Maker
  cannot be listed while revenue remains in its Treasury.
- Cap owner may update future mint economics and archive state; issued authorization snapshots remain unchanged.
- Recipes reference registered Parts, Items, Colors and render order, include required Parts, satisfy incompatibility/palette rules, and contain no duplicate Part.
- Recipe hash is recomputed as SHA-256 over canonical BCS `vector<RecipeSlot>`.
- Limits: 750 Parts, 5,000 Items, 1,000 rules, 32 Colors per Part, and bounded UTF-8 fields.

## Build And Test

```bash
sui move build
sui move test
```

The suite covers the legacy v4 invariants and Commerce v5 migration, exact
Style gating, Base/Pack entitlement, quota/cap enforcement, 90/10 settlement,
same-transaction non-droppable authorization, lifecycle transitions,
zero-balance resale, ownership epochs, tiered royalties, and bypass rejection.

Mainnet publication remains a manual multisig signature. Record the original package ID, transaction digest, publisher, CLI version, Git commit, and `UpgradeCap` custody.
