# Animacraft Invited Creator Onboarding

## Pilot Goal

Each invited artist publishes one small, polished Character Maker that users can open and remix into distinct OCs on Sui Mainnet. Canonical Soulidity mint is the next activation stage and is enabled only after the reviewed adapter and signed multi-wallet smoke test are live.

## Current Pilot Boundary

- Maker creation, Walrus certification, Sui publication, public browsing, OC composition, archive/restore, and Cap-only Maker administration belong to the Animacraft pilot.
- Keep the first Maker's mint fee disabled unless the release operator confirms the Soulidity adapter is deployed and the paid atomic-mint test has passed.
- Every protocol-v3 Item is included with the Maker. Paid add-on and creator-only Item gates are not live access controls.
- A royalty tier may be recorded now, but secondary settlement is not live until Soulidity's Animacraft-aware Marketplace path is deployed and tested.
- The temporary Import Kit is an unverified handoff. It must not be presented as typed Animacraft provenance or as the canonical paid mint path.

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
- `paid-commercial`: records commercial permission policy; the Maker may independently enable a native-USDC mint fee.
- `exclusive-commission`: records an exclusive-policy intent; off-chain terms still need to identify the actual buyer/project.

`royaltyBps` must be off or 1%–5% and is copied into the Soul mint authorization. Animacraft collects optional Maker fees only inside the canonical Soulidity mint PTB; Soulidity Marketplace is responsible for later resale distribution.

## Publication Checklist

1. Save, reload, and confirm the draft and source files restore.
2. Test every visible Part, None option, required Part, rule, palette link, and Item thumbnail.
   Linked Parts must expose the same exact hex Color set.
3. Complete Preview Check with no blockers.
4. Review Living Content defaults. Leave them unchanged for a neutral Soul shell or customize the character voice, founding memory, and skill.
5. Export a manifest backup.
6. Prepare the Walrus quilt and confirm the expected file count.
7. Register/upload and certify with the same wallet.
8. Publish the shared Maker on Sui.
9. Open it from a disconnected browser, then use a second wallet to make and export an OC.
10. If the release status explicitly says the Soulidity adapter is active, complete the canonical mint with the same second wallet; otherwise stop at the clearly labeled Import Kit handoff.
11. Record Maker object, Treasury, AdminCap, Quilt Blob ID, publication digest, creator contact, and any activated sample Soul object.

Do not publish a test draft merely to inspect the flow. Published versions are immutable; mistakes require a new version or archive.
