const BUNDLED_PHOTO = /^\/images\/([\w-]+)\.jpg$/;

/**
 * srcset for a photo shipped in client/public/images: the 400px thumbnail plus the 900px original, so a 112px card
 * downloads ~15 KB instead of ~60 KB. Both files are made by client/scripts/optimize-images.py. Any other URL (a
 * future Supabase Storage upload) has no variants and gets no srcset.
 */
export function photoSrcSet(src: string): string | undefined {
  const match = BUNDLED_PHOTO.exec(src);
  if (!match || match[1]!.endsWith('-400')) return undefined;
  return `/images/${match[1]}-400.jpg 400w, ${src} 900w`;
}
