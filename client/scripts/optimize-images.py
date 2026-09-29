#!/usr/bin/env python3
"""Compress menu photos in client/public/images and write the 400px thumbnail each one needs.

    python3 client/scripts/optimize-images.py            # needs Pillow: pip3 install pillow
    python3 client/scripts/optimize-images.py --refit    # also re-encode full-size photos over the budget

For every `<name>.jpg` without a `<name>-400.jpg` next to it:
  - `<name>.jpg` is re-encoded in place: at most 900px wide, progressive JPEG, metadata stripped, quality 72, or
    lower (down to 50) until it fits the ~80 KB photo budget (CLAUDE.md §2b);
  - `<name>-400.jpg` is written at 400px wide with the same settings.
FoodPhoto serves the 400px file to thumbnails through srcset (lib/photo.ts), so every photo needs both files;
client/src/lib/photo.test.ts fails when one is missing or over the budget. Photos that already have a thumbnail are
skipped, so running this again never re-compresses (and degrades) an image twice; `--refit` re-encodes only the
full-size photos that are over the budget. File names stay the same because the database stores them in `image_url`.
"""
import io
import sys
from pathlib import Path

from PIL import Image

IMAGES = Path(__file__).resolve().parent.parent / 'public' / 'images'
FULL_WIDTH = 900
THUMB_WIDTH = 400
BUDGET_BYTES = 80 * 1024
QUALITIES = (72, 68, 64, 60, 56, 52, 50)
SETTINGS = {'optimize': True, 'progressive': True}


def resized(image: Image.Image, width: int) -> Image.Image:
    if image.width <= width:
        return image
    return image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)


def save_within_budget(image: Image.Image, path: Path) -> int:
    """Saves at the highest quality that fits the budget (or the lowest allowed); returns the quality used."""
    for quality in QUALITIES:
        buffer = io.BytesIO()
        image.save(buffer, 'JPEG', quality=quality, **SETTINGS)
        if buffer.tell() <= BUDGET_BYTES or quality == QUALITIES[-1]:
            path.write_bytes(buffer.getvalue())
            return quality
    raise AssertionError('unreachable')


def main() -> None:
    refit = '--refit' in sys.argv[1:]
    for full in sorted(IMAGES.glob('*.jpg')):
        if full.stem.endswith(f'-{THUMB_WIDTH}'):
            continue
        thumb = full.with_name(f'{full.stem}-{THUMB_WIDTH}.jpg')
        before = full.stat().st_size
        if thumb.exists():
            if not (refit and before > BUDGET_BYTES):
                continue
            quality = save_within_budget(Image.open(full).convert('RGB'), full)
            print(f'{full.name}: {before // 1024} KB -> {full.stat().st_size // 1024} KB (quality {quality})')
            continue
        image = Image.open(full).convert('RGB')
        quality = save_within_budget(resized(image, FULL_WIDTH), full)
        save_within_budget(resized(image, THUMB_WIDTH), thumb)
        print(f'{full.name}: {before // 1024} KB -> {full.stat().st_size // 1024} KB (quality {quality}), '
              f'{thumb.name} {thumb.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
