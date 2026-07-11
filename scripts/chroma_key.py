"""Deterministic chroma-key removal for Animacraft creator-pack builds."""

from __future__ import annotations

from pathlib import Path
from statistics import median

from PIL import Image


Color = tuple[int, int, int]
KEY_DOMINANCE_THRESHOLD = 16.0
ALPHA_NOISE_FLOOR = 8


def _clamp(value: float) -> int:
    return max(0, min(255, int(round(value))))


def _spill_channels(key: Color) -> list[int]:
    key_max = max(key)
    if key_max < 128:
        return []
    return [index for index, value in enumerate(key) if value >= key_max - 16 and value >= 128]


def _dominance(rgb: Color, key: Color) -> float:
    spill = _spill_channels(key)
    if not spill:
        return 0.0
    channels = [float(value) for value in rgb]
    other = [index for index in range(3) if index not in spill]
    key_strength = min(channels[index] for index in spill)
    return key_strength - max((channels[index] for index in other), default=0.0)


def _dominance_alpha(rgb: Color, key: Color) -> int:
    spill = _spill_channels(key)
    if not spill:
        return 255
    channels = [float(value) for value in rgb]
    other = [index for index in range(3) if index not in spill]
    key_strength = min(channels[index] for index in spill)
    other_strength = max((channels[index] for index in other), default=0.0)
    dominance = key_strength - other_strength
    if dominance <= 0:
        return 255
    denominator = max(1.0, float(max(key)) - other_strength)
    return _clamp((1.0 - min(1.0, dominance / denominator)) * 255.0)


def _soft_alpha(distance: int, transparent_threshold: int, opaque_threshold: int) -> int:
    if distance <= transparent_threshold:
        return 0
    if distance >= opaque_threshold:
        return 255
    ratio = (distance - transparent_threshold) / (opaque_threshold - transparent_threshold)
    smooth = ratio * ratio * (3.0 - 2.0 * ratio)
    return _clamp(255.0 * smooth)


def _sample_border_key(image: Image.Image) -> Color:
    width, height = image.size
    pixels = image.load()
    samples: list[Color] = []
    band = max(1, min(width, height, 6))
    step = max(1, min(width, height) // 256)
    for x in range(0, width, step):
        for y in range(band):
            samples.append(pixels[x, y][:3])
            samples.append(pixels[x, height - 1 - y][:3])
    for y in range(0, height, step):
        for x in range(band):
            samples.append(pixels[x, y][:3])
            samples.append(pixels[width - 1 - x, y][:3])
    return tuple(int(round(median(sample[channel] for sample in samples))) for channel in range(3))


def _despill(rgb: Color, key: Color, alpha: int) -> Color:
    if alpha >= 252:
        return rgb
    spill = _spill_channels(key)
    if not spill:
        return rgb
    channels = [float(value) for value in rgb]
    other = [index for index in range(3) if index not in spill]
    cap = max(0.0, max((channels[index] for index in other), default=0.0) - 1.0)
    for index in spill:
        channels[index] = min(channels[index], cap)
    return tuple(_clamp(value) for value in channels)


def remove_chroma_key(
    source: Path,
    destination: Path,
    *,
    transparent_threshold: int,
    opaque_threshold: int,
) -> None:
    if not 0 <= transparent_threshold < opaque_threshold <= 255:
        raise ValueError("Chroma thresholds must satisfy 0 <= transparent < opaque <= 255.")
    with Image.open(source) as opened:
        image = opened.convert("RGBA")
    key = _sample_border_key(image)
    pixels = image.load()
    width, height = image.size

    for y in range(height):
        for x in range(width):
            red, green, blue, source_alpha = pixels[x, y]
            rgb = (red, green, blue)
            distance = max(abs(rgb[channel] - key[channel]) for channel in range(3))
            key_like = distance <= 32 or _dominance(rgb, key) >= KEY_DOMINANCE_THRESHOLD
            output_alpha = min(
                _soft_alpha(distance, transparent_threshold, opaque_threshold),
                _dominance_alpha(rgb, key),
            ) if key_like else 255
            output_alpha = round(output_alpha * source_alpha / 255.0)
            if output_alpha <= ALPHA_NOISE_FLOOR:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            red, green, blue = _despill(rgb, key, output_alpha) if key_like else rgb
            pixels[x, y] = (red, green, blue, output_alpha)

    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, format="PNG", optimize=True)
