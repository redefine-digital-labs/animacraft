# Animacraft Creator Guide

Animacraft Maker v4 uses one versioned document and one renderer across Creator Studio, Player Editor, cover generation, and final PNG export.

The complete Chinese protocol and invited-creator tutorial is [ANIMACRAFT_PROTOCOL_AND_EDITOR_GUIDE.zh-CN.md](./ANIMACRAFT_PROTOCOL_AND_EDITOR_GUIDE.zh-CN.md). Art delivery requirements are in [CREATOR_ASSET_SPEC_V4.zh-CN.md](./CREATOR_ASSET_SPEC_V4.zh-CN.md). The approved Creator Studio layout is frozen in [UI_BASELINE.md](./UI_BASELINE.md).

## Maker v4 Model

```text
Maker
|- Part                         player menu category
|  `- Item                     one player selection
|     `- Style / Variant       optional visual variation
|        `- LayerBinding       one PNG on one global LayerTrack
|- LayerTrack                  global back-to-front render lane
|- ColorChannel                shared gradient-map or asset-map palette
|- Rules                       requires, excludes and visibility conditions
`- ExpansionPack               version-pinned additive content
```

A Part is not a visual layer. One Hair Item may bind a back-hair PNG, a front-hair PNG, and a highlight PNG to three different LayerTracks. The player makes one Hair selection; the renderer resolves every associated LayerBinding.

## Creator Flow

1. Connect a Sui wallet and open **MyPage -> Create Maker**.
2. Create a `1024 x 1024` Maker for the first production trial.
3. In **Character Maker**, define Parts, Items, optional Styles, and their PNG LayerBindings.
4. Upload full-canvas PNGs at `(0, 0)` or position cropped artwork on the Canvas.
5. Explicitly confirm every cropped layer position. Confirmed transform controls collapse to an **Adjust position** action; any later transform edit requires confirmation again.
6. Use **Layer Tracks** for global render order, **Smart Color** for linked palettes, and **Rules** for valid combinations.
7. Run **Player test** with the same renderer used for final output.
8. Keep or edit the default Soul Character, Memory, and Skills & Docs under **Living Content**.
9. Resolve every **Preflight** issue.
10. In **On-chain Publish**, prepare, register/upload, certify, and publish the Maker.

## Saving and Deletion

Maker documents, source image Blobs, player sessions, and Walrus checkpoints are stored in wallet-scoped IndexedDB records. This survives a normal reload in the same browser profile, but it is not cross-device cloud storage.

Before publication, local Makers and nested content can be permanently deleted. After publication, art and rules remain immutable. The current `MakerAdminCap` holder may update future economics, withdraw matching Treasury revenue, archive or restore the Maker, or publish a new content version. Existing OCs stay pinned to the Maker version they used.

## Publication Boundary

Animacraft publishes the shared `OCMaker`, `MakerTreasury<USDC>`, and transferable `MakerAdminCap`, plus an immutable Walrus Maker quilt. It validates an OC recipe and returns a non-droppable `SoulMintAuthorization`; it does not mint a second finished-character token.

Soulidity consumes that authorization and creates the only Soul, initial Living Content, Kiosk ownership, social identity, marketplace listing, and resale settlement. Paid mint remains disabled until the reviewed Animacraft v4 fee upgrade and Soulidity adapter are deployed and verified on Mainnet.

## Acceptance Gate

Before inviting unrestricted production use, record evidence for one real creator wallet and one separate player wallet:

- local draft reload with PNG recovery;
- Creator and Player rendering parity;
- optional None, Random, rules, colors, Undo/Redo, and final Recipe behavior;
- all four Walrus/Sui publication stages;
- Maker, Treasury, Cap, archive/restore, transfer, and withdrawal permissions;
- the canonical Soulidity handoff in one PTB;
- free and paid settlement, protocol fee, 2.5% secondary platform fee, and the selected 0%-5% Maker royalty.

Until that evidence exists, describe the release as an invited-creator production candidate rather than a completed end-to-end Mainnet launch.
