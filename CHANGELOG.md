# Changelog

## 0.6.0 — Production Player export

- Rebuilds Player Part, Item, Style, and linked Smart Color controls around image-first selection with stronger visual and keyboard feedback.
- Adds an exact final-OC preview modal with standard/original sizing, current/transparent background export, Recipe JSON, and direct PNG download.
- Freezes the reviewed PNG, Recipe, profile, and Living Content together so Walrus publication uploads the exact image the player approved instead of re-rendering it.
- Publishes an explicit background-Part allowlist while stripping private editor extension data from immutable Maker manifests.
- Adds safe public Maker links and routes community actions to Soulidity without serializing wallet sessions, OC data, Soul memory, or local drafts.
- Localizes the complete Player export flow in English, Simplified Chinese, Japanese, Korean, and Vietnamese.

## 0.5.2 — Walrus certification visibility hotfix

- Stops reading and caching an uncertified Walrus Blob before its certification transaction.
- Clears the Walrus SDK object cache and performs bounded read-only state refreshes after an already-confirmed certification, without requesting another signature or broadcasting another transaction.
- Preserves uploaded checkpoints and certification digests so affected Maker and OC releases can resume after refresh without re-uploading or paying again.
- Distinguishes “certification succeeded; Blob state is syncing” from a failed chain action in the Creator and Player release modals across English, Chinese, Japanese, Korean, and Vietnamese.
- Verifies the refreshed Sui Blob object and Walrus Blob identity before advancing to the certified release stage.

## 0.5.1 — Mainnet publishing hotfix

- Moves the complete four-step Walrus + Sui Maker release workflow into an accessible, responsive modal with localized progress, recovery, fee confirmation, and safe diagnostics.
- Quotes the exact live Walrus upload-relay fee before the first signing step and raises the bounded client ceiling so production-size Maker quilts can be registered.
- Makes every Walrus and final Sui transaction resumable and idempotent with signed-byte checkpoints, per-upload CAS revisions, cross-tab locks, wallet/Maker identity guards, and explicit recovery review.
- Resolves the actual Mainnet WAL coin type from the staking ABI, verifies SUI/WAL balances before signing, and adds a live Mainnet relay-policy preflight.
- Bounds remote artwork by encoded bytes, decoded pixels, and an LRU bitmap budget so public Maker assets cannot exhaust the Player or Creator browser.
- Keeps obsolete recovery records recoverable or explicitly discardable without hiding large duplicate PNG blobs, and never removes the final publication checkpoint until the local Maker save is confirmed.

## 0.5.0 — Production-readiness candidate

- Completes the `Maker → Part → Item → Style → PNG` authoring model with independent Style transforms, global z-only Layer Tracks, deep-copy isolation, and one shared Renderer for Creator, Player, export, and publication.
- Completes Creator and Player controls for batch import, thumbnails, Canvas positioning, locks, Solo/dim/pixel inspection, Blend Modes, Smart Color, rules, Expansion Packs, Soul Configuration, Preflight, and version compatibility.
- Hardens local durability with CAS revisions, write-ahead recovery, version history, asset verification, explicit save states, and non-destructive legacy draft recovery.
- Publishes the complete Maker v5 rule space through deterministic projection v2, validates real PNG bytes before upload, enforces one-PTB limits, and recovers uncertain Sui publications without automatic duplicate signatures.
- Separates callable and original Sui package identities and adds the protocol-v4 gated canonical Soul authorization and native-USDC protocol Treasury.
- Completes production-visible English, Simplified Chinese, Japanese, Korean, and Vietnamese copy and accessibility labels.

This release remains fail-closed on Mainnet until the recorded Animacraft and Soulidity upgrades, shared protocol objects, marketplace retirement, and signed smoke test are complete.

## 0.4.0

- Establishes the first stable Maker v5 editor, Player Editor, non-destructive draft recovery center, and source-verified Animacraft Mainnet package baseline.
