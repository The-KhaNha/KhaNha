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
  const { data } = await supabaseAdmin.rpc('bundled_photo_refs').throwOnError();
  return data.reduce((sum, ref) => sum + ref.menu_rows + ref.order_rows, 0);
}

export async function migrateBundledPhotos(
  log: Logger,
  imagesDir = BUNDLED_DIR,
): Promise<{ photos: number; rows: number }> {
  const store = mediaStore();
  const { data: refs } = await supabaseAdmin.rpc('bundled_photo_refs').throwOnError();
  let photos = 0;
  let rows = 0;
  for (const ref of refs) {
    const name = BUNDLED.exec(ref.image_url)?.[1];
    const bytes = name ? await readFile(join(imagesDir, name)).catch(() => null) : null;
    if (!bytes) {
      log.warn({ storeId: ref.store_id, imageUrl: ref.image_url }, 'Bundled photo not found');
      continue;
    }
    const made = await makeVariants(ref.store_id, bytes);
    for (const { variant, bytes: webp } of made)
      await store.write(variant.key, webp, 'image/webp').catch((err: unknown) => {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      });
    const variants = made.map((m) => m.variant);
    const widest = variants[variants.length - 1];
    if (!widest) continue;
    const { data: moved } = await supabaseAdmin
      .rpc('move_bundled_photo', {
        p_store_id: ref.store_id,
        p_from: ref.image_url,
        p_to: store.publicPath(widest.key),
        p_variants: variants,
        p_actor: { type: 'SYSTEM' },
      })
      .throwOnError();
    photos += 1;
    rows += moved;
  }
  return { photos, rows };
}
