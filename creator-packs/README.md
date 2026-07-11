# Bundled Creator Packs

These folders are the editable source handoff for Animacraft's first two first-party Makers. Runtime-ready files are built into `public/makers/<maker-id>`.

Each pack contains:

- the approved square cover source;
- four-option source atlases for foundation, hair, expression, outfit, and accessory Parts;
- the final generation prompt set and disclosure;
- a reproducible build path through `scripts/build-builtin-makers.py`.

The build script slices each atlas, normalizes every Item to a `1024 x 1024` origin, removes the chroma key, corrects modular placement, creates four deterministic original backgrounds, and emits a validated `animacraft.creator-template.v3` manifest.

Rebuild both packs from a clean Python environment:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-creator-packs.txt
.venv/bin/python scripts/build-builtin-makers.py
npm run makers:verify
```

The artwork is AI-assisted original work curated for Animacraft Atelier. The packs borrow the general layered character-maker interaction pattern, not any third-party Maker artwork, character, logo, or named artist style.
