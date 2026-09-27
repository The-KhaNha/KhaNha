#!/usr/bin/env python3
"""Compress menu photos in client/public/images and write the 400px thumbnail each one needs.

    python3 client/scripts/optimize-images.py        # needs Pillow: pip3 install pillow

For every `<name>.jpg` without a `<name>-400.jpg` next to it:
  - `<name>.jpg` is re-encoded in place: at most 900px wide, progressive JPEG, quality 72, metadata stripped;
  - `<name>-400.jpg` is written at 400px wide with the same settings.
FoodPhoto serves the 400px file to thumbnails through srcset (lib/photo.ts), so every photo needs both files;
client/src/lib/photo.test.ts fails when one is missing. Photos that already have a thumbnail are skipped, so running
this again never re-compresses (and degrades) an image twice. File names stay the same because the database stores
them in `image_url`.
"""
from pathlib import Path

from PIL import Image

IMAGES = Path(__file__).resolve().parent.parent / 'public' / 'images'
FULL_WIDTH = 900
THUMB_WIDTH = 400
SETTINGS = {'quality': 72, 'optimize': True, 'progressive': True}


def resized(image: Image.Image, width: int) -> Image.Image:
    if image.width <= width:
        return image
    return image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)


def main() -> None:
    for full in sorted(IMAGES.glob('*.jpg')):
        thumb = full.with_name(f'{full.stem}-{THUMB_WIDTH}.jpg')
        if full.stem.endswith(f'-{THUMB_WIDTH}') or thumb.exists():
            continue
        before = full.stat().st_size
        image = Image.open(full).convert('RGB')
        resized(image, FULL_WIDTH).save(full, 'JPEG', **SETTINGS)
        resized(image, THUMB_WIDTH).save(thumb, 'JPEG', **SETTINGS)
        print(f'{full.name}: {before // 1024} KB -> {full.stat().st_size // 1024} KB, '
              f'{thumb.name} {thumb.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
