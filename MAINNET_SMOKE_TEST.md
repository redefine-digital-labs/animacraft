# Animacraft Mainnet Smoke Test

This is the signed release runbook for invited creators. It is designed to produce reviewable evidence, not merely a successful-looking browser session.

## Current Expansion Pack v8 Pilot Decision

The current pilot has passed its Mainnet, Walrus, runtime-gate, and web
promotion gates:

| Gate | Current result | Evidence |
| --- | --- | --- |
| v8 Release | PASS — `ACTIVE`, `FREE` | `0x8c2af3a0c7eb4bfe88bf5ed9e7b56cb407edae12f672a3331a09e41d046e071b` |
| Activation | PASS | `8mw6HfPX1YHcfDwvgZbCNwawfUZHLHBMtYPQdSLcjdvv`, checkpoint `309818089` |
| Walrus | PASS — certified | Quilt `We3YHgglZfOpzffEyrxCB0dVNUS8ox5v8oSjJlb1QWE` |
| Parent authority lock | PASS | Root `PAUSED`, ownership epoch `1`, shared Authority bound |
| Runtime gates | PASS | v8 `true`; canonical Soul, Commerce, Composition, Physical, Complete-to-Soulidity, Complete bridge, and physical bridge `false` |
| Production web | PASS — promoted | `dpl_GDrUED8AwUfFsRRsSJ9Wzdi6zfW3` at `https://animacraft.soulidity.ai` |
| Wallet claim | PENDING | No controlled browser currently has both the ChatGPT control extension and a Sui wallet |
| Wallet-backed render | PENDING | Must follow and evidence the acceptance flow below |

The chain/storage/web pilot is production-live, but it is not fully end-to-end
accepted while either wallet row is pending. Do not use the completed ceremony
or a static page load as a substitute for a signed claim and verified render.

## Expansion Pack v8 Wallet Claim/Render Acceptance

Use a controlled browser profile with both the ChatGPT control extension and a
Sui wallet installed. If either extension is unavailable, stop and leave this
section `PENDING`; do not simulate a signature or transplant wallet state from
another browser.

1. Record the controlled-browser profile, both extension versions, production
   URL, promoted deployment ID, test start time, and expected Mainnet chain.
2. Open `https://animacraft.soulidity.ai` with a fresh cache and verify the live
   runtime exposes only `expansionPackV8ReleaseEnabled: true`. Confirm canonical
   Soul, Commerce v5, Composition v6, Physical v7, Complete-to-Soulidity,
   Complete, and physical bridge paths remain fail-closed.
3. Connect the designated Sui wallet on Mainnet and record only its public
   address. Confirm the UI resolves the exact ACTIVE/FREE Release and certified
   Quilt in the decision table, with no bundled or local-fixture fallback.
4. Start the FREE claim. In the wallet review, verify the network, caller, exact
   Release ID, zero purchase price, and expected v8 claim target before signing
   once. Record the transaction digest, checkpoint, and explorer link.
5. Read back the created wallet-owned `ExpansionPackPassV8`. Record its object
   ID, holder, Release ID, parent Root, parent ownership epoch (`1`), paid amount
   (`0`), and content commitment. Every field must match the active release and
   connected wallet.
6. Reload the production page and reconnect the same wallet. Confirm recovery
   finds the verified Pass and does not request a duplicate claim signature.
7. Enable that exact Pack in Player, fetch the canonical manifest and PNG from
   Quilt `We3YHgglZfOpzffEyrxCB0dVNUS8ox5v8oSjJlb1QWE`, and render the v8 Style.
   Confirm there is no stale-cache, placeholder, local fixture, ownership-epoch,
   or parent-`PAUSED` bypass.
8. Capture the rendered result and record its viewport, screenshot/artifact
   path, resolved manifest/asset identifiers, manifest and asset SHA-256 values,
   and any browser console errors. Reload once more and confirm the same Pass
   restores the same verified render without another signature.

Pass condition: one controlled real browser completes a single signed FREE
claim, verifies the exact wallet-bound Pass at epoch `1`, and renders the
certified v8 asset after reload. Any missing evidence field, wrong identity,
extra signature, fallback asset, or gate drift leaves wallet acceptance
`PENDING` or `FAIL` and blocks a full end-to-end claim.

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

## Legacy Full-Product Release Preconditions

The remaining sections are retained for the broader Maker/canonical Soul
release. Their unchecked gates do not reverse the completed v8 chain/storage/web
pilot, but they do prevent claiming those legacy surfaces or the whole product
as end-to-end accepted.

- [ ] All release PRs are merged and CI is green.
- [ ] `npm ci`, `npm run check`, and `npm run move:test` pass from a clean checkout.
- [ ] `npm run preflight:mainnet` passes against the configured package.
- [ ] Animacraft original package is `0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea`.
- [ ] The callable Animacraft package reports protocol version `4`; its source commit, upgrade digest, and UpgradeCap owner are recorded.
- [ ] The native-USDC `ProtocolFeeConfig`, `ProtocolTreasury`, and `ProtocolFeeAdminCap` cross-reference one another, the AdminCap still seals the original Publisher, and the integration gate starts disabled.
- [ ] Runtime payment type is Circle native Sui USDC.
- [ ] Vercel Preview uses production-like CSP, headers, routes, and `public/config.js`.
- [ ] `animacraft.soulidity.ai` points to the reviewed deployment only after Preview acceptance.
- [ ] The repository has an approved open-source code license and separate creator-asset terms, so contributed art does not accidentally inherit the code license.
- [ ] UpgradeCap/Publisher/Display custody and emergency contacts are recorded outside the public repository.
- [ ] Soulidity adapter is deployed before testing canonical mint or verified provenance.
- [ ] Soulidity's legacy `MarketConfig` is permanently paused and its legacy AdminCap is destroyed before any Animacraft Soul is minted.
- [ ] The successor `AnimacraftMarketConfig` starts with primary minting enabled only for the signed smoke test and secondary trading disabled until the bypass tests pass.

If the public Sui RPC has not indexed the package checkpoint yet, record the endpoint and observed checkpoint. Do not republish an already successful package transaction.

## Evidence Header

| Field | Value |
| --- | --- |
| v8 Release ID | `0x8c2af3a0c7eb4bfe88bf5ed9e7b56cb407edae12f672a3331a09e41d046e071b` |
| v8 activation transaction / checkpoint | `8mw6HfPX1YHcfDwvgZbCNwawfUZHLHBMtYPQdSLcjdvv` / `309818089` |
| v8 Walrus Quilt ID | `We3YHgglZfOpzffEyrxCB0dVNUS8ox5v8oSjJlb1QWE` |
| Parent Root lifecycle / ownership epoch / Authority ID | `PAUSED` / `1` / `0xc2b39910070116bc9614f4f55b6b1013377fc86ba6273630f5cee83111bd8e19` |
| Production / rollback deployment IDs | `dpl_GDrUED8AwUfFsRRsSJ9Wzdi6zfW3` / `dpl_7NwkGiWLh75AbZoaWH2FvjRqbqTY` |
| Runtime gate readback | v8 `true`; all canonical/Commerce/Composition/Physical/Complete bridges `false` |
| Controlled browser profile / version | |
| ChatGPT control extension version | |
| Sui wallet name / version / Mainnet network | |
| v8 claim wallet address | |
| v8 claim transaction / checkpoint / explorer link | |
| `ExpansionPackPassV8` object ID / holder / paid amount | |
| Pass Release ID / parent Root / ownership epoch / content commitment | |
| Manifest / asset identifiers and SHA-256 | |
| Render viewport / screenshot or artifact path | |
| Reload recovery result / extra signature count | |
| Browser console errors | |
| v8 wallet acceptance result / reviewer / UTC | `PENDING` / / |
| Animacraft Git commit | |
| Soulidity Git commit | |
| Animacraft original / callable / protocol-fee TypeOrigin package IDs | |
| Animacraft ProtocolFeeConfig / Treasury / AdminCap IDs | |
| Soulidity original / callable package IDs | |
| Soulidity legacy / Animacraft MarketConfig IDs | |
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
3. upload exactly one PNG for every public Style, confirm each Style's independent transform and LayerTrack binding, and optionally upload independent Part/Item thumbnails;
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
2. In the published Maker, confirm art, Parts, Items, Styles, LayerTrack order, Smart Colors, rules, and manifest cannot be edited or deleted.
3. Archive with Creator A and confirm new authorization is blocked while the public page and existing Souls remain readable.
4. Restore and confirm minting is available again.
5. Attempt archive/configuration from Negative-test D; record the expected abort.

Pass condition: drafts are deletable; published history is immutable and uses archive/restore instead of deletion.

## D. Free Canonical Soul Mint

This section requires the reviewed Soulidity adapter. Using Player B:

1. select a complete recipe and render the final image;
2. register/upload/certify image, profile, Soul Character, Memory, and optional Skills on Walrus;
3. enable the canonical Animacraft protocol gate, then construct one PTB containing the gated free authorization and Soulidity canonical mint;
4. confirm the PTB creates exactly one Soul, SoulState, SoulContent, access list, and typed Animacraft provenance;
5. confirm the Soul is locked in Player B's personal Kiosk and no finished Animacraft token exists;
6. confirm recipe hash, Maker ID, Treasury ID, image/profile locators, payer, and policy snapshots match;
7. confirm Maker Treasury balance does not change.

Negative cases: mutate one recipe selection, omit Memory, use an archived Maker, or send provenance for another Soul. Each must abort without a Soul.

## E. Paid Canonical Soul Mint

Using Creator A, enable a small native-USDC mint price. Using Player B:

1. record Player B and Maker Treasury balances;
2. execute authorization and Soul mint in one PTB with the exact amount;
3. confirm one Soul is created, the Protocol Treasury receives `floor(price × protocol_bps / 10_000)`, and the Maker Treasury receives the exact remainder;
4. repeat with underpayment, overpayment, alternate coin type, and malformed required content;
5. confirm every failure creates no Soul and leaves both Treasuries unchanged.

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
- close the tab before a Maker publication digest is checkpointed; confirm the saved creator + Manifest intent recovers the existing Maker and never requests an automatic duplicate signature;
- if no matching event can be found, confirm retry remains blocked until the operator explicitly clears the uncertain intent after checking the wallet and explorer;
- switch wallet during recovery; confirm the session refuses to continue;
- alter a local file after encoding; confirm fingerprint/quilt mismatch forces a new upload;
- make Walrus aggregator, relay, GraphQL, and RPC individually unavailable; confirm readable errors and no false success state;
- feed an invalid manifest and a valid Maker with a non-USDC payment type; confirm each Maker is isolated/rejected without taking down the gallery;
- refresh every route directly, including `/maker/:id`, `/oc/:id`, and hash routes;
- confirm no private key, auth token, unpublished source image, or local draft enters Vercel logs or repository artifacts.

## Legacy Full-Product Release Decision

| Gate | Result | Evidence link / digest |
| --- | --- | --- |
| Public disconnected gallery | | |
| Creator publication | | |
| Draft recovery and lifecycle | | |
| Free canonical Soul mint | | |
| Paid atomic mint | | |
| Cap transfer and withdrawal | | |
| Resale royalty | | |
| Legacy marketplace permanently retired | | |
| Responsive/browser QA | | |
| Independent Move review | | |
| Upgrade custody confirmed | | |

The v8 chain/storage/web pilot may be described as production-live with wallet
acceptance explicitly marked pending. Do not describe it as fully end-to-end
accepted until the wallet claim and wallet-backed render both pass with the
evidence above. Do not describe any canonical Soul, Commerce, Composition,
Physical, Complete-to-Soulidity, Complete bridge, or physical bridge surface as
live while its corresponding gate remains false or its legacy decision row is
blank. The invited creator pilot may launch with free Import Kit handoff only
if it is visibly labeled unverified and paid mint, verified provenance, Cap
sale, and resale royalty are disabled.
