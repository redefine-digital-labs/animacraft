# Animacraft Mainnet Smoke Test

This is the signed release runbook for invited creators. It is designed to produce reviewable evidence, not merely a successful-looking browser session.

## Roles

Use separate wallets. Never put seed phrases, private keys, or recovery exports in this repository, screenshots, CI, or issue comments.

| Role | Purpose | Minimum funds |
| --- | --- | --- |
| Protocol custody | holds Animacraft UpgradeCap/Publisher/Display custody; does not perform daily testing | SUI for custody changes only |
| Creator A | creates profile and Maker; owns MakerAdminCap; withdraws Treasury | SUI, WAL, small native USDC |
| Player B | browses publicly, creates an OC, and mints a Soul | SUI, WAL, native USDC for paid case |
| Buyer C | receives a transferred Cap and buys a listed Soul | SUI and native USDC |
| Negative-test D | optional disposable wallet for unauthorized actions | small SUI only |

Record only public addresses in the evidence table.

## Release Preconditions

- [ ] All release PRs are merged and CI is green.
- [ ] `npm ci`, `npm run check`, and `npm run move:test` pass from a clean checkout.
- [ ] `npm run preflight:mainnet` passes against the configured package.
- [ ] Animacraft original package is `0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea`.
- [ ] Runtime payment type is Circle native Sui USDC.
- [ ] Vercel Preview uses production-like CSP, headers, routes, and `public/config.js`.
- [ ] `animacraft.soulidity.ai` points to the reviewed deployment only after Preview acceptance.
- [ ] The repository has an approved open-source code license and separate creator-asset terms, so contributed art does not accidentally inherit the code license.
- [ ] UpgradeCap/Publisher/Display custody and emergency contacts are recorded outside the public repository.
- [ ] Soulidity adapter is deployed before testing canonical paid mint or verified provenance.

If the public Sui RPC has not indexed the package checkpoint yet, record the endpoint and observed checkpoint. Do not republish an already successful package transaction.

## Evidence Header

| Field | Value |
| --- | --- |
| Animacraft Git commit | |
| Soulidity Git commit | |
| Animacraft package ID | |
| Soulidity package ID | |
| Vercel deployment URL | |
| Production URL | |
| Creator A address | |
| Player B address | |
| Buyer C address | |
| Test start/end UTC | |

For every signed action, record transaction digest, object IDs created or mutated, expected balance delta, actual balance delta, and one explorer link.

## A. Public Read Path

1. Open a private/disconnected browser at the Template Plaza.
2. Confirm Maker covers, names, creator, license, price, Parts/Items count, and archived state render without a wallet.
3. Open a Maker detail and its Character Maker.
4. Confirm creator tools, local wallet-scoped drafts, upload, mint, archive, and withdrawal remain gated by wallet connection.
5. Test 390 x 844, 768 x 1024, 1280 x 720, and 1440 x 900. Record screenshots and confirm no horizontal overflow, clipped controls, or overlapping navigation.

Pass condition: public discovery is useful before login, while no write path can be reached without a wallet.

## B. Creator Publication

Using Creator A:

1. connect wallet and create/reuse one CreatorProfile;
2. create a small real Maker with at least two Parts, two Items per selectable Part, one required Last Bastion Part, one palette link, and one incompatibility rule;
3. upload every required Item x Layer x Color PNG cell and a picker icon;
4. edit default Soul Character, Memory, and Skills files;
5. close/reopen the browser and confirm IndexedDB draft and source Blobs recover under the same wallet;
6. prepare, register/upload, and certify one immutable Walrus Quilt;
7. publish the Maker and record the `OCMaker`, `MakerTreasury<USDC>`, `MakerAdminCap`, manifest Quilt ID, register digest, certify digest, and publish digest;
8. confirm Maker and Treasury are shared, Cap is owned by Creator A, and all three IDs cross-reference correctly;
9. confirm on-chain `payment_coin_type` is native USDC and the public page resolves the manifest from Walrus;
10. disconnect and verify the new Maker is still publicly discoverable.

Pass condition: one real creator can publish without an application backend or operator signer.

## C. Local And On-Chain Lifecycle

1. In a new local draft, delete an Item, optional Layer, Part, and the Maker itself; confirm source files and indexes are removed only from the wallet's local storage.
2. In the published Maker, confirm art, Parts, Items, Layers, Colors, rules, and manifest cannot be edited or deleted.
3. Archive with Creator A and confirm new authorization is blocked while the public page and existing Souls remain readable.
4. Restore and confirm minting is available again.
5. Attempt archive/configuration from Negative-test D; record the expected abort.

Pass condition: drafts are deletable; published history is immutable and uses archive/restore instead of deletion.

## D. Free Canonical Soul Mint

This section requires the reviewed Soulidity adapter. Using Player B:

1. select a complete recipe and render the final image;
2. register/upload/certify image, profile, Soul Character, Memory, and optional Skills on Walrus;
3. construct one PTB containing Animacraft free authorization and Soulidity canonical mint;
4. confirm the PTB creates exactly one Soul, SoulState, SoulContent, access list, and typed Animacraft provenance;
5. confirm the Soul is locked in Player B's personal Kiosk and no finished Animacraft token exists;
6. confirm recipe hash, Maker ID, Treasury ID, image/profile locators, payer, and policy snapshots match;
7. confirm Maker Treasury balance does not change.

Negative cases: mutate one recipe selection, omit Memory, use an archived Maker, or send provenance for another Soul. Each must abort without a Soul.

## E. Paid Canonical Soul Mint

Using Creator A, enable a small native-USDC mint price. Using Player B:

1. record Player B and Maker Treasury balances;
2. execute authorization and Soul mint in one PTB with the exact amount;
3. confirm one Soul is created and Treasury increases by exactly the configured price;
4. repeat with underpayment, overpayment, alternate coin type, and malformed required content;
5. confirm every failure creates no Soul and leaves the Treasury unchanged.

Pass condition: payment and canonical Soul mint are atomic.

## F. Cap Transfer And Revenue

1. Creator A changes future economics and withdraws a small amount; record Treasury totals and recipient balance.
2. Transfer or purchase the MakerAdminCap to Buyer C through the reviewed Soulidity Cap flow.
3. Confirm original `OCMaker.creator` provenance still names Creator A.
4. Confirm Creator A can no longer configure, archive, or withdraw.
5. Confirm Buyer C can configure future economics and withdraw remaining revenue.

Pass condition: Cap ownership controls administration and money; original art provenance does not change.

## G. Soul Resale Royalty

For each enabled tier used in the pilot, especially 0%, 1%, and 5%:

1. list Player B's Soul in Soulidity for a price large enough to avoid a rounded zero royalty;
2. record seller, buyer, platform, collection, and Maker Treasury balances;
3. buy with Buyer C through the Animacraft-aware purchase path;
4. confirm the seller receives exactly the listing price;
5. confirm platform/collection fees match Soulidity policy;
6. confirm Maker royalty is deposited exactly once into the provenance-linked Treasury;
7. confirm the ordinary Soul creator royalty is zero and no second royalty is paid to Player B;
8. confirm the Soul moves to Buyer C's personal Kiosk and stale grants are invalidated.

Negative edge: attempt a nonzero-tier listing below the minimum atomic price needed to produce one USDC atomic unit of royalty. The listing or purchase must be rejected before settlement; it must not silently waive the Maker royalty.

Bypass edge: submit the same Animacraft Soul and listing to Soulidity's ordinary solo and collection purchase entries without the typed provenance/Maker/Treasury inputs. Both must abort and leave the listing, Soul owner, payment coin, and Treasury unchanged.

Pass condition: the immutable Maker snapshot, not mutable web metadata, determines the royalty route.

## H. Failure And Recovery

- interrupt Maker upload after encode, register, and upload; confirm same-wallet resume works;
- switch wallet during recovery; confirm the session refuses to continue;
- alter a local file after encoding; confirm fingerprint/quilt mismatch forces a new upload;
- make Walrus aggregator, relay, GraphQL, and RPC individually unavailable; confirm readable errors and no false success state;
- feed an invalid manifest and a valid Maker with a non-USDC payment type; confirm each Maker is isolated/rejected without taking down the gallery;
- refresh every route directly, including `/maker/:id`, `/oc/:id`, and hash routes;
- confirm no private key, auth token, unpublished source image, or local draft enters Vercel logs or repository artifacts.

## Final Release Decision

| Gate | Result | Evidence link / digest |
| --- | --- | --- |
| Public disconnected gallery | | |
| Creator publication | | |
| Draft recovery and lifecycle | | |
| Free canonical Soul mint | | |
| Paid atomic mint | | |
| Cap transfer and withdrawal | | |
| Resale royalty | | |
| Responsive/browser QA | | |
| Independent Move review | | |
| Upgrade custody confirmed | | |

Do not describe the release as production-live while a required gate is blank. The invited creator pilot may launch with free Import Kit handoff only if it is visibly labeled unverified and paid mint, verified provenance, Cap sale, and resale royalty are disabled.
