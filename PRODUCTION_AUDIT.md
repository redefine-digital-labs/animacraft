# Animacraft Production Audit

Audit target: five invited creators publishing real Character Makers and users making/minting OCs on Sui and Walrus Mainnet without an application backend.

## Decision

**Maker code candidate: pass. Canonical Soul mint activation: waiting for Animacraft publication, the reviewed Soulidity adapter, and signed smoke-test evidence.**

The Animacraft placeholder package id remains a hard write gate. A Vercel Preview may be deployed immediately; do not call paid Maker minting Mainnet-live until Soulidity consumes `SoulMintAuthorization` and the manual activation checklist in `PRODUCTION_STATUS.md` passes.

## End-to-End Model

1. A disconnected visitor browses public on-chain Makers and Docs.
2. A creator connects a wallet and creates a wallet-isolated local draft.
3. Each Part owns Items, Layers, Colors, icons, and its PNG matrix.
4. Composition Order only controls the final cross-Part stack.
5. Rules prevent incompatible selections; Last Bastion Parts remain required and rule-proof.
6. Preview Check validates metadata, structure, image cells, rules, palette links, limits, and policy.
7. Walrus prepare/register/upload/certify stages persist recovery checkpoints locally.
8. One Sui PTB creates or reuses a CreatorProfile, registers and shares the Maker and USDC Treasury, and transfers its AdminCap to the creator.
9. A user makes an OC and resolves the Maker's Living Content defaults into `soul.md`, `memory.md`, and `skills.zip`.
10. Animacraft validates the recipe and optional exact USDC payment, then Soulidity consumes the non-droppable authorization and creates the only finished Soul.

## Passed Controls

- Wallet connection gates every write workflow; no application key, mnemonic, signer, or backend database exists.
- Draft metadata, source files, and upload checkpoints live in IndexedDB and are namespaced by wallet and Maker.
- Public manifests are limited to 10 MB and validated for schema, canvas, duplicate identifiers, matrix completeness, asset references, rules, palettes, coordinates, and blend modes.
- Source images enforce PNG type, 20 MB per-file size, maximum dimensions, and the Maker canvas ratio.
- Walrus quilts enforce Blob inputs, unique 1-512 byte identifiers, 5,000 files, and 500 MB total size.
- Dynamic public names and labels are escaped; public URLs are restricted to HTTP(S); CSP blocks object/embed content and allows only required WASM execution.
- Published Makers are shared but cannot be publicly transferred or shared outside the defining Move module.
- Move rejects duplicate Items and Colors, oversized structures/strings, empty Part records, invalid Last Bastion rules, unregistered recipe Colors, forged Part order, forged BCS recipe hashes, palette/selection violations, and archived Maker mints.
- Published Maker content is immutable. Matching Cap authorization is checked for economics, withdrawal, and archive/restore; existing Soul rights/payment snapshots survive later changes.
- Thirty-one Node integrity/config tests and twenty-five Move tests currently pass; final syntax, diff, and production-build evidence is refreshed before each release PR.

## Remaining External Gates

- Publish and verify the package on Mainnet; document `UpgradeCap` custody.
- Implement and review Soulidity's dedicated Animacraft authorization entry without modifying its current generic-import guarantees.
- Configure the package id and run creator/user Mainnet transactions with real SUI and WAL.
- Confirm the production Vercel CSP with wallet connection and Walrus WASM upload in the deployed origin.
- Establish creator terms, reporting, takedown, and license-dispute operations.
- Obtain an independent Move review before unrestricted or high-value use.

## Known Launch Limits

- The browser publisher registers at most 450 Part + public Item + Color + selection rule + palette-link records in one PTB. Larger Makers require a future batched registration flow.
- Sui GraphQL and Walrus endpoints are external availability dependencies. A manual refresh, bounded Walrus read retry, and visible degraded state exist; production monitoring and dedicated Sui capacity are still required.
- Event discovery currently reads up to the 500 most recent published Maker IDs. That is sufficient for the invited pilot but requires an on-chain index or paginated catalog strategy before large-scale discovery.
- Exact native-USDC payment collection and withdrawal are implemented in the authorization path. Paid mint and secondary royalties remain disabled until Soulidity consumes that authorization in its reviewed Marketplace adapter.
- IndexedDB is local to one browser profile. Exported manifests and original source art remain the creator's responsibility; cross-device draft sync is not implemented.
- Mainnet storage defaults to 53 Walrus epochs, currently about two years. Certified files are immutable for that term but require a future signed extension to remain available beyond it.
- Move verifies the canonical recipe, not the pixels of the user-supplied rendered PNG. Consumers should treat the on-chain Part/Item/Color recipe as authoritative display provenance.
- Public Template Plaza and Maker-detail routes were exercised in the local in-app browser at `1280 x 720` and `390 x 844`. Direct hash routes, template-first ordering, sticky-header clearance, text clipping, and horizontal overflow passed. Wallet-signed creator and mint paths remain part of the required deployed Mainnet smoke test.
