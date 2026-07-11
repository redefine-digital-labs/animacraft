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

## Incident Response

1. Stop creator onboarding and Vercel promotion.
2. Publish a visible incident notice without exposing exploit details.
3. Archive affected Makers with their Cap holders where appropriate.
4. Reproduce against the recorded package and commit.
5. Review a fix, run all tests, and have the package multisig approve any upgrade.
6. Repeat the signed Mainnet smoke test and publish a post-incident report.

There is no protocol-wide hidden signer and no backend switch that can confiscate user assets. A web rollback does not undo Sui transactions or certified Walrus data.
