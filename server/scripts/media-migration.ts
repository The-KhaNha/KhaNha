// The bundled photos' move to the media store (P3.3 PR 12a), shared by `pnpm run migrate:media` and the seed: each
// (store, /images/<name>.jpg) a menu item or an order line still shows goes through the worker's own variant code, and
// bundled_photo_refs / move_bundled_photo repoint that store's rows at the media copy. Safe to repeat: the variant keys
// are content-addressed and a moved row is no longer found.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Logger } from 'pino';
import { mediaStore } from '../src/integrations/media';
import { makeVariants } from '../src/jobs/media';
import { supabaseAdmin } from '../src/utils/supabase';

/** Where the bundled photos are, from server/ (the scripts run there). */
export const BUNDLED_DIR = resolve(process.cwd(), '../client/public/images');
const BUNDLED = /^\/images\/([\w-]+\.jpg)$/;

/** Rows of menu_items and order_items that still point at a bundled photo. */
export async function bundledPhotoRows(): Promise<number> {
  const { data } = await supabaseAdmin.rpc('bundled_photo_row_count').throwOnError();
  return data;
}

export async function migrateBundledPhotos(
  log: Logger,
  imagesDir = BUNDLED_DIR,
): Promise<{ photos: number; rows: number }> {
  let photos = 0;
  let rows = 0;
  // The Data API returns at most 1000 references a call. A moved reference leaves the result, so each pass reads the
  // ones left; a pass that moves nothing (only photos whose file is missing are left) is the last.
  for (;;) {
    let moved = 0;
    for (const ref of (await supabaseAdmin.rpc('bundled_photo_refs').throwOnError()).data) {
      const n = await moveOne(ref, imagesDir, log);
      if (n === null) continue;
      photos += 1;
      moved += n;
    }
    rows += moved;
    if (moved === 0) return { photos, rows };
  }
}

/** One store's bundled photo to its media copy: the rows moved, or null when its file is missing. */
async function moveOne(
  ref: { store_id: string; image_url: string },
  imagesDir: string,
  log: Logger,
): Promise<number | null> {
  const store = mediaStore();
  const name = BUNDLED.exec(ref.image_url)?.[1];
  const bytes = name ? await readFile(join(imagesDir, name)).catch(() => null) : null;
  if (!bytes) {
    log.warn({ storeId: ref.store_id, imageUrl: ref.image_url }, 'Bundled photo not found');
    return null;
  }
  const made = await makeVariants(ref.store_id, bytes);
  for (const { variant, bytes: webp } of made)
    await store.write(variant.key, webp, 'image/webp').catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    });
  const variants = made.map((m) => m.variant);
  const widest = variants[variants.length - 1];
  if (!widest) return null;
  const { data: moved } = await supabaseAdmin
    .rpc('move_bundled_photo', {
      p_store_id: ref.store_id,
      p_from: ref.image_url,
      p_to: store.publicPath(widest.key),
      p_variants: variants,
      p_actor: { type: 'SYSTEM' },
    })
    .throwOnError();
  return moved;
}
