# Animacraft Creator Guide

Animacraft Maker v5 uses one versioned document and one renderer across Creator Studio, Player Editor, cover generation, and final PNG export.

The current Chinese art and editor contract is [CREATOR_ASSET_SPEC_V5.zh-CN.md](./CREATOR_ASSET_SPEC_V5.zh-CN.md).

## Maker v5 Model

```text
Maker
|- Part                         player menu category
|  `- Item                     one player selection
|     `- Style                 one required visual option
|        `- PNG + transform    the complete renderable unit
|- LayerTrack                  global back-to-front render lane
|- ColorChannel                shared gradient-map palette for the same PNG
|- Rules                       requires, excludes and visibility conditions
`- ExpansionPack               version-pinned additive content
```

A Part is not a shared transform. Every Style owns exactly one PNG, one LayerTrack reference, and one independent transform. Artwork that must render both behind and in front of the body is split into separate Parts such as Back Hair and Front Hair.

## Creator Flow

1. Connect a Sui wallet and open **MyPage -> Create Maker**.
2. Create a `1024 x 1024` Maker for the first production trial.
3. In **Character Maker**, define Parts, Items, and Styles; attach one PNG directly to each Style.
4. Upload full-canvas PNGs at `(0, 0)` or position cropped artwork on the Canvas.
5. Explicitly confirm every cropped Style position, then lock it against accidental movement. Any later transform edit requires unlocking and confirming again.
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
