# Changelog

## 0.7.1 — Player Smart Color palette

- Promotes creator-linked Smart Color channels to a first-level Player palette beside the Part tabs, while keeping Layer Tracks and link management creator-only.
- Shows only color channels used by the current resolved OC, including the number of visible linked Styles affected by each choice.
- Applies one preset selection to every linked Style through the canonical Recipe path, including Renderer updates, Undo/Redo, autosave, recovery, preview, PNG export, and publication snapshots.
- Adds image-first swatches, persistent current-color feedback, roving keyboard navigation, 44px touch targets, forced-colors support, and responsive mobile layouts.
- Preserves long palette and Part-rail scroll positions across live rerenders and bounds full-resolution gradient-map canvases with a 16-megapixel LRU budget for complex mobile artwork.
- Localizes the complete palette flow in English, Simplified Chinese, Japanese, Korean, and Vietnamese.
- Busts cached Player assets so production browsers receive the new controls without requiring a manual hard refresh.

## 0.7.0 — Maker lifecycle management

- Adds one responsive, accessible Maker lifecycle manager to both Creator Library cards and the Creator Studio toolbar.
- Covers Draft, Publishing, Recoverable, Active, Paused, Archived, and Version draft states while keeping the editable workspace distinct from its immutable published chain version.
- Revalidates the current MakerAdminCap before every pause, resume, archive, and restore transaction, then reads the Maker back from Sui before reporting success.
- Preserves each paid Maker's pre-pause mint settings in the durable Workspace so Resume restores its fee configuration; an unavailable legacy snapshot is explicitly resumed as free instead of guessed.
- Groups every immutable Sui publication under one stable Maker card, persists the history in Workspace v6, and lets the current Cap holder manage each historical version independently without replacing the active editor.
- Selects the current chain version deterministically across out-of-order discovery while retaining a verified local binding and never allowing a historical object to overwrite a successor draft.
- Refreshes both the creator's immutable `CreatorProfile.maker_ids` lineage and currently owned AdminCaps immediately before publication, so transferred Caps and same-name cross-device successor drafts cannot hide a competing on-chain version.
- Detects already-forked sibling publications by Sui object identity and locks further version publication until the lineage is reconciled; a protocol-level atomic successor lock remains reserved for a later Move upgrade.
- Lets creators begin a compatible next-version workspace, reopen publication recovery, or discard only the unpublished version while preserving the released Maker and upload checkpoints.
- Keeps permanent retirement protocol-locked and explanatory instead of exposing an irreversible or misleading browser action.
- Localizes the complete lifecycle flow in English, Simplified Chinese, Japanese, Korean, and Vietnamese, including keyboard focus management and mobile layouts.

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
