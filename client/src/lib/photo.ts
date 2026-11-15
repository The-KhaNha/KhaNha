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

/**
 * Spread onto the one image that is the page's largest paint (the store cover), so the browser fetches it before the
 * food photos discovered at the same moment. Lowercase on purpose: React 18 passes it through unchanged but does not
 * know the camelCase `fetchPriority` (React 19 does), and a spread keeps TypeScript's <img> types happy.
 */
export const LCP_IMAGE_PROPS = {
  fetchpriority: 'high',
  loading: 'eager',
  decoding: 'async',
} as const;
