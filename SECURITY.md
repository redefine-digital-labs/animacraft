# Security Policy

## Reporting

Do not open a public issue for an exploitable contract, wallet, payment, authorization, or asset-integrity problem. Send a private GitHub Security Advisory to the repository maintainers. Include affected commit/package IDs, reproduction steps, impact, and whether Mainnet funds or Cap ownership are at risk.

Never send a mnemonic, private key, session key, wallet export, or recovery phrase. Maintainers will never request one.

## Supported State

Only the latest tagged web release and the exact Git commit recorded with the active Mainnet package are supported. Until `public/config.js` contains verified package IDs and the signed Mainnet smoke test is recorded, the repository is a production candidate rather than a live protocol release.

## High-Risk Changes

The following require contract-owner review, passing Web and Move suites, a deployment diff, and explicit multisig sign-off:

- `OCMaker`, `MakerTreasury`, `MakerAdminCap`, `SoulMintAuthorization`, or policy layouts.
- Cap authorization, payment type, price, withdrawal, royalty, Soul binding, archive, or upgrade logic.
- Walrus retention and upload relay behavior.
- Runtime package IDs, USDC type, domains, CSP, and wallet transaction construction.
- Soulidity adapter dependencies or Marketplace settlement.

## Published Protocol v3 Boundaries

- Production publishers must register every Item with gate kind `0` (`included`). The package exposes reserved constants for paid add-on and creator-only Items, but v3 recipe authorization does not enforce either gate. The browser publisher and remote manifest validator reject those values; product copy must not advertise them as live access controls.
- Multiple visual Layers belong to a Part and are committed through the immutable Maker manifest. The on-chain recipe records one selected Item, Color, and Part render order per Part; it does not attest individual PNG pixels.
- A Maker's `PaymentCoin` type is fixed by its Treasury, but the generic package cannot prevent third parties from creating a Maker with another coin. The production browser rejects non-native-USDC Makers, and the Soulidity adapter must repeat that type check on chain.
- A valid Move `u64` can exceed JavaScript's exact integer range. The browser rejects Makers whose atomic mint price is not a non-negative safe integer or whose mint switches and price disagree; wallet signing must never proceed from a rounded display value.
- `LicensePolicy` fields are private in v3. Other Move packages can preserve the opaque snapshot and read royalty getters, but cannot yet execute commercial/remix/attribution flags on chain.
- Walrus IDs in v3 are bounded locator strings, not owned `Blob` objects. The Soulidity mint path must receive actual certified Living Content `Blob` objects separately.

Any future package upgrade must explicitly handle existing version-3 objects. Do not let new entry functions silently reinterpret old Maker, Treasury, Cap, policy, or authorization layouts. Specify migration/version assertions, test old-object compatibility, verify the upgrade source diff, and require protocol-custody approval before signing.

## Incident Response

1. Stop creator onboarding and Vercel promotion.
2. Publish a visible incident notice without exposing exploit details.
3. Archive affected Makers with their Cap holders where appropriate.
4. Reproduce against the recorded package and commit.
5. Review a fix, run all tests, and have the package multisig approve any upgrade.
6. Repeat the signed Mainnet smoke test and publish a post-incident report.

There is no protocol-wide hidden signer and no backend switch that can confiscate user assets. A web rollback does not undo Sui transactions or certified Walrus data.
