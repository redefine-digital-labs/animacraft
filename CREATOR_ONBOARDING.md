# Animacraft Invited Creator Onboarding

## Pilot Goal

Each invited artist publishes one small, polished Character Maker that users can open, remix into distinct OCs, and mint on Sui Mainnet.

## Before Starting

- Use a Sui wallet controlled by the creator.
- Hold enough SUI for gas/relay tips and WAL for the selected storage epochs.
- Use only original or properly licensed art.
- Keep the original layered files outside the browser.
- Decide the public creator name, Maker description, world/style, and allowed usage before publication.
- Write a plain-language License note covering attribution, sharing, remix, and commercial boundaries. It is frozen into the published Maker manifest and copied into each OC package.

## Recommended First Maker

- Canvas: `1024 x 1024` for avatars or `1080 x 1920` for full-body/portrait work.
- 5-10 Parts rather than an oversized first release.
- 2-4 Items in each important Part.
- One Color at first; add color variants only where every matrix cell is ready.
- Optional Part/Item picker icons for faster user scanning.
- At least four visually distinct OC combinations tested before publication.

Common Parts include Background, Body/Base, Back Hair, Front Hair, Eyes, Mouth, Outfit, and Accessory. They are suggestions, not required names.

## Asset Checklist

- Transparent PNG for each Item image.
- Every image matches the Maker canvas ratio and shared origin.
- Every public Item fills all of its Layer x Color cells.
- Front/back artwork that changes together belongs to separate Layers in the same Part.
- File names remain understandable in the creator's source folder; Animacraft generates safe unique quilt identifiers.
- No accidental solid background, clipped edge, hidden signature, or unlicensed third-party mark.

## Part Types

- **Standard:** normal selectable group with editable Layers.
- **Left-right pair:** two fixed Layers for paired ears, wings, hands, or symmetrical accessories.
- **Last bastion:** required fallback that cannot be disabled by selection rules.

## Rights in the Pilot

- `personal-use`: personal avatars, profiles, and non-commercial display.
- `free-remix`: remix/share permission under the creator's stated terms.
- `paid-commercial`: records commercial permission policy; payment is handled outside this release.
- `exclusive-commission`: records an exclusive-policy intent; off-chain terms still need to identify the actual buyer/project.

`royaltyBps` is copied into every OC as policy metadata. It does not automatically collect or distribute funds yet.

## Publication Checklist

1. Save, reload, and confirm the draft and source files restore.
2. Test every visible Part, None option, required Part, rule, palette link, and Item thumbnail.
   Linked Parts must expose the same exact hex Color set.
3. Complete Preview Check with no blockers.
4. Export a manifest backup.
5. Prepare the Walrus quilt and confirm the expected file count.
6. Register/upload and certify with the same wallet.
7. Publish the shared Maker on Sui.
8. Open it from a disconnected browser, then use a second wallet to make and mint an OC.
9. Record Maker object, Quilt Blob ID, publication digest, sample OC object, and creator contact.

Do not publish a test draft merely to inspect the flow. Published versions are immutable; mistakes require a new version or archive.
