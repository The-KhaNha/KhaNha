// Local only: the image pipeline (P3.3) with a real queue and the local store. Completing an upload sends
// media.uploaded to q_media; the worker's handler turns the original into WebP variants without metadata, marks the
// upload PROCESSED (media.processed) and removes the original. A file that is not a photo fails the upload and
// dead-letters nothing; a repeat or a redelivery changes nothing.
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mediaStore } from '../../src/integrations/media';
import { mediaHandler } from '../../src/jobs/media';
import { runQueue, type QueueMessage } from '../../src/jobs/runner';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import { createStoreMember, deleteTestStores, localSql, type TestUser } from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const brandIds: string[] = [];
const storeIds: string[] = [];
const users: TestUser[] = [];
let storeId = '';
let manager: TestUser;
const log = pino({ level: 'silent' });

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Pipeline', slug: `pipeline-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandIds.push(brand.id);
  const { data: store } = await supabaseAdmin
    .from('stores')
    .insert({
      name: `Pipeline ${tag}`,
      slug: `store-pipeline-${tag}`,
      brand_id: brand.id,
      status: 'ACTIVE',
      tagline: 'Test',
      description: 'A store for media-pipeline.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  storeId = store.id;
  storeIds.push(storeId);
  manager = await createStoreMember(storeId, 'MANAGER');
  users.push(manager);
  localSql(`select pgmq.purge_queue('q_media')`);
}, 60_000);

afterAll(async () => {
  localSql(`select pgmq.purge_queue('q_media')`);
  await supabaseAdmin.from('domain_events').delete().eq('store_id', storeId);
  await deleteTestStores(storeIds, brandIds, users);
});

const base = () => `/api/stores/${storeId}/media/uploads`;
const auth = () => ({ Authorization: `Bearer ${manager.token}` });

/** Start, send and complete an upload through the API: the row is UPLOADED and media.uploaded is on q_media. */
async function uploaded(bytes: Buffer, contentType = 'image/jpeg') {
  const start = await api().post(base()).set(auth()).send({ contentType, byteSize: bytes.length });
  expect(start.status).toBe(201);
  const { uploadId } = start.body;
  // The local PUT checks the first bytes; write the original straight to the store to test what the worker checks.
  await mediaStore().write(
    `stores/${storeId}/uploads/${uploadId}.${contentType === 'image/png' ? 'png' : 'jpg'}`,
    bytes,
    contentType,
  );
  await supabaseAdmin
    .from('media_uploads')
    .update({ status: 'UPLOADED' })
    .eq('id', uploadId)
    .throwOnError();
  return uploadId as string;
}

function message(uploadId: string): QueueMessage<{ key: string }> {
  return {
    msgId: 0,
    attempt: 1,
    enqueuedAt: new Date().toISOString(),
    event: {
      eventId: randomUUID(),
      type: 'media.uploaded',
      aggregateId: uploadId,
      storeId,
      payload: { key: '' },
      actor: null,
      requestId: 'test-request',
      occurredAt: new Date().toISOString(),
    },
  };
}
const handle = (uploadId: string) =>
  mediaHandler.handle(message(uploadId), { log, signal: new AbortController().signal });

const row = async (id: string) =>
  (
    await supabaseAdmin
      .from('media_uploads')
      .select('status, variants, failure, original_key')
      .eq('id', id)
      .single()
      .throwOnError()
  ).data;

/** A 1200×800 JPEG, stored rotated (EXIF orientation 6: shown 90° clockwise) and carrying a copyright tag. */
const photo = () =>
  sharp({ create: { width: 1200, height: 800, channels: 3, background: '#c0392b' } })
    .jpeg()
    .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'secret-owner' } } })
    .toBuffer();

describe('the media handler', () => {
  it('a completed upload reaches q_media, and the worker makes WebP variants without metadata', async () => {
    const bytes = await photo();
    const { uploadId } = (
      await api()
        .post(base())
        .set(auth())
        .send({ contentType: 'image/jpeg', byteSize: bytes.length })
    ).body;
    expect(
      (
        await api()
          .put(`${base()}/${uploadId}/file`)
          .set(auth())
          .set('Content-Type', 'image/jpeg')
          .send(bytes)
      ).status,
    ).toBe(204);
    expect((await api().post(`${base()}/${uploadId}/complete`).set(auth()).send()).status).toBe(
      200,
    );

    const stop = new AbortController();
    const running = runQueue(mediaHandler, { signal: stop.signal, log, pollSeconds: 1 });
    const deadline = Date.now() + 15_000;
    while ((await row(uploadId)).status !== 'PROCESSED' && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 100));
    stop.abort();
    await running;

    const done = await row(uploadId);
    expect(done.status).toBe('PROCESSED');
    // Rotated by the EXIF orientation: the 800-wide side is the width now, so 900w is not enlarged past it.
    expect(done.variants).toEqual([
      { width: 400, height: 600, key: expect.stringMatching(/-400\.webp$/) },
      { width: 800, height: 1200, key: expect.stringMatching(/-900\.webp$/) },
    ]);
    const variants = done.variants as { key: string }[];
    for (const { key } of variants) {
      expect(key.startsWith(`stores/${storeId}/variants/`)).toBe(true);
      const bytes = await mediaStore().read(key);
      const meta = await sharp(bytes ?? Buffer.alloc(0)).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
    }
    expect(await mediaStore().size(done.original_key)).toBeNull();
    // The original is gone, so the upload is served by its largest variant.
    const read = await api().get(`${base()}/${uploadId}`).set(auth());
    expect(read.body.upload).toMatchObject({
      status: 'PROCESSED',
      url: `/media/${variants[1]?.key}`,
      variants: [
        { width: 400, height: 600, url: `/media/${variants[0]?.key}` },
        { width: 800, height: 1200, url: `/media/${variants[1]?.key}` },
      ],
    });
    expect((await api().get(read.body.upload.url)).status).toBe(200);
    const { data: events } = await supabaseAdmin
      .from('domain_events')
      .select('type, actor, request_id')
      .eq('aggregate_id', uploadId)
      .eq('type', 'media.processed')
      .throwOnError();
    expect(events).toEqual([
      { type: 'media.processed', actor: { type: 'WORKER' }, request_id: expect.any(String) },
    ]);
  });

  it('a renamed text file fails the upload, and nothing is dead-lettered', async () => {
    const uploadId = await uploaded(Buffer.from('just some text, not a photo at all'), 'image/png');
    await handle(uploadId);
    const done = await row(uploadId);
    // The reason the manager sees is ours, never the decoder's own words; the refused bytes are not kept.
    expect(done).toMatchObject({ status: 'FAILED', variants: null, failure: 'not a photo' });
    expect(await mediaStore().size(done.original_key)).toBeNull();
    const { data: dead } = await supabaseAdmin
      .from('job_failures')
      .select('id')
      .eq('queue_name', 'q_media')
      .throwOnError();
    expect(dead).toEqual([]);
  });

  it('the same message twice leaves one set of variants; a redelivery never reads the store', async () => {
    const uploadId = await uploaded(await photo());
    await handle(uploadId);
    const first = await row(uploadId);
    // An original left behind (the removal failed after the mark) is removed by the redelivery.
    await mediaStore().write(first.original_key, Buffer.from('left over'), 'image/jpeg');
    const read = vi.spyOn(mediaStore(), 'read');
    try {
      await handle(uploadId);
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
    expect(await mediaStore().size(first.original_key)).toBeNull();
    expect(await row(uploadId)).toEqual(first);
    const { data: events } = await supabaseAdmin
      .from('domain_events')
      .select('id')
      .eq('aggregate_id', uploadId)
      .eq('type', 'media.processed')
      .throwOnError();
    expect(events).toHaveLength(1);
  });

  it('a photo over 6000 pixels on a side fails; one at 6000×6000 processes within the memory budget', async () => {
    const big = (w: number, h: number) =>
      sharp({
        create: {
          width: w,
          height: h,
          channels: 3,
          background: '#808080',
          noise: { type: 'gaussian' as const, mean: 128, sigma: 30 },
        },
      })
        .jpeg({ quality: 40 })
        .toBuffer();
    const tooWide = await uploaded(await big(6001, 10));
    await handle(tooWide);
    expect((await row(tooWide)).failure).toBe('larger than 6000 pixels on a side');

    const largest = await big(6000, 6000);
    expect(largest.length).toBeLessThanOrEqual(8 * 1024 * 1024);
    const uploadId = await uploaded(largest);
    const before = process.memoryUsage().rss;
    let peak = before;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss);
    }, 10);
    try {
      await handle(uploadId);
    } finally {
      clearInterval(sampler);
    }
    expect((await row(uploadId)).status).toBe('PROCESSED');
    // The worker container shares a 1 GB host with the API: its photo work must stay well under half of it.
    expect((peak - before) / 1024 / 1024).toBeLessThan(400);
  }, 60_000);
});
