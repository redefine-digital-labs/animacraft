# Repository And Package Governance

Animacraft and Soulidity remain separate repositories and separate Sui packages. They coordinate through reviewed adapter interfaces and never share an `UpgradeCap`.

## GitHub Controls

- Keep at least two trusted organization Owners with hardware-backed 2FA.
- Protect `main` with pull requests, required checks, conversation resolution, CODEOWNERS review, and no force pushes or branch deletion.
- Require two approving reviews for contract, runtime-config, deployment, and workflow changes once a second maintainer is available.
- Do not let the author be the only approval for a release that changes Move or wallet transactions.
- Use signed release tags and attach package IDs, transaction digests, test evidence, and source commit.
- GitHub administration is role-based review, not cryptographic multisig. Do not describe it as chain multisig.

## Chain Controls

- Animacraft `UpgradeCap`: dedicated Animacraft Sui multisig.
- Soulidity `UpgradeCap`: separate Soulidity Sui multisig.
- Recommended initial policy: 2-of-3 signers, with keys on separate hardware devices and at least two physical locations.
- A signer must not approve an upgrade they have not matched to the reviewed Git commit and Move build.
- Maker revenue is not held by the protocol multisig. It is held per Maker and controlled by that Maker's transferable `MakerAdminCap`.

## Release Record

Every Mainnet release records:

- repository and commit SHA
- Sui CLI version and dependency lock files
- original and upgraded package IDs
- publish/upgrade transaction digest
- `UpgradeCap` object ID and multisig address
- Web and Move test results
- Vercel deployment URL and production domain
- signed creator, paid-mint, withdrawal, Soul binding, listing, purchase, and royalty smoke-test object IDs

## Repository Boundary

Animacraft changes may document a proposed Soulidity adapter, but must not push changes to the Soulidity repository without coordination with its developers. Soulidity pins a verified Animacraft package dependency only after Animacraft is published.
