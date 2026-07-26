# Changelog

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
