// Local only: the bundled photos' move to the media store (P3.3 PR 12a). A store's items and its old order lines that
// show /images/<name>.jpg are repointed at that photo's media copy, made by the worker's own variant code, so order
// history keeps its photos; a second run changes nothing; `--check` fails while anything still points at /images/;
// production needs --production.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundledPhotoRows, migrateBundledPhotos } from '../../scripts/media-migration';
import { mediaStore } from '../../src/integrations/media';
import { supabaseAdmin } from '../../src/utils/supabase';
import { createTestUser, deleteTestStores, type TestUser } from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const log = pino({ level: 'silent' });
let storeId = '';
let brandId = '';
let customer: TestUser;
let itemId = '';
let orderId = '';

const cli = (args: string[], extraEnv: Record<string, string> = {}) =>
  spawnSync('pnpm', ['exec', 'tsx', 'scripts/migrate-media.ts', ...args], {
    encoding: 'utf8',
    env: { ...process.env, LOG_LEVEL: 'error', ...extraEnv },
  });

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Bundled', slug: `bundled-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  const { data: store } = await supabaseAdmin
    .from('stores')
    .insert({
      name: `Bundled ${tag}`,
      slug: `store-bundled-${tag}`,
      brand_id: brandId,
      status: 'ACTIVE',
      tagline: 'Test',
      description: 'A store for media-migration.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  storeId = store.id;
  customer = await createTestUser();
  const { data: item } = await supabaseAdmin
    .from('menu_items')
    .insert({
      store_id: storeId,
      category: 'Coffee',
      name: 'Espresso',
      description: 'Bold',
      price_paise: 9000,
      image_url: '/images/espresso.jpg',
    })
    .select('id')
    .single()
    .throwOnError();
  itemId = item.id;
  const { data: order } = await supabaseAdmin
    .from('orders')
    .insert({
      user_id: customer.id,
      store_id: storeId,
      store_name: 'Bundled',
      customer_name: 'Test',
      total_paise: 9000,
      estimated_ready_at: new Date().toISOString(),
      status: 'COLLECTED',
    })
    .select('id')
    .single()
    .throwOnError();
  orderId = order.id;
  await supabaseAdmin
    .from('order_items')
    .insert({
      order_id: orderId,
      line_number: 1,
      menu_item_id: itemId,
      name: 'Espresso',
      category: 'Coffee',
      quantity: 1,
      reserved_quantity: 0,
      unit_price_paise: 9000,
      line_total_paise: 9000,
      image_url: '/images/espresso.jpg',
    })
    .throwOnError();
}, 60_000);

afterAll(async () => {
  await deleteTestStores([storeId], [brandId], [customer]);
});

describe('migrate:media', () => {
  it('--check fails while a row still shows a bundled photo', async () => {
    expect(await bundledPhotoRows()).toBeGreaterThanOrEqual(2);
    const res = cli(['--check']);
    expect(res.status).not.toBe(0);
  });

  it('moves the item and the old order line to the media copy; a second run changes nothing', async () => {
    const first = await migrateBundledPhotos(log);
    expect(first.rows).toBeGreaterThanOrEqual(2);

    const { data: item } = await supabaseAdmin
      .from('menu_items')
      .select('image_url, image_variants')
      .eq('id', itemId)
      .single()
      .throwOnError();
    expect(item.image_url).toMatch(
      new RegExp(`^/media/stores/${storeId}/variants/[0-9a-f]{16}-900\\.webp$`),
    );
    const variants = item.image_variants as { key: string; width: number }[];
    expect(variants.map((v) => v.width)).toEqual([400, 900]);
    for (const { key } of variants) expect(await mediaStore().size(key)).not.toBeNull();

    const { data: line } = await supabaseAdmin
      .from('order_items')
      .select('image_url')
      .eq('order_id', orderId)
      .single()
      .throwOnError();
    // The old order shows the same photo at its new address.
    expect(line.image_url).toBe(item.image_url);

    expect(await migrateBundledPhotos(log)).toEqual({ photos: 0, rows: 0 });
    expect(await bundledPhotoRows()).toBe(0);
    expect(cli(['--check']).status).toBe(0);
  });

  it('a null where a path or the variants belong is refused, never written', async () => {
    for (const args of [
      { p_to: null },
      { p_from: null },
      { p_variants: null },
      { p_store_id: null },
    ]) {
      const { error } = await supabaseAdmin.rpc('move_bundled_photo', {
        p_store_id: storeId,
        p_from: '/images/espresso.jpg',
        p_to: '/media/stores/x/variants/y-900.webp',
        p_variants: [],
        ...(args as object),
      } as never);
      expect(error?.message).toBe('VALIDATION_ERROR');
    }
  });

  it('refuses production without --production, and --production anywhere else', () => {
    // MEDIA_STORAGE=s3: production refuses local storage before the script would get that far.
    const prod = cli([], { APP_ENV: 'production', MEDIA_STORAGE: 's3' });
    expect(prod.status).not.toBe(0);
    expect(prod.stdout + prod.stderr).toContain('pass --production');
    const local = cli(['--production']);
    expect(local.status).not.toBe(0);
    expect(local.stdout + local.stderr).toContain('APP_ENV is local');
  });
});
