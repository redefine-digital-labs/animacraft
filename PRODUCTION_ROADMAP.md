# Animacraft Production Roadmap

Animacraft should become a fully on-chain character maker and creator platform:

- creators publish OC makers
- users create finished OCs from makers
- assets live on Walrus
- ownership, licenses, recipes, and creator royalty policy live on Sui
- the frontend is static and deployable on Vercel
- no backend signer or private database is required for core actions

## Phase 1: Static Production Shell

Status: implemented; Vercel production-domain promotion remains a deployment action.

Goal: make the app deployable and understandable for early creator onboarding.

- Deploy static app to Vercel.
- Configure `animacraft.soulidity.ai`.
- Show runtime network, Sui package, Walrus endpoints, and wallet state.
- Keep creator/editor/player flows usable without a backend.
- Publish open-source PR workflow and CI.

Done when:

- Vercel production URL works.
- Creator can open the workshop and build a draft maker.
- User can open a template and make a draft OC package.

## Phase 2: Sui + Walrus Write Path

Status: package published and source-verified; waiting for a signed real-Maker Mainnet smoke test and the separately reviewed Soulidity adapter.

Goal: replace local JSON export with wallet-signed on-chain writes.

Creator path:

1. Connect Sui wallet.
2. Create or load `CreatorProfile`.
3. Upload PNG layers, icons, cover sheets, and manifest JSON to Walrus.
4. Call Animacraft Move package in one PTB:
   - `new_oc_maker`
   - `add_part`
   - `add_color`
   - `add_item`
   - `add_selection_rule`
   - `add_palette_link`
   - `publish_maker`
   - `share_published_maker`
5. Store maker object id in browser state and URL.

Player path:

1. Open `/maker/:id`.
2. Resolve maker object and manifest blob ids.
3. Compose OC locally in browser.
4. Upload rendered OC image and profile JSON to Walrus.
5. Free pilot path: download the Soulidity Import Kit and complete the only Soul mint in Soulidity.
6. Canonical path: call Animacraft `authorize_soul_mint` or `authorize_soul_mint_paid<USDC>` and Soulidity's dedicated adapter in one PTB.
7. Open the wallet-owned result in My Souls and verify its Soulidity Soul/Kiosk objects and Walrus files.

Done when:

- A real creator can publish one maker from the browser.
- A real user can create one OC from that Maker and mint exactly one Soul in Soulidity.

## Phase 3: Event-Based Indexing Without a Backend

Status: implemented with Sui GraphQL publication events, object reads, and Walrus manifest hydration.

Goal: keep the core product backendless while making discovery useful.

Use:

- Animacraft events for Maker creation, publication, and Soul authorization.
- Soulidity events for canonical Soul creation, ownership, and trade.
- Sui object queries for Maker detail pages and Soulidity Soul detail pages.
- Walrus blob ids for visual payloads.
- Optional static snapshots for featured makers.

Avoid:

- private backend database as the source of truth
- server-side wallet keys
- admin-mediated publishing

Optional later:

- public indexer
- search cache
- analytics cache
- moderation queue

These can improve discovery but must not be required for ownership or licensing.

## Phase 4: Creator Economy

Goal: creator revenue and licensing become usable.

Add:

- paid templates
- paid parts
- commercial license add-ons
- remix terms
- creator royalty policy
- marketplace/Kiosk integration

Done when:

- creator can sell template access or premium parts
- user can buy/mint/use according to policy
- resale or commercial license actions preserve creator splits

## Phase 5: Open Ecosystem

Goal: Animacraft makers and OCs can be used by other products.

Add:

- public manifest schema
- adapter docs for Soulidity
- adapter docs for games
- adapter docs for wallets/marketplaces
- export/import compatibility for other OC tools

## Current Architecture Principle

If a feature needs state, choose in this order:

1. Sui object
2. Walrus blob
3. Sui event
4. signed local browser state
5. optional public indexer

Do not introduce a mandatory backend for core creation, publishing, or minting.
