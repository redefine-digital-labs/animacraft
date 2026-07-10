# Animacraft

Animacraft is The Fully onchain Character Maker & Creator.

It is a standalone OC maker, creator template tool, and Sui Move protocol package extracted from Soulidity.

It is intentionally decoupled from the Soulidity protocol app:

- Animacraft owns creation: OC templates, layered parts, avatar composition, creator onboarding, creator asset packaging, and the core OC maker protocol.
- Soulidity may integrate later: broader identity, agents, grants, paid access, and market listing.
- Other apps can consume the same exported OC package through adapters later.

## Product Name

Why not "Soulidity Studio":

- It sounds like a feature inside Soulidity, not a standalone product.
- A separated creator product needs room to integrate with OKX, games, and other platforms.
- "Animacraft" is broader: anime-style OC culture, layered character making, creator templates, and future character runtimes can all live under it.

## Current App

This folder contains a Vite-built, backendless web app:

- `index.html`
- `styles.css`
- `app.js`
- `PRODUCT.md`
- `move/animacraft`

Run it locally with:

```bash
npm install
npm run dev
```

Create the Vercel output with `npm run build`. The production files are written to `dist/`.

## Production Direction

Animacraft is designed to run without a mandatory backend:

- Vercel hosts the static frontend.
- Sui stores creator profiles, OC maker templates, license policy snapshots, and finished OC objects.
- Walrus stores PNG layers, icons, manifests, rendered OC images, and profile JSON.
- Wallets sign creator publishing and user minting transactions.
- The frontend uses Mysten's current framework-agnostic dApp Kit and gRPC client.

See:

- `DEPLOYMENT.md`
- `PRODUCTION_ROADMAP.md`
- `move/animacraft/README.md`

## Core Output

Studio exports:

- `animacraft.oc-package.v1` OC Package
- `animacraft.creator-template.v1` Creator Template Manifest
- Recipe JSON
- OC markdown

These outputs are the contract between Studio and downstream platforms.

## Creator Focus

The current product scope is intentionally narrow:

- Template plaza
- Template detail
- Creator revenue / authorization
- Asset pack specification
- Works preview
- Creator onboarding

Agents, broader marketplace logic, and game runtime integrations stay outside the core OC maker until the creator and player loops are stable.
