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

1. Open **My Page → Creator Studio**, create an OC Maker in the library, or open an existing draft.
2. The draft opens in **Character Maker**. Add the Parts users need to choose from.
3. Select a Part and configure its immutable type, icon, menu visibility, anchor, remove behavior, and manifest policy.
4. Add Layers and Colors inside that Part. Keep the first version small; every added Layer or Color expands the Item image matrix.
5. Add Items, set their display order and visibility, then upload PNGs into their Layer × Color cells.
6. Use the persistent canvas while switching Items. Open **Composition Order** only to arrange Layers across Parts or adjust layer offsets, opacity, and blend mode. Layers still belong to their Part; this list is only the final cross-Part stack.
7. Use **Maker Top** as a status overview. Continue editing through Character Maker, Rules, Palette Rules, Preview Check, On-chain Publish, and Settings.
8. Save a local draft often. Before publishing, reconnect the same wallet and reselect local image files if the browser was reloaded.
9. Add incompatible-choice logic in **Rules**. Leave an Item selector on "Any Item" for a whole-Part rule, or choose a specific public Item on either side for clipping and compatibility rules. Add shared color controls in **Palette Rules**.
10. Run **Preview Check**. Every published Item must fill its complete Layer × Color PNG matrix, every rule must point to an available Part or Item, and at least one Part must be visible.
11. In **On-chain Publish**, prepare one Walrus quilt, register and upload it, certify it, then publish the OCMaker object on Sui.

## Image Preparation

- Item images must be PNG.
- Use transparent backgrounds for character layers.
- Choose the Maker canvas before editing: `1024 × 1024` for square Makers or `1080 × 1920` for portrait Makers.
- Images below `600 × 600` receive a warning.
- Separate front and back artwork into two Layers of the same Part when one Item must change them together.
- Every Layer × Color cell of a published Item is required. Mark an unfinished Item as **Draft only**, or remove the unused Layer/Color before publication.

The underlying relationship follows established character-maker practice: Parts contain Layers, Colors, and Items, and the required image count grows with `Items × Layers × Colors`. See Picrew's official [creation sequence](https://support.picrew.me/en/create_imagemaker/create_first_process) and [item image upload guide](https://support.picrew.me/en/creator_functions/item_image_upload) for the comparable model.

## Mainnet Publication

The browser keeps selected source files locally until publication begins. Animacraft then:

1. Encodes item images, icons, and the maker manifest into a Walrus quilt.
2. Registers storage using the connected wallet.
3. Uploads through the Walrus Mainnet upload relay.
4. Certifies availability and resolves every QuiltPatchID.
5. Publishes the creator profile and OCMaker index to Sui.

Keep all source files until certification succeeds. The current browser session is not yet a durable upload recovery store.
