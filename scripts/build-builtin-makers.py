#!/usr/bin/env python3
"""Build the two bundled Animacraft creator packs from approved source atlases."""

from __future__ import annotations

import json
import hashlib
import shutil
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter
from chroma_key import remove_chroma_key


ROOT = Path(__file__).resolve().parents[1]
PACKS_ROOT = ROOT / "creator-packs"
PUBLIC_ROOT = ROOT / "public" / "makers"
CANVAS = 1024


MAKERS = {
    "astral-courier": {
        "name": "Astral Courier · 星夜信使",
        "summary": "A premium cel-shaded celestial courier maker with four skin tones, hairstyles, expressions, outfits, backgrounds, and five accessories.",
        "creator": "Animacraft Atelier",
        "style": "Japanese cel-shaded celestial portrait",
        "accent": "#6f63ff",
        "secondary": "#43d7e8",
        "master": "source-atlases/master.png",
        "atlases": {
            "base": ("source-atlases/foundation.png", ["porcelain", "warm-beige", "golden-tan", "deep-brown"]),
            "hair": ("source-atlases/hair.png", ["moonlit-wolf", "indigo-straight", "silver-bob", "violet-tails"]),
            "expression": ("source-atlases/expression.png", ["calm-violet", "curious-cyan", "sleepy-indigo", "determined-amber"]),
            "outfit": ("source-atlases/outfit.png", ["courier-jacket", "academy-blazer", "starlight-hoodie", "moon-mantle"]),
            "accessory": ("source-atlases/accessory.png", ["crescent-clip", "holo-visor", "star-earrings", "orbit-pendant"]),
        },
        "labels": {
            "porcelain": "Porcelain",
            "warm-beige": "Warm Beige",
            "golden-tan": "Golden Tan",
            "deep-brown": "Deep Brown",
            "moonlit-wolf": "Moonlit Wolf Cut",
            "indigo-straight": "Indigo Straight",
            "silver-bob": "Silver Airy Bob",
            "violet-tails": "Violet Twin Tails",
            "calm-violet": "Calm Violet",
            "curious-cyan": "Curious Cyan",
            "sleepy-indigo": "Sleepy Indigo",
            "determined-amber": "Determined Amber",
            "courier-jacket": "Celestial Courier",
            "academy-blazer": "Midnight Academy",
            "starlight-hoodie": "Starlight Hoodie",
            "moon-mantle": "Moon Mantle",
            "crescent-clip": "Crescent Clip",
            "holo-visor": "Holo Visor",
            "star-earrings": "Star Earrings",
            "orbit-pendant": "Orbit Pendant",
            "moon-portal": "Moon Portal",
            "meteor-dawn": "Meteor Dawn",
            "aurora-grid": "Aurora Grid",
            "quiet-orbit": "Quiet Orbit",
        },
        "backgrounds": ["moon-portal", "meteor-dawn", "aurora-grid", "quiet-orbit"],
        "accessoryTransforms": {
            "crescent-clip": (0.55, (700, 330)),
            "holo-visor": (0.65, (510, 455)),
            "star-earrings": (0.75, (510, 480)),
            "orbit-pendant": (0.50, (510, 790)),
        },
    },
    "hanamori-spirit": {
        "name": "Hanamori Spirit · 花守灵契",
        "summary": "A refined cel-shaded spirit-garden maker with four skin tones, hairstyles, expressions, ceremonial fantasy outfits, backgrounds, and five ornaments.",
        "creator": "Animacraft Atelier",
        "style": "Japanese cel-shaded spirit-garden portrait",
        "accent": "#d94f45",
        "secondary": "#4caa83",
        "master": "source-atlases/master.png",
        "atlases": {
            "base": ("source-atlases/foundation.png", ["porcelain-peach", "warm-beige", "honey-tan", "deep-umber"]),
            "hair": ("source-atlases/hair.png", ["chestnut-tufts", "black-vermilion", "cream-hime", "auburn-ponytail"]),
            "expression": ("source-atlases/expression.png", ["serene-jade", "bright-plum", "dreamy-amber", "focused-teal"]),
            "outfit": ("source-atlases/outfit.png", ["vermilion-keeper", "forest-haori", "plum-festival", "indigo-mantle"]),
            "accessory": ("source-atlases/accessory.png", ["plum-blossom", "jade-forehead-chain", "tassel-earrings", "magatama-pendant"]),
        },
        "labels": {
            "porcelain-peach": "Porcelain Peach",
            "warm-beige": "Warm Beige",
            "honey-tan": "Honey Tan",
            "deep-umber": "Deep Umber",
            "chestnut-tufts": "Chestnut Spirit Tufts",
            "black-vermilion": "Black Vermilion",
            "cream-hime": "Cream Hime Bob",
            "auburn-ponytail": "Auburn Ponytail",
            "serene-jade": "Serene Jade",
            "bright-plum": "Bright Plum",
            "dreamy-amber": "Dreamy Amber",
            "focused-teal": "Focused Teal",
            "vermilion-keeper": "Vermilion Keeper",
            "forest-haori": "Forest Haori",
            "plum-festival": "Plum Festival",
            "indigo-mantle": "Indigo Mantle",
            "plum-blossom": "Plum Blossom",
            "jade-forehead-chain": "Jade Forehead Chain",
            "tassel-earrings": "Tassel Earrings",
            "magatama-pendant": "Jade Spirit Pendant",
            "spring-gate": "Spring Gate",
            "paper-garden": "Paper Garden",
            "lantern-dusk": "Lantern Dusk",
            "jade-moon": "Jade Moon",
        },
        "backgrounds": ["spring-gate", "paper-garden", "lantern-dusk", "jade-moon"],
        "accessoryTransforms": {
            "plum-blossom": (0.50, (690, 330)),
            "jade-forehead-chain": (0.65, (510, 340)),
            "tassel-earrings": (0.70, (510, 480)),
            "magatama-pendant": (0.50, (510, 790)),
        },
    },
}


def keyed_png(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    remove_chroma_key(source, destination, transparent_threshold=12, opaque_threshold=220)


def crop_atlas(source: Path, names: list[str], destination: Path) -> None:
    atlas = Image.open(source).convert("RGB")
    if atlas.width != atlas.height or atlas.width % 2:
        raise ValueError(f"Atlas must be an even square: {source}")
    half = atlas.width // 2
    boxes = [(0, 0, half, half), (half, 0, atlas.width, half), (0, half, half, atlas.height), (half, half, atlas.width, atlas.height)]
    with tempfile.TemporaryDirectory(prefix="animacraft-atlas-") as temp_dir:
        for name, box in zip(names, boxes):
            chroma = Path(temp_dir) / f"{name}.png"
            atlas.crop(box).resize((CANVAS, CANVAS), Image.Resampling.LANCZOS).save(chroma, optimize=True)
            keyed_png(chroma, destination / f"{name}.png")


def radial(draw: ImageDraw.ImageDraw, center: tuple[int, int], radius: int, colors: tuple[str, str]) -> None:
    start = tuple(int(colors[0][index:index + 2], 16) for index in (1, 3, 5))
    end = tuple(int(colors[1][index:index + 2], 16) for index in (1, 3, 5))
    for step in range(radius, 0, -4):
        mix = 1 - step / radius
        color = tuple(round(a + (b - a) * mix) for a, b in zip(start, end))
        x, y = center
        draw.ellipse((x - step, y - step, x + step, y + step), fill=color)


def deterministic_noise(size: tuple[int, int], seed_text: str) -> Image.Image:
    width, height = size
    state = int.from_bytes(hashlib.sha256(seed_text.encode("utf-8")).digest()[:4], "big")
    values = bytearray(width * height)
    for index in range(len(values)):
        state = (1_664_525 * state + 1_013_904_223) & 0xFFFFFFFF
        values[index] = state >> 24
    return Image.frombytes("L", size, bytes(values))


def make_background(maker_id: str, name: str, out: Path) -> None:
    palettes = {
        "astral-courier": {
            "moon-portal": ("#101635", "#6d61d7", "#b9f1ff"),
            "meteor-dawn": ("#25275b", "#e989a9", "#ffe0ad"),
            "aurora-grid": ("#081c32", "#188da2", "#ad78ea"),
            "quiet-orbit": ("#17132f", "#4f438d", "#d9e6ff"),
        },
        "hanamori-spirit": {
            "spring-gate": ("#ead9cc", "#d76661", "#f8eddc"),
            "paper-garden": ("#e8d9bd", "#80a681", "#fff6df"),
            "lantern-dusk": ("#35253f", "#9c4c63", "#f1b66f"),
            "jade-moon": ("#173b3a", "#497d69", "#dfe7bd"),
        },
    }
    dark, mid, light = palettes[maker_id][name]
    image = Image.new("RGB", (CANVAS, CANVAS), dark)
    draw = ImageDraw.Draw(image)
    for y in range(CANVAS):
        ratio = y / (CANVAS - 1)
        a = tuple(int(dark[index:index + 2], 16) for index in (1, 3, 5))
        b = tuple(int(mid[index:index + 2], 16) for index in (1, 3, 5))
        color = tuple(round(x + (z - x) * ratio) for x, z in zip(a, b))
        draw.line((0, y, CANVAS, y), fill=color)

    if maker_id == "astral-courier":
        radial(draw, (760, 230), 180, (mid, light))
        for index in range(52):
            x = (index * 197 + 71) % CANVAS
            y = (index * 109 + 43) % 720
            size = 2 + index % 4
            draw.polygon([(x, y - size * 2), (x + size, y), (x, y + size * 2), (x - size, y)], fill=light)
        if name == "aurora-grid":
            for offset in range(-CANVAS, CANVAS * 2, 96):
                draw.line((offset, CANVAS, offset + 560, 420), fill="#73d6df", width=2)
            for y in range(620, CANVAS, 72):
                draw.line((0, y, CANVAS, y), fill="#7869be", width=2)
        else:
            draw.arc((166, 126, 858, 818), 205, 342, fill=light, width=8)
            draw.arc((220, 182, 806, 768), 202, 344, fill="#7fd8e2", width=3)
    else:
        radial(draw, (790, 210), 164, (mid, light))
        for index in range(34):
            x = (index * 173 + 57) % CANVAS
            y = (index * 139 + 31) % 770
            r = 6 + index % 7
            petal = "#f0a4a7" if index % 3 else light
            draw.ellipse((x - r * 2, y - r // 2, x + r * 2, y + r // 2), fill=petal)
        if name in {"spring-gate", "lantern-dusk"}:
            draw.rounded_rectangle((122, 116, 902, 930), radius=26, outline="#6f2f34", width=18)
            draw.rounded_rectangle((182, 174, 842, 930), radius=18, outline="#d8aa74", width=6)
        else:
            for radius in (310, 250, 190):
                draw.arc((512 - radius, 160 - radius, 512 + radius, 160 + radius), 18, 162, fill="#d6c18d", width=5)

    noise = deterministic_noise((128, 128), f"{maker_id}:{name}").resize(
        (CANVAS, CANVAS), Image.Resampling.BILINEAR
    ).filter(ImageFilter.GaussianBlur(0.8))
    paper = Image.new("RGB", image.size, "#ffffff")
    paper.putalpha(noise.point(lambda value: max(0, value // 18)))
    image = Image.alpha_composite(image.convert("RGBA"), paper.convert("RGBA"))
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out, optimize=True)


def empty_layer(out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0)).save(out, optimize=True)


def translate_layer(path: Path, x: int, y: int) -> None:
    source = Image.open(path).convert("RGBA")
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(source, (x, y))
    canvas.save(path, optimize=True)


def place_layer(path: Path, scale: float, center: tuple[int, int]) -> None:
    source = Image.open(path).convert("RGBA")
    bounds = source.getchannel("A").getbbox()
    if not bounds:
        return
    artwork = source.crop(bounds)
    artwork = artwork.resize(
        (max(1, round(artwork.width * scale)), max(1, round(artwork.height * scale))),
        Image.Resampling.LANCZOS,
    )
    x = round(center[0] - artwork.width / 2)
    y = round(center[1] - artwork.height / 2)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(artwork, (x, y))
    canvas.save(path, optimize=True)


def compress_expression(path: Path, vertical_scale: float = 0.75) -> None:
    source = Image.open(path).convert("RGBA")
    bounds = source.getchannel("A").getbbox()
    if not bounds:
        return
    artwork = source.crop(bounds)
    artwork = artwork.resize(
        (artwork.width, max(1, round(artwork.height * vertical_scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(artwork, (bounds[0], bounds[1]))
    canvas.save(path, optimize=True)


def living_content(config: dict) -> dict:
    maker_name = config["name"]
    skill_name = "astral-courier-companion" if maker_name.startswith("Astral") else "hanamori-spirit-companion"
    return {
        "schemaVersion": "animacraft.living-content.v1",
        "soulMd": f"""# Soul Character

## Identity
- Name: {{{{OC_NAME}}}}
- World: {{{{OC_WORLD}}}}
- Visual origin: {maker_name} by Animacraft Atelier
- Character summary: {{{{OC_DESCRIPTION}}}}

## Core Truths
- Grow from an original character into a continuous, owner-directed companion.
- Preserve consent, authorship, and the selected visual recipe.
- Distinguish memories from creative interpretation.

## Vibe
- Voice: graceful, vivid, concise first, and emotionally attentive.
- Style: {config['style']}.

## Boundaries
- Never invent permissions, private history, or tool access.
- Ask before consequential actions or disclosure of protected information.
""",
        "memoryMd": f"""# Founding Memory

{{{{OC_NAME}}}} began as an original composition in {maker_name}.

- Preserve the Maker provenance and selected visual recipe.
- Treat {{{{OC_DESCRIPTION}}}} as the opening direction, not fabricated history.
- Learn only from content the owner intentionally adds.
""",
        "skillMd": f"""---
name: {skill_name}
description: Keeps this character's voice, visual provenance, and owner-approved context aligned.
---
# Character Companion

Use this skill when the Soul needs to speak or act consistently with {{{{OC_NAME}}}}.

- Keep verified facts, remembered context, and creative interpretation distinct.
- Preserve the Maker and recipe provenance.
- Ask for permission before consequential actions.
""",
        "customized": {"soulMd": True, "memoryMd": True, "skillMd": True},
    }


def part(
    key: str,
    label: str,
    item_names: list[str],
    labels: dict,
    order: int,
    *,
    kind: str = "standard",
    allow_remove: bool = True,
) -> dict:
    color = {"id": "original", "name": "Original", "value": "#7b5cff"}
    return {
        "key": key,
        "label": label,
        "kind": kind,
        "menuVisible": True,
        "allowRemove": allow_remove,
        "defaultItemId": item_names[0],
        "iconIdentifier": "",
        "layers": [{"id": "normal", "name": label, "renderOrder": order, "x": 0, "y": 0, "opacity": 100, "blendMode": "normal"}],
        "colors": [color],
        "items": [
            {
                "id": name,
                "label": labels.get(name, name.replace("-", " ").title()),
                "displayOrder": index + 1,
                "visibility": "public",
                "iconIdentifier": "",
                "images": [{"layerId": "normal", "colorId": "original", "identifier": f"layers/{key}/{name}.png"}],
            }
            for index, name in enumerate(item_names)
        ],
    }


def build_manifest(maker_id: str, config: dict, out_dir: Path) -> dict:
    labels = config["labels"]
    atlas_names = {key: value[1] for key, value in config["atlases"].items()}
    accessory_names = ["none", *atlas_names["accessory"]]
    labels["none"] = "None"
    parts = [
        part("background", "Background", config["backgrounds"], labels, 0, kind="last-bastion", allow_remove=False),
        part("base", "Skin & Base", atlas_names["base"], labels, 1, kind="last-bastion", allow_remove=False),
        part("outfit", "Outfit", atlas_names["outfit"], labels, 2),
        part("expression", "Expression", atlas_names["expression"], labels, 3),
        part("hair", "Hair", atlas_names["hair"], labels, 4),
        part("accessory", "Accessory", accessory_names, labels, 5, allow_remove=False),
    ]
    assets = []
    for maker_part in parts:
        for item in maker_part["items"]:
            identifier = item["images"][0]["identifier"]
            file_path = out_dir / identifier
            assets.append({
                "name": file_path.name,
                "size": file_path.stat().st_size,
                "type": "image/png",
                "kind": "item-layer",
                "slot": maker_part["key"],
                "partId": item["id"],
                "itemId": item["id"],
                "layerId": "normal",
                "colorId": "original",
                "identifier": identifier,
                "patchId": "",
                "blobId": "",
            })
    assets.append({
        "name": "cover.png",
        "size": (out_dir / "cover.png").stat().st_size,
        "type": "image/png",
        "kind": "maker-cover",
        "slot": "",
        "partId": "",
        "itemId": "",
        "layerId": "",
        "colorId": "",
        "identifier": "cover.png",
        "patchId": "",
        "blobId": "",
    })
    return {
        "schemaVersion": "animacraft.creator-template.v3",
        "template": {
            "id": maker_id,
            "name": config["name"],
            "summary": config["summary"],
            "creator": config["creator"],
            "style": config["style"],
            "license": "personal-use",
            "licenseNote": "Free personal Soul mint and avatar use with Maker provenance retained. Commercial use and resale rights follow the published on-chain policy. AI-assisted original art is disclosed in the creator pack.",
            "royaltyBps": 300,
            "mintingEnabled": True,
            "mintFeeEnabled": False,
            "mintPriceAtomic": 0,
            "paymentCoinSymbol": "USDC",
            "storage": "walrus",
            "chain": "sui",
            "coverIdentifier": "cover.png",
            "canvas": {"width": CANVAS, "height": CANVAS, "anchorX": 512, "anchorY": 512},
        },
        "runtime": {
            "network": "mainnet",
            "assetAddressing": "bundled-path-before-publication; walrus-quilt-id+identifier-after-publication",
            "manifestIdentifier": "animacraft-manifest.json",
        },
        "parts": parts,
        "rules": [],
        "paletteLinks": [],
        "livingContent": living_content(config),
        "assets": assets,
        "disclosure": {
            "aiAssisted": True,
            "modelPath": "OpenAI built-in image generation",
            "humanCuration": "Prompt design, selection, chroma cleanup, atlas slicing, composition, metadata, and QA by Animacraft Atelier.",
            "inspirationBoundary": "Uses the general layered maker interaction pattern; no third-party maker artwork or named character was used as an input asset.",
        },
    }


def compose_cover(config: dict, pack_dir: Path, out_dir: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="animacraft-cover-") as temp_dir:
        subject = Path(temp_dir) / "subject.png"
        keyed_png(pack_dir / config["master"], subject)
        foreground = Image.open(subject).convert("RGBA").resize((CANVAS, CANVAS), Image.Resampling.LANCZOS)
        background = Image.open(out_dir / "layers" / "background" / f"{config['backgrounds'][0]}.png").convert("RGBA")
        Image.alpha_composite(background, foreground).save(out_dir / "cover.png", optimize=True)


def build_maker(maker_id: str, config: dict) -> None:
    pack_dir = PACKS_ROOT / maker_id
    out_dir = PUBLIC_ROOT / maker_id
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    for part_key, (atlas_name, item_names) in config["atlases"].items():
        crop_atlas(pack_dir / atlas_name, item_names, out_dir / "layers" / part_key)
    for outfit_name in config["atlases"]["outfit"][1]:
        translate_layer(out_dir / "layers" / "outfit" / f"{outfit_name}.png", 0, 330)
    for expression_name in config["atlases"]["expression"][1]:
        compress_expression(out_dir / "layers" / "expression" / f"{expression_name}.png")
    for accessory_name, (scale, center) in config["accessoryTransforms"].items():
        place_layer(out_dir / "layers" / "accessory" / f"{accessory_name}.png", scale, center)
    empty_layer(out_dir / "layers" / "accessory" / "none.png")
    for background_name in config["backgrounds"]:
        make_background(maker_id, background_name, out_dir / "layers" / "background" / f"{background_name}.png")
    compose_cover(config, pack_dir, out_dir)
    manifest = build_manifest(maker_id, config, out_dir)
    (out_dir / "animacraft-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    for maker_id, config in MAKERS.items():
        build_maker(maker_id, config)
        print(f"built {maker_id}")


if __name__ == "__main__":
    main()
