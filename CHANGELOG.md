# Changelog

## 0.8.4 — Creator Import, Rules and Cover Reliability

- Rebuilds the combination-rule and Style visibility-condition pickers as collapsed Part groups in a readable two-column layout with fixed-size controls, one modal scroll surface, live Player-result preview, and reliable return to the current Style.
- Separates batch PNG import into explicit Item creation and Style creation flows, with one reviewed mapping card per file, editable names, destination scope, inherited Layer Track, and independent records.
- Moves Duplicate/Delete controls onto every Part, Item, and Style; exact-record actions now deep-copy all visual and rule parameters while re-keying editor identities so later edits cannot leak back to the source.
- Verifies Maker cover Blob bytes after the atomic Workspace save, reports processing/saving/saved/error states, and makes the configured manifest cover authoritative in the public on-chain gallery and Sui publication summary.
- Adds complete five-language import and cover-save copy plus behavior, persistence, publication, accessibility, layout, and browser regression coverage.

## 0.8.3 — Docs Single-Scroll Navigation

- Splits the public handbook into a concise `#docs` home with searchable article cards and stable `#docs/<article-id>` detail routes.
- Makes every guide directly linkable, refresh-safe, and compatible with browser back/forward navigation while preserving the current five-language content and visual explanations.
- Removes nested Docs navigation scrollers so the handbook uses one browser-controlled page scroll across desktop and mobile.
- Keeps production architecture and protocol references on the Docs home while giving each article a focused reading surface with localized back, previous, and next navigation.

## 0.8.2 — Visual Docs Guides

- Adds nine reusable, localized visual explanations across twelve high-value handbook articles, covering Maker hierarchy, Player choices, full-canvas alignment, import decisions, Layer Tracks, Smart Color, Rules, Walrus/Sui publication, and Soul data boundaries.
- Uses current 1024×1024 Maker layers to demonstrate real alignment and composition behavior while explicitly labeling AI-assisted fixture artwork as a technical example rather than an aesthetic standard.
- Keeps every diagram on one controlled, injection-safe structure with complete English, Simplified Chinese, Japanese, Korean, and Vietnamese labels.
- Adds semantic figures and captions, lazy-loaded images, responsive mobile layouts, print behavior, trusted-asset validation, and regression coverage for every referenced visual.

## 0.8.1 — Official Docs Center

- Replaces the static protocol summary with a searchable, responsive handbook covering player onboarding, creator workflow, artwork preparation, PNG import, Canvas and Layer Tracks, Smart Color, Rules, Soul Configuration, Preflight, publication recovery, lifecycle, Expansion Packs, and chain truth.
- Ships complete English, Simplified Chinese, Japanese, Korean, and Vietnamese documentation with one validated information architecture and production-accurate capability boundaries.
- Documents the reliable full-canvas artwork workflow while accurately retaining the current centered, scale-down-only behavior for loose PNG imports.
- Separates editable browser drafts, immutable Walrus release data, Sui protocol projection, and the currently disabled Canonical Soul Mainnet handoff.
- Adds keyboard navigation, IME-safe search, mobile topic navigation, reduced-motion behavior, accessible article pagination, cache busting, and regression coverage.

## 0.8.0 — Production Creator Rules

- Rebuilds Combination Rules as an exact Part → Item → Style tree with requires/excludes, ALL/ANY grouping, full-path labels, search, object-adjacent entry points, and publication-safe draft/private target handling.
- Replaces the broad Style visibility dropdown with selected/not-selected conditions over exact Parts, Items, and Styles, including live Player-result previews and a fully disabled editor for locked Styles.
- Uses the same canonical rule graph for Player availability, Renderer visibility, constraint-safe Random, Preflight, Walrus manifests, and the Sui projection so editor behavior cannot diverge after publication.
- Migrates legacy global and nested rules into canonical owners without dropping shorthand targets; ambiguous historical rules are preserved in recovery, shown in Rules, and blocked by Preflight until repaired.
- Rejects public rules that reference unpublished content while allowing draft owners to prepare relationships between draft content before release.
- Improves Rules accessibility, mobile layout, keyboard tab behavior, five-language terminology, and regression coverage across Creator, Player, migration, projection, publication, and recovery.

## 0.7.4 — Contextual Player Palette

- Makes Palette availability follow the Player's exact current Part → Item → Style selection instead of unrelated Smart Color channels elsewhere in the composed OC.
- Keeps Palette visible as a predictable first navigation entry: real configured colors light it up, while an unlinked, missing, incompatible, or empty channel produces a readable disabled state.
- Shows only the selected Style's color group while preserving global creator-authored linking, so choosing one color still recolors every visible Style connected to the same channel.
- Revalidates every color action against the current selection to prevent delayed clicks from an earlier Part or Style from changing an unrelated channel.
- Separates Palette scroll and focus state by Part, Item, and Style, automatically returns to the current Part when colors become unavailable, and skips the disabled Palette during keyboard navigation.
- Updates English, Simplified Chinese, Japanese, Korean, and Vietnamese copy and adds regression coverage for linked, unlinked, invalid, shared, visibility-dependent, keyboard, and stale-event cases.

## 0.7.3 — Smart Color preset and Palette reliability

- Makes every creator Color preset a real player-selectable swatch and derives the rendered shadow, midtone, and highlight from the chosen primary color instead of leaving the artwork on a stale purple gradient.
- Keeps the channel default, Maker default Recipe, Creator preview Recipe, Player Recipe, Renderer, autosave, and publication document on one canonical color selection.
- Prevents save-status rerenders from closing the native color picker before its final value commits.
- Replaces the decorative four-dot Palette icon with the actual configured colors and displays the real channel and preset counts.
- Removes the sticky Palette overlay, preserves independent Part/Palette view positions, and adds three smooth return paths: click Palette again, use Back to current Part, or press Escape.
- Classifies newly added presets as compatible additive Maker updates while preserving breaking warnings for removed or visually changed existing presets.
- Adds complete English, Simplified Chinese, Japanese, Korean, and Vietnamese copy plus desktop and mobile regression coverage.

## 0.7.2 — Lifecycle manager layout hotfix

- Isolates lifecycle action-card tones from generic button classes so long translated descriptions wrap inside their own cards instead of overlapping adjacent actions.
- Uses a readable two-column desktop layout and a single-column mobile layout for the complete Draft, Publishing, Recoverable, Active, Paused, Archived, and Version draft action set.
- Keeps unavailable lifecycle actions clearly disabled without fading their explanations below a practical reading contrast.
- Adds a UI contract that prevents generic `nowrap` button styling from leaking back into lifecycle cards.

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
