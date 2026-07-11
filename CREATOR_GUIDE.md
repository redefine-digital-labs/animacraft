# Animacraft Creator Guide

Animacraft uses one Character Maker workspace. A **Part** is a user-facing category such as Eyes, Front Hair, or Outfit. Each Part owns its Items, Layers, Colors, icons, and PNG files. **Composition Order** only arranges those owned Layers across Parts.

## Data Model

```text
OCMaker
|- Part
|  |- Part settings
|  |- Layer(s)
|  |- Color(s)
|  `- Item(s)
|     |- Picker icon (optional)
|     `- Item images: one PNG per Layer x Color cell
|- Selection rules
|- Palette links
|- Living Content defaults
|  |- soul.md
|  |- memory.md
|  `- skills.zip / SKILL.md
|- License policy
`- Walrus manifest
```

The number of required files for one Part is:

```text
public Items x Layers x Colors
```

## Build a Maker

1. Connect the creator wallet and open **MyPage -> Create maker**.
2. Create a square `1024 x 1024` or portrait `1080 x 1920` Maker. Use the Character starter or a blank canvas.
3. In **Character Maker**, add or select a Part.
4. Choose its type once:
   - **Standard:** one or more freely managed Layers.
   - **Left-right pair:** fixed Left and Right Layers, each positioned independently.
   - **Last bastion:** required fallback Part that cannot be targeted by incompatibility rules.
5. In **Layers & colors**, define the image matrix. Adding a Layer or Color adds one required cell to every public Item in that Part.
6. In **Items**, add user choices, set display order and publication state, optionally upload a picker icon, then fill every PNG cell.
7. Use **Composition Order** to move Layers front/behind and set X/Y offset, opacity, or blend mode. The editor preview and final exported PNG use the same values.
8. In **Rules**, block incompatible choices between two non-Last-Bastion Parts. A blank Item selector means the whole Part; a selected Item creates an Item-specific rule.
9. In **Palette Rules**, link Parts whose colors should change together. Linked Parts must publish the same exact hex Color set; the player selects one shared value and Sui enforces it at mint.
10. Open **Living Content**. The default Soul Character, Memory, and Skills & Docs files are already valid for Soulidity; edit only what should be specific to this Maker.
11. Complete Maker name, description, creator, world/style, license kind, mint availability, native-USDC price, and 0%–5% resale royalty tier in **Settings**.
12. Run **Preview Check** until every blocking check passes.
13. In **On-chain Publish**, prepare, register/upload, certify, and publish.

## Image Rules

- Item images must be PNG and no larger than 20 MB or `8192 x 8192`.
- Every image must use the Maker's selected canvas ratio.
- For best quality, upload at least the Maker canvas size: `1024 x 1024` or `1080 x 1920`.
- Use transparency for character layers. A background Part may intentionally fill the canvas.
- Keep corresponding artwork aligned to the same origin. Use Layer X/Y only for deliberate offsets.
- Item and Part icons may be PNG or JPEG up to 5 MB.
- Mark unfinished Items **Draft only** so they are excluded from the public manifest and quilt.

## Saving and Recovery

Maker structure, source image Blobs, and Walrus upload checkpoints are stored in IndexedDB under the connected wallet and Maker. Saving and autosave survive normal reloads in the same browser profile; creators do not need to reselect files after every refresh.

Drafts are not cross-device cloud storage. Keep original art and a local manifest export. Private/incognito storage, browser-data cleanup, or another device will not contain the draft.

If a paid Walrus workflow is interrupted, reconnect the same wallet and use **Resume saved upload**. Do not edit the Maker between preparation and publication; any edit invalidates the old checkpoint and requires a new quilt.

## Delete, Publish, Archive

- Before publication, a creator may permanently delete a local Maker, Part, Item, optional Layer, or extra Color. Related local file references and invalid rules are removed.
- Publishing stores immutable art, rules, and manifest. The current `MakerAdminCap` owner may update future mint availability, USDC price, royalty tier, and archive state.
- To revise a published Maker, create and publish a new version.
- The creator may archive or restore the shared Sui Maker. Archive blocks new Soul authorizations but preserves existing Souls, provenance, policy snapshots, and Walrus files.

## Launch Limits

- 100 Items, 32 Layers, and 32 Colors per Part.
- 5,000 Walrus files per Maker release, including cover and manifest.
- 450 total Part + public Item + Color + selection rule + palette-link records in the current one-transaction publisher.
- New Maker and OC packages default to 53 Walrus Mainnet epochs, currently about two years. Storage can be extended, so operators must schedule renewal before expiry.
- Paid mint revenue is held by the Maker's `MakerTreasury<USDC>` and only the matching `MakerAdminCap` holder can withdraw it.
- Royalty tiers are copied into the Soul mint authorization. Secondary settlement is enforced by the Soulidity Marketplace adapter, not by browser metadata.
