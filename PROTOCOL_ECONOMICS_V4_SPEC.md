# Animacraft Protocol Economics v4

## Goal

Add a transparent protocol share to paid Maker-to-Soul mints without changing the
layout or identity of existing Mainnet `OCMaker`, `MakerTreasury`, or
`MakerAdminCap` objects. Soulidity remains the only package that creates a
finished Soul.

## Economics

- Free Maker authorization remains free.
- A paid Maker mint accepts exactly the Maker's configured native-USDC price.
- The default primary protocol share is 5,000 bps (50%).
- Protocol governance may lower or restore the share, but cannot set it above
  5,000 bps.
- The protocol share uses floor division. The Maker Treasury receives the exact
  remainder, so no atomic unit is lost and the two deposits always equal the
  gross mint price.
- Soulidity's secondary-sale platform fee remains independently 250 bps (2.5%).
- A Maker's 0% or 1%-5% resale royalty is additional and is deposited once into
  the matching Maker Treasury by the Soulidity Animacraft purchase path.

## New Objects

- `ProtocolFeeConfig`: shared object containing the canonical Protocol Treasury
  ID, primary mint fee bps, and enabled state.
- `ProtocolTreasury<PaymentCoin>`: shared coin-typed vault containing protocol
  primary-mint revenue and accounting totals.
- `ProtocolFeeAdminCap`: transferable governance authority for config updates
  and protocol revenue withdrawals.

The post-upgrade initializer requires the existing Animacraft `Publisher`. The
canonical object IDs must be recorded in `deployments/mainnet.json` and the web
runtime configuration after the signed initialization transaction.

## Compatibility And Bypass Prevention

- Existing v3 Maker object layouts remain unchanged.
- Protocol version becomes `4`; new authorizations snapshot version `4`.
- The legacy paid authorization entry aborts after the upgrade.
- The new paid entry requires the canonical config and matching typed Protocol
  Treasury, then deposits both shares before returning the non-droppable
  `SoulMintAuthorization`.
- Any later Soulidity failure aborts the whole PTB and rolls back both deposits.
- Free authorization remains available without Protocol Fee objects.

## Acceptance

1. A 1,500,001 atomic-unit paid mint at 5,000 bps deposits 750,001 into the
   Maker Treasury and 750,000 into the Protocol Treasury.
2. Maker and protocol accounting totals equal the corresponding balances.
3. The AdminCap holder can lower the fee but cannot exceed 5,000 bps.
4. A wrong config, wrong Protocol Treasury, disabled config, wrong payment
   amount, or legacy paid entry aborts.
5. Maker and protocol withdrawals require their respective Cap objects.
6. Existing free mint, recipe, archive, royalty, and Maker lifecycle tests pass.
7. Browser configuration keeps canonical mint disabled until both v4 protocol
   objects and the reviewed Soulidity adapter are deployed and recorded.

## Deployment Gate

Code and tests may be merged before activation. Mainnet activation still
requires human signatures for:

1. upgrading the original Animacraft package;
2. initializing the canonical v4 Protocol Fee objects with native USDC;
3. upgrading Soulidity with the pinned Animacraft adapter;
4. confirming Soulidity secondary platform fee remains 250 bps;
5. recording object IDs and enabling the browser release gate only after a
   signed free and paid end-to-end evidence run.
