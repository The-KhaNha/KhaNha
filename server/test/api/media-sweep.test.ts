// Local only: a processed photo on an item (P3.3), and the nightly media sweep with an injected clock. An item saved
// with a processed upload of its store shows the 900w variant and offers a srcset; anything else is UPLOAD_INVALID.
// The sweep removes abandoned uploads and their originals, and a processed upload nothing shows after 24 hours with
// its variants; a variant an item or an old order still shows stays.
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mediaStore } from '../../src/integrations/media';
import { mediaHandler, sweepMedia } from '../../src/jobs/media';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import { createStoreMember, deleteTestStores, localSql, type TestUser } from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const brandIds: string[] = [];
const storeIds: string[] = [];
const users: TestUser[] = [];
let storeId = '';
let otherStoreId = '';
let manager: TestUser;
const log = pino({ level: 'silent' });
const HOUR = 60 * 60 * 1000;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOUR);

async function makeStore(name: string) {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name, slug: `${name.toLowerCase()}-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandIds.push(brand.id);
  const { data: store } = await supabaseAdmin
    .from('stores')
    .insert({
      name: `${name} ${tag}`,
      slug: `store-${name.toLowerCase()}-${tag}`,
      brand_id: brand.id,
      status: 'ACTIVE',
      tagline: 'Test',
      description: 'A store for media-sweep.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  storeIds.push(store.id);
  return store.id;
}

beforeAll(async () => {
  storeId = await makeStore('Sweep');
  otherStoreId = await makeStore('Elsewhere');
  manager = await createStoreMember(storeId, 'MANAGER');
  users.push(manager);
}, 60_000);

afterAll(async () => {
  await deleteTestStores(storeIds, brandIds, users);
});

/** An upload the worker processed: two variant objects in the local store and its PROCESSED row. */
async function processedUpload(store = storeId) {
  const id = randomUUID();
  const hash = randomUUID().replaceAll('-', '').slice(0, 16);
  const variants = [400, 900].map((width) => ({
    width,
    height: width,
    key: `stores/${store}/variants/${hash}-${width}.webp`,
  }));
  for (const { key } of variants)
    await mediaStore().write(key, Buffer.from('webp bytes'), 'image/webp');
  await supabaseAdmin
    .from('media_uploads')
    .insert({
      id,
      store_id: store,
      original_key: `stores/${store}/uploads/${id}.jpg`,
      content_type: 'image/jpeg',
      byte_size: 10,
      status: 'PROCESSED',
      variants,
      processed_at: new Date().toISOString(),
    })
    .throwOnError();
  return { id, keys: variants.map((v) => v.key) };
}

const exists = async (key: string) => (await mediaStore().size(key)) !== null;
const rowExists = async (id: string) =>
  (await supabaseAdmin.from('media_uploads').select('id').eq('id', id).throwOnError()).data.length >
  0;

const items = () => `/api/stores/${storeId}/menu-items`;
const auth = () => ({ Authorization: `Bearer ${manager.token}` });
const createItem = (body: object) =>
  api()
    .post(items())
    .set(auth())
    .send({ name: `Dosa ${randomUUID().slice(0, 6)}`, price: 80, category: 'Mains', ...body });

describe('a photo on an item', () => {
  it('a processed upload shows its 900w variant and offers both sizes; null removes it', async () => {
    const upload = await processedUpload();
    const created = await createItem({ imageUploadId: upload.id });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject({
      imageUrl: `/media/${upload.keys[1]}`,
      imageSrcSet: `/media/${upload.keys[0]} 400w, /media/${upload.keys[1]} 900w`,
    });
    const cleared = await api()
      .patch(`${items()}/${created.body.item.id}`)
      .set(auth())
      .send({ imageUploadId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.item).toMatchObject({ imageUrl: null, imageSrcSet: null });
  });

  it.each([
    ['not processed yet', 'UPLOADED' as const],
    ['failed', 'FAILED' as const],
  ])('an upload that is %s is UPLOAD_INVALID, and the item is not made', async (_label, status) => {
    const id = randomUUID();
    await supabaseAdmin
      .from('media_uploads')
      .insert({
        id,
        store_id: storeId,
        original_key: `stores/${storeId}/uploads/${id}.jpg`,
        content_type: 'image/jpeg',
        byte_size: 10,
        status,
        failure: status === 'FAILED' ? 'not a photo' : null,
      })
      .throwOnError();
    const res = await createItem({ imageUploadId: id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'UPLOAD_INVALID', details: { reason: 'state' } });
  });

  it("another store's upload, or one swept away, is UPLOAD_INVALID", async () => {
    const elsewhere = await processedUpload(otherStoreId);
    expect((await createItem({ imageUploadId: elsewhere.id })).body.error.code).toBe(
      'UPLOAD_INVALID',
    );
    expect((await createItem({ imageUploadId: randomUUID() })).body.error.code).toBe(
      'UPLOAD_INVALID',
    );
  });
});

describe('the nightly sweep', () => {
  it('an abandoned upload loses its original and its row after 24 hours', async () => {
    const id = randomUUID();
    const key = `stores/${storeId}/uploads/${id}.jpg`;
    await mediaStore().write(key, Buffer.from('original'), 'image/jpeg');
    await supabaseAdmin
      .from('media_uploads')
      .insert({
        id,
        store_id: storeId,
        original_key: key,
        content_type: 'image/jpeg',
        byte_size: 8,
      })
      .throwOnError();
    await sweepMedia(at(23), { log });
    expect(await rowExists(id)).toBe(true);
    await sweepMedia(at(25), { log });
    expect(await rowExists(id)).toBe(false);
    expect(await exists(key)).toBe(false);
  });

  it('a processed upload nobody attached survives 1 hour and is gone with its variants at 25', async () => {
    const upload = await processedUpload();
    await sweepMedia(at(1), { log });
    expect(await rowExists(upload.id)).toBe(true);
    expect(await exists(upload.keys[0] ?? '')).toBe(true);
    await sweepMedia(at(25), { log });
    expect(await rowExists(upload.id)).toBe(false);
    for (const key of upload.keys) expect(await exists(key)).toBe(false);
  });

  it('one attached at 23 hours keeps its variants and its row', async () => {
    const upload = await processedUpload();
    await sweepMedia(at(23), { log });
    expect((await createItem({ imageUploadId: upload.id })).status).toBe(201);
    await sweepMedia(at(25), { log });
    expect(await rowExists(upload.id)).toBe(true);
    for (const key of upload.keys) expect(await exists(key)).toBe(true);
  });

  it('a variant an old order still shows survives, after the item lost its photo', async () => {
    const upload = await processedUpload();
    const item = (await createItem({ imageUploadId: upload.id })).body.item;
    const { data: order } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: manager.id,
        store_id: storeId,
        store_name: 'Sweep',
        customer_name: 'Test',
        total_paise: 8000,
        estimated_ready_at: new Date().toISOString(),
        status: 'COLLECTED',
      })
      .select('id')
      .single()
      .throwOnError();
    await supabaseAdmin
      .from('order_items')
      .insert({
        order_id: order.id,
        line_number: 1,
        menu_item_id: item.id,
        name: item.name,
        category: 'Mains',
        quantity: 1,
        reserved_quantity: 0,
        unit_price_paise: 8000,
        line_total_paise: 8000,
        image_url: item.imageUrl,
      })
      .throwOnError();
    await api().patch(`${items()}/${item.id}`).set(auth()).send({ imageUploadId: null });
    await sweepMedia(at(25), { log });
    expect(await rowExists(upload.id)).toBe(true);
    expect(await exists(upload.keys[1] ?? '')).toBe(true);
  });

  it('two uploads of the same photo: the variants stay while the other still holds them', async () => {
    const kept = await processedUpload();
    const id = randomUUID();
    await supabaseAdmin
      .from('media_uploads')
      .insert({
        id,
        store_id: storeId,
        original_key: `stores/${storeId}/uploads/${id}.jpg`,
        content_type: 'image/jpeg',
        byte_size: 10,
        status: 'PROCESSED',
        variants: kept.keys.map((key, i) => ({ width: [400, 900][i], height: 1, key })),
        // Processed two days ago: due for the sweep, but the newer upload of the same photo is not.
        processed_at: new Date(Date.now() - 48 * HOUR).toISOString(),
      })
      .throwOnError();
    await sweepMedia(at(0), { log });
    expect(await rowExists(id)).toBe(false);
    for (const key of kept.keys) expect(await exists(key)).toBe(true);
  });

  it('runs nightly: the schedule emits media.sweep to q_media, and the handler sweeps by the time of the event', async () => {
    expect(
      localSql<{ schedule: string }>(`select schedule from cron.job where jobname = 'media-sweep'`),
    ).toEqual([{ schedule: '37 21 * * *' }]);
    localSql(`select pgmq.purge_queue('q_media')`);
    localSql(
      `select public.emit_event('media.sweep', 'media', gen_random_uuid(), null, '{}'::jsonb, '{"type":"SCHEDULER"}'::jsonb, null)`,
    );
    expect(
      localSql<{ type: string }>(`select message->>'type' as type from pgmq.q_q_media`),
    ).toEqual([{ type: 'media.sweep' }]);
    localSql(`select pgmq.purge_queue('q_media')`);

    const upload = await processedUpload();
    const sweep = (occurredAt: Date) =>
      mediaHandler.handle(
        {
          msgId: 0,
          attempt: 1,
          enqueuedAt: occurredAt.toISOString(),
          event: {
            eventId: randomUUID(),
            type: 'media.sweep',
            aggregateId: randomUUID(),
            storeId: null,
            payload: {},
            actor: { type: 'SCHEDULER' },
            requestId: null,
            occurredAt: occurredAt.toISOString(),
          },
        },
        { log, signal: new AbortController().signal },
      );
    await sweep(at(1));
    expect(await rowExists(upload.id)).toBe(true);
    await sweep(at(25));
    expect(await rowExists(upload.id)).toBe(false);
  });

  it('an item that takes the photo while the sweep runs keeps it', async () => {
    const upload = await processedUpload();
    const real = supabaseAdmin.rpc.bind(supabaseAdmin);
    let attached = false;
    // The manager attaches the upload after the sweep read its candidates, before it removes anything.
    const spy = vi.spyOn(supabaseAdmin, 'rpc').mockImplementation(((fn: string, args: object) => {
      const call = real(fn as 'media_upload_shown', args as never);
      if (fn !== 'media_sweep_candidates' || attached) return call;
      attached = true;
      return {
        throwOnError: async () => {
          const result = await call.throwOnError();
          expect((await createItem({ imageUploadId: upload.id })).status).toBe(201);
          return result;
        },
      };
    }) as unknown as typeof supabaseAdmin.rpc);
    try {
      await sweepMedia(at(25), { log });
    } finally {
      spy.mockRestore();
    }
    expect(attached).toBe(true);
    expect(await rowExists(upload.id)).toBe(true);
    for (const key of upload.keys) expect(await exists(key)).toBe(true);
  });

  it('an upload that cannot be removed is skipped, and the rest are swept', async () => {
    const broken = randomUUID();
    await supabaseAdmin
      .from('media_uploads')
      .insert({
        id: broken,
        store_id: storeId,
        // Not a key the store accepts: removing it throws.
        original_key: `not/a/media/key-${broken}.jpg`,
        content_type: 'image/jpeg',
        byte_size: 8,
        created_at: new Date(Date.now() - 2 * HOUR).toISOString(),
      })
      .throwOnError();
    const fine = await processedUpload();
    await sweepMedia(at(25), { log });
    expect(await rowExists(broken)).toBe(true);
    expect(await rowExists(fine.id)).toBe(false);
    await supabaseAdmin.from('media_uploads').delete().eq('id', broken).throwOnError();
  });
});
