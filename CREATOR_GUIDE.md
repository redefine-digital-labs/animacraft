# Animacraft Creator Guide

Animacraft centers creator work on one Character Maker workspace. A Part owns its Layers, Colors, and Items. The global composition order only decides how those owned Layers stack on the final canvas.

## Data Model

```text
OCMaker
├── Part
│   ├── Part settings
│   ├── Layer(s)
│   ├── Color(s)
│   └── Item(s)
│       ├── Picker icon
│       └── Item images: Layer × Color
├── Selection rules
├── Palette links
├── License policy
└── Walrus manifest
```

An Item image belongs to one exact `Part + Item + Layer + Color` cell. Standard Parts may add Layers. Left-right paired Parts receive fixed Left and Right Layers. Last bastion Parts keep a fixed fallback Layer.

## Creator Workflow

1. Open **Maker Top** and create or select an OCMaker draft.
2. Open **Character Maker** and add the Parts users need to choose from.
3. Select a Part and configure its immutable type, icon, menu visibility, anchor, remove behavior, and license gate.
4. Add Layers and Colors inside that Part. Keep the first version small; every added Layer or Color expands the Item image matrix.
5. Add Items, set their display order and visibility, then upload PNGs into their Layer × Color cells.
6. Use the persistent canvas while switching Items. Open **Composition Order** only to arrange Layers across Parts or adjust layer offsets, opacity, and blend mode.
7. Add incompatible-choice logic in **Rules** and shared color controls in **Palette Rules**.
8. Run **Preview Check**. Every public Item must have at least one PNG, every rule must point to an existing Part, and at least one Part must be visible.
9. In **On-chain Publish**, prepare one Walrus quilt, register and upload it, certify it, then publish the OCMaker object on Sui.

## Image Preparation

- Item images must be PNG.
- Use transparent backgrounds for character layers.
- Use a common maker canvas; the current prototype targets `1024 × 1024`.
- Images below `600 × 600` receive a warning.
- Separate front and back artwork into two Layers of the same Part when one Item must change them together.
- A cell may stay empty when that Item intentionally does not use the corresponding Layer or Color.

The underlying relationship follows established character-maker practice: Parts contain Layers, Colors, and Items, and the required image count grows with `Items × Layers × Colors`. See Picrew's official [creation sequence](https://support.picrew.me/en/create_imagemaker/create_first_process) and [item image upload guide](https://support.picrew.me/en/creator_functions/item_image_upload) for the comparable model.

## Mainnet Publication

The browser keeps selected source files locally until publication begins. Animacraft then:

1. Encodes item images, icons, and the maker manifest into a Walrus quilt.
2. Registers storage using the connected wallet.
3. Uploads through the Walrus Mainnet upload relay.
4. Certifies availability and resolves every QuiltPatchID.
5. Publishes the creator profile and OCMaker index to Sui.

Keep all source files until certification succeeds. The current browser session is not yet a durable upload recovery store.
