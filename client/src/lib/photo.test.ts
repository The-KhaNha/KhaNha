import { describe, expect, it } from 'vitest';
import { photoSrcSet } from './photo';

// Each bundled photo as a base64 data URL, only to measure its size (CLAUDE.md §2b: ~80 KB per photo).
const inlined = import.meta.glob<string>('../../public/images/*.jpg', {
  eager: true,
  query: '?inline',
  import: 'default',
});
const PHOTO_BUDGET_BYTES = 80 * 1024;

// File names only: the modules are never loaded.
const bundled = Object.keys(import.meta.glob('../../public/images/*.jpg')).map((path) =>
  path.split('/').pop()!,
);

describe('photoSrcSet', () => {
  it('pairs a bundled photo with its 400px thumbnail', () => {
    expect(photoSrcSet('/images/espresso.jpg')).toBe(
      '/images/espresso-400.jpg 400w, /images/espresso.jpg 900w',
    );
  });

  it('leaves other URLs alone', () => {
    expect(photoSrcSet('https://abc.supabase.co/storage/v1/object/public/x.jpg')).toBeUndefined();
    expect(photoSrcSet('/images/espresso-400.jpg')).toBeUndefined();
    expect(photoSrcSet('/images/../secret.jpg')).toBeUndefined();
  });

  it('finds a thumbnail for every bundled photo (run client/scripts/optimize-images.py)', () => {
    const photos = bundled.filter((f) => !f.endsWith('-400.jpg'));
    expect(photos.length).toBeGreaterThan(0);
    const missing = photos.filter((f) => !bundled.includes(f.replace(/\.jpg$/, '-400.jpg')));
    expect(missing).toEqual([]);
  });

  it('keeps every bundled photo within the ~80 KB budget (optimize-images.py --refit)', () => {
    const over = Object.entries(inlined)
      .map(([path, url]) => ({
        file: path.split('/').pop()!,
        bytes: (url.length - url.indexOf(',') - 1) * 0.75,
      }))
      .filter(({ bytes }) => bytes > PHOTO_BUDGET_BYTES)
      .map(({ file, bytes }) => `${file} ${Math.round(bytes / 1024)} KB`);
    expect(over).toEqual([]);
  });
});
