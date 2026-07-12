# Animacraft Move Protocol

Animacraft is an independent Sui Move package for publishing Character Makers and authorizing canonical Soulidity mints. Walrus stores creative files; Sui stores Maker authority, pricing, revenue, composition rules, and policy snapshots. Soulidity owns the finished Soul.

Protocol version `4` preserves the v3 Maker/Treasury/AdminCap object layouts, adds canonical Protocol Fee objects, and upgrades the non-droppable Soul mint authorization ABI. There is no finished-character object in this package.

## Three-Object Maker

- `OCMaker`: shared public template containing provenance, Walrus manifest, Parts, Items, Colors, rules, mint configuration, and license policy.
- `MakerTreasury<PaymentCoin>`: shared Maker-specific vault containing exact mint revenue, total collected, and total withdrawn.
- `MakerAdminCap`: transferable owned capability linked to exactly one Maker and Treasury. The holder can update economics, archive/restore, and withdraw revenue.

Production uses Circle native Sui Mainnet USDC as `PaymentCoin`. The generic type keeps unit tests independent of Mainnet and prevents a different coin from entering an existing typed Treasury. The contract can still instantiate another-coin Maker, so production discovery and the Soulidity adapter must reject any Maker whose stored payment type is not native USDC.

`CreatorProfile` records original creator provenance. It is not the source of current management authority after publication; Cap ownership is.

`SoulMintAuthorization` is an ephemeral value with no Move abilities. It contains validated Maker provenance, bounded Walrus Quilt patch locators, canonical recipe/hash, license/royalty snapshot, and mint-payment snapshot. It cannot be copied, stored, transferred, or dropped; a Soulidity adapter must consume it in the same PTB that creates the canonical Soul. Protocol v4 does not receive Walrus `Blob` objects and therefore does not independently attest locator certification.

## Publication PTB

1. Create or reuse `CreatorProfile`.
2. Call `new_managed_oc_maker<USDC>` to receive Maker, Treasury, and AdminCap.
3. Call the `admin_*` registration functions with that Cap.
4. Call `admin_publish_maker` with the certified Walrus Quilt Blob ID.
5. Call `share_managed_maker<USDC>` to share Maker and Treasury and return the Cap.
6. Transfer the returned Cap to the creator wallet and retain a newly created profile.

The old unguarded construction helpers are private to the module and unit tests. They cannot be called by browser PTBs.

## Economics

- `minting_enabled` controls whether new Soulidity mint authorizations are accepted.
- `mint_fee_enabled` controls whether payment is required.
- `mint_price_atomic` is denominated in the Treasury coin's smallest unit. USDC uses six decimals.
- The canonical v4 paid authorization accepts an exact `Coin<PaymentCoin>` amount and splits it atomically between the Maker and Protocol Treasuries before Soulidity creates the Soul. The default protocol share is 5,000 bps (50%), capped at 50%; floor rounding goes to the protocol and the exact remainder goes to the Maker.
- The legacy v3 paid entry aborts after upgrade, preventing callers from bypassing the protocol split.
- If the later Soulidity mint fails, both Treasury deposits roll back with the whole PTB.
- Only the matching `MakerAdminCap` can withdraw Treasury funds.
- Resale royalty is `0`, `100`, `200`, `300`, `400`, or `500` basis points.
- Every authorization snapshots the policy and mint price active at mint time.

Soulidity Marketplace calls `deposit_resale_royalty` in its Kiosk purchase PTB. Animacraft recomputes the exact amount from gross USDC price and the Maker tier, then deposits it into the same Treasury controlled by the current Cap holder. Arbitrary web metadata cannot enforce a royalty.

## Enforced Invariants

- Cap, Maker, and Treasury IDs must match.
- Payment coin type and exact amount must match the Maker configuration.
- Fee and mint-enabled flags cannot form an impossible state.
- Published art, Parts, Items, Colors, selection rules, palette rules, and Walrus manifest are immutable.
- Cap owner may update future mint economics and archive state; issued authorization snapshots remain unchanged.
- Recipes reference registered Parts, Items, Colors and render order, include required Parts, satisfy incompatibility/palette rules, and contain no duplicate Part.
- Recipe hash is recomputed as SHA-256 over canonical BCS `vector<RecipeSlot>`.
- Limits: 750 Parts, 5,000 Items, 1,000 rules, 32 Colors per Part, and bounded UTF-8 fields.

## Build And Test

```bash
sui move build
sui move test
```

The suite currently contains 31 tests, including Cap mismatch rejection, non-droppable Soul authorization consumption, tiered royalties, exact 50/50 payment splitting, old-entry bypass rejection, both Treasury withdrawals, post-publication economics, archive behavior, rule validation, and the shared web/Move BCS hash fixture.

Mainnet publication remains a manual multisig signature. Record the original package ID, transaction digest, publisher, CLI version, Git commit, and `UpgradeCap` custody.
