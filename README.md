# Animacraft

Animacraft is a standalone OC maker and creator template tool extracted from Soulidity.

It is intentionally decoupled from the Soulidity protocol app:

- Studio owns creation: OC templates, layered parts, avatar composition, creator onboarding, creator asset packaging.
- Soulidity owns protocol actions: minting, Walrus / Seal upload, grants, paid access, market listing.
- Other apps can consume the same exported OC package through adapters later.

## Product Name

Why not "Soulidity Studio":

- It sounds like a feature inside Soulidity, not a standalone product.
- A separated creator product needs room to integrate with OKX, games, and other platforms.
- "Animacraft" is broader: anime-style OC culture, layered character making, creator templates, and future character runtimes can all live under it.

## Current Prototype

This folder contains a dependency-free static prototype:

- `index.html`
- `styles.css`
- `app.js`
- `PRODUCT.md`

Open `index.html` directly in a browser, or serve the folder with any static server.

## Core Output

Studio exports:

- `animacraft.oc.v1` OC Package
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

Agent, wallet, minting, market, and game runtime features stay outside the core OC maker.
