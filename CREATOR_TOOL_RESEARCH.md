# Animacraft Creator Tool Research

## Goal

Animacraft should not copy Picrew's visual style. The useful reference is its creator workflow depth: makers are not a single template form, but a structured authoring system for parts, items, layers, rules, preview validation, and publication.

## Creator Workflow Observed

1. Creator enters a maker library.
2. Creator registers a new OC maker with name, canvas ratio, and creation mode.
3. Creator opens the maker editor.
4. Creator lands on a maker top page, not directly inside a canvas editor.
5. Maker top shows maker information, registered parts, and generated layer order.
6. Creator adds parts from the maker top.
7. Each part exposes separate Items and Settings entry points.
8. Creator configures part types and item settings.
9. Creator manages layers and composition order.
10. Creator defines incompatible combinations through part rules and item rules.
11. Creator links colors across related layers.
12. Creator runs preview validation.
13. Creator publishes or keeps the maker private.

## Core Maker Objects

### Maker

- Name
- Canvas size, such as 1:1 or 9:16
- Creation mode, such as free combination or rule-guided mixing
- Publication state
- Description, tags, rules, and creator identity

### Maker Top

The maker top page is the creator control console for one maker.

- Shows the maker's title, status, ratio, type, and description.
- Shows registered parts as rows.
- Each part row exposes Items and Settings.
- Shows generated layer order.
- Layer order can be sorted separately from part order.
- Preview and release actions are available from the maker-level sidebar.
- Parts are shown with part icon, name, type label, item count, movement controls, Items entry, and Settings entry.
- Layers are generated after parts are added and can be sorted independently.

### Create Maker Registration

Creating a maker should not drop the creator directly into a visual canvas. It should register a maker shell and prepare a predictable starter structure:

- Maker name
- Canvas size
- Maker mode
- Maker top dashboard
- First standard part
- No.1 base item
- Generated layer order
- Optional left-right paired part
- Optional last-bastion fallback
- Draft asset slots for upload
- Draft license policy

### Part

Parts are creator-facing asset groups shown to users as menu categories.

- Standard part: normal selectable group; can include multiple layers.
- Left-right paired part: paired assets with right and left layers, distance adjustment, and paired movement logic.
- Last bastion part: fallback part used by rules so an important visual area does not become empty.

Part type should be treated as structurally important and difficult to change after creation.

Part details include:

- Part image/icon
- Part name
- Part type label
- X/Y position
- Position diagram
- Edit/Delete actions
- Layer list under the part
- Add layer action

### Item

Items are selectable choices inside a part.

- No.1 item is special: it acts as a required base/default item and should not be deleted or made private.
- Item number can be different from user-facing display order.
- Item public/private state controls whether makers can see it.
- Item image and selection icon are separate concepts.
- Bulk upload should map files to item numbers and layer slots.
- Item list supports public-status filtering, sort key, sorting direction, page size, list view, and grid view.
- Item List exposes Part Settings, Item List, and Bulk upload as sibling tabs.
- Advanced features are hidden behind a dropdown.

### Layer

Layers define visual composition.

- Layer order
- Anchor X/Y
- Scale and rotation
- Menu visibility
- Paired right-side position for left-right parts
- Asset file reference
- Layer rows can be edited or deleted from the part detail page.

## Rules

### Part Rules

Part rules prevent two part groups from being chosen at the same time.

Example: selecting a one-piece dress disables tops and bottoms.

### Item Rules

Item rules prevent specific item combinations.

Example: one tall hat cannot be combined with one hairstyle because the images overlap.

### Last Bastion

Last bastion parts solve empty-state problems. If rules would remove all valid choices from a required visual area, the fallback item remains available.

For Animacraft, these rules should become on-chain-readable constraint objects when a maker is published.

## Palette / Color Linking

Color linking connects multiple visual layers to the same color control.

Examples:

- Front hair, back hair, eyebrows, and shadows share one hair palette.
- Jacket trim, ribbon, and frame share one outfit accent palette.

Animacraft should store palette groups, allowed variants, and the final recipe color snapshot.

## Preview Validation

Preview is not just a visual preview. It is a release gate.

Blocking checks should include:

- At least one standard or paired part exists.
- At least one part is visible in the user menu.
- Public items have required PNG layers.
- Rules do not reference deleted parts or hidden items.
- Last-bastion fallback exists when needed.
- Metadata and license settings are complete.

## On-chain Mapping

### Walrus

- PNG layer assets
- Item icons
- Cover images
- Generated previews
- Manifest files

### Sui

- Maker template object
- Part objects
- Item metadata and asset references
- Rule objects
- Palette-link objects
- License policy objects
- OC recipe objects
- Revenue split rules

## Animacraft Product Implications

Animacraft should be organized as editor subpages rather than one long page:

- Maker Top
- Layer Editor
- Parts
- Rules
- Palette Rules
- Preview Check
- On-chain Publish
- Settings

The creator experience should stay in Animacraft's own bright, lightweight OC-tool language. Picrew is a workflow reference, not a visual system to copy.
