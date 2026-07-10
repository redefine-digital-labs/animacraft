# Adapter Plan

Animacraft must stay focused on OC creation. Integrations are optional adapters.

## Soulidity Adapter

Input:

- `animacraft.oc.v1`
- `animacraft.creator-template.v2`

Responsibilities:

- Convert OC note to `oc.md` or `soul.md` if Soulidity needs it.
- Convert creator template manifest into storage metadata.
- Upload assets to the current storage path.
- Mint Soul through Soulidity contracts.
- Optional listing through Soulidity market.

## OKX Adapter

Input:

- OC package.
- Campaign id.
- Callback URL.

Responsibilities:

- Validate campaign template.
- Receive package hash.
- Mint or issue campaign asset using OKX-side infrastructure.
- Return external reference.

## Game Adapter

Input:

- Character visual layers.
- Game config.
- Template id.

Responsibilities:

- Validate template is game-compatible.
- Convert visual config to game runtime config.
- Optionally verify Soulidity package ownership.
