# Animacraft Product Boundary

## One-Line Positioning

Animacraft is a standalone creator tool for making OC templates and remixable character packages.

## What Studio Does

- Template plaza
- Template detail
- 2D avatar / OC composition
- Layer slot and part selection
- Creator asset intake
- Creator onboarding
- Artist revenue and authorization metadata
- Works preview
- Artist handoff manifest
- OC profile editing
- Standard package export

## What Studio Does Not Own

- Sui wallet connection
- Soulidity mint transaction
- Walrus / Seal upload
- Market listing
- Paid access
- SoulGrant issuance
- Agent persona runtime
- Game runtime logic

Those are downstream adapter responsibilities.

## Recommended Product Architecture

```text
Animacraft
  ├─ OC Package
  ├─ Creator Template Manifest
  ├─ Recipe JSON
  └─ Rendered cover

Adapters
  ├─ Soulidity Protocol Adapter
  ├─ OKX Campaign Adapter
  └─ Game Character Adapter
```

## MVP Acceptance

- A user can choose an artist template.
- A user can inspect template detail, works preview, license, and revenue rules.
- A user can compose an OC visually.
- A creator can import layer PNG metadata and export a manifest.
- A creator can follow onboarding and asset pack rules.
- Studio can export a self-contained OC package without Soulidity login.
- Soulidity or another app can later import the package.
