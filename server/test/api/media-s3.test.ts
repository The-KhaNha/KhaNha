// Local only: the S3 media store against RustFS (compose's `media` service; a container in CI, where a missing one
// fails the run instead of skipping). The browser's presigned form uploads, and the bucket itself refuses a file of
// another size, key or type; the bucket is not readable without credentials. The store contract runs against both
// the local folder and the bucket.
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { localMediaStore } from '../../src/integrations/media/local';
import type { MediaStore, UploadTarget } from '../../src/integrations/media/port';
import {
  ensureMediaBucket,
  s3MediaStore,
  type S3MediaConfig,
} from '../../src/integrations/media/s3';
import { env } from '../../src/utils/env';
import { IntegrationError } from '../../src/utils/errors';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import { createStoreMember, deleteTestStores, type TestUser } from '../setup/helpers';

const config: S3MediaConfig = {
  bucket: env.MEDIA_BUCKET ?? 'khanha-test',
  region: env.AWS_REGION,
  endpoint: env.MEDIA_S3_ENDPOINT,
};
// Without a reachable bucket the S3 cases skip, except in CI, where they run and fail.
let run = false;
beforeAll(async () => {
  run =
    Boolean(process.env.CI) ||
    (await fetch(`${config.endpoint}/health`, { signal: AbortSignal.timeout(1000) })
      .then((res) => res.ok)
      .catch(() => false));
});

const tag = randomUUID().slice(0, 8);
const brandIds: string[] = [];
const storeIds: string[] = [];
const users: TestUser[] = [];
let storeId = '';
let manager: TestUser;

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (size: number) => Buffer.concat([PNG_HEAD, Buffer.alloc(size - PNG_HEAD.length, 7)]);
const base = () => `/api/stores/${storeId}/media/uploads`;
const auth = () => ({ Authorization: `Bearer ${manager.token}` });

/** What the browser does with the upload target: the form's fields, then the file. */
async function postForm(target: UploadTarget, bytes: Buffer, change: Record<string, string> = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries({ ...target.fields, ...change }))
    form.append(name, value);
  form.append('file', new Blob([new Uint8Array(bytes)]));
  return (await fetch(target.url, { method: 'POST', body: form })).status;
}

describe('the S3 store, through the API', () => {
  beforeEach((ctx) => {
    if (!run) ctx.skip();
  });
  beforeAll(async () => {
    if (!run) return;
    await ensureMediaBucket(config, [env.CLIENT_ORIGIN]);
    const { data: brand } = await supabaseAdmin
      .from('brands')
      .insert({ name: 'Media S3', slug: `media-s3-${tag}`, status: 'ACTIVE' })
      .select('id')
      .single()
      .throwOnError();
    brandIds.push(brand.id);
    const { data: store } = await supabaseAdmin
      .from('stores')
      .insert({
        name: `Media S3 ${tag}`,
        slug: `store-media-s3-${tag}`,
        brand_id: brand.id,
        status: 'ACTIVE',
        tagline: 'Test',
        description: 'A store for media-s3.test.ts',
      })
      .select('id')
      .single()
      .throwOnError();
    storeId = store.id;
    storeIds.push(storeId);
    manager = await createStoreMember(storeId, 'MANAGER');
    users.push(manager);
    env.MEDIA_STORAGE = 's3';
  }, 60_000);

  afterAll(async () => {
    env.MEDIA_STORAGE = 'local';
    if (!storeId) return;
    await supabaseAdmin.from('domain_events').delete().eq('store_id', storeId);
    await deleteTestStores(storeIds, brandIds, users);
  });

  const start = async (byteSize: number) => {
    const res = await api().post(base()).set(auth()).send({ contentType: 'image/png', byteSize });
    expect(res.status).toBe(201);
    return res.body as { uploadId: string; upload: UploadTarget };
  };
  const complete = (id: string) => api().post(`${base()}/${id}/complete`).set(auth()).send();

  it('the presigned form uploads straight to the bucket, and complete marks it UPLOADED', async () => {
    const bytes = png(300 * 1024);
    const { uploadId, upload } = await start(bytes.length);
    expect(upload).toMatchObject({
      method: 'POST',
      url: `${config.endpoint}/${config.bucket}`,
      fields: {
        key: `stores/${storeId}/uploads/${uploadId}.png`,
        'Content-Type': 'image/png',
      },
    });
    expect(await postForm(upload, bytes)).toBe(204);
    const done = await complete(uploadId);
    expect(done.status).toBe(200);
    expect(done.body.upload).toMatchObject({ status: 'UPLOADED', byteSize: bytes.length });
  });

  it.each([
    ['a larger file', png(200), {}],
    ['a smaller file', png(50), {}],
    ['another key', png(100), { key: `stores/${randomUUID()}/uploads/${randomUUID()}.png` }],
    ['another content type', png(100), { 'Content-Type': 'image/jpeg' }],
  ])('%s is refused by the bucket, and the upload stays unsent', async (_label, bytes, change) => {
    const { uploadId, upload } = await start(100);
    expect(await postForm(upload, bytes, change)).toBeGreaterThanOrEqual(400);
    expect((await complete(uploadId)).body.error.details.reason).toBe('notUploaded');
  });

  it('bytes that are not the declared type are refused at complete, and removed from the bucket', async () => {
    const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${'x'.repeat(60)}</svg>`);
    const { uploadId, upload } = await start(bytes.length);
    expect(await postForm(upload, bytes)).toBe(204);
    const res = await complete(uploadId);
    expect(res.status).toBe(400);
    expect(res.body.error.details.reason).toBe('content');
    expect(await s3MediaStore(config).size(upload.fields?.key ?? '')).toBeNull();
  });

  it('nothing in the bucket is readable without credentials', async () => {
    const bytes = png(100);
    const { uploadId, upload } = await start(bytes.length);
    expect(await postForm(upload, bytes)).toBe(204);
    const anonymous = await fetch(`${upload.url}/stores/${storeId}/uploads/${uploadId}.png`);
    expect(anonymous.status).toBe(403);
  });

  it('the upload URL is the browser’s view of the bucket when that differs from the API’s', async () => {
    const store = s3MediaStore({ ...config, uploadOrigin: 'http://localhost:9999' });
    const key = `stores/${randomUUID()}/uploads/${randomUUID()}.png`;
    const target = await store.createUpload(key, 'image/png', 10, randomUUID(), randomUUID());
    expect(target.url).toBe(`http://localhost:9999/${config.bucket}`);
    // A proxy's path prefix is kept.
    const prefixed = s3MediaStore({ ...config, uploadOrigin: 'http://localhost:9999/s3/' });
    expect((await prefixed.createUpload(key, 'image/png', 10, 'u', 's')).url).toBe(
      `http://localhost:9999/s3/${config.bucket}`,
    );
  });
});

describe('without a bucket the S3 store answers 503 and the API keeps running', () => {
  it('starting an upload is UPSTREAM_UNAVAILABLE', async () => {
    const bucket = env.MEDIA_BUCKET;
    const storeOnly = await createBareStore();
    env.MEDIA_STORAGE = 's3';
    env.MEDIA_BUCKET = undefined;
    try {
      const res = await api()
        .post(`/api/stores/${storeOnly.storeId}/media/uploads`)
        .set({ Authorization: `Bearer ${storeOnly.manager.token}` })
        .send({ contentType: 'image/png', byteSize: 10 });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    } finally {
      env.MEDIA_STORAGE = 'local';
      env.MEDIA_BUCKET = bucket;
      await deleteTestStores([storeOnly.storeId], [storeOnly.brandId], [storeOnly.manager]);
    }
  });
});

async function createBareStore() {
  const slug = `media-none-${randomUUID().slice(0, 8)}`;
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'No bucket', slug, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  const { data: store } = await supabaseAdmin
    .from('stores')
    .insert({
      name: `No bucket ${slug}`,
      slug: `store-${slug}`,
      brand_id: brand.id,
      status: 'ACTIVE',
      tagline: 'Test',
      description: 'A store for media-s3.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  return {
    brandId: brand.id,
    storeId: store.id,
    manager: await createStoreMember(store.id, 'MANAGER'),
  };
}

// The port's contract: both stores behave the same to the service.
const stores: [string, () => boolean, () => Promise<MediaStore>][] = [
  [
    'local',
    () => true,
    async () => localMediaStore(await mkdtemp(join(tmpdir(), 'media-contract-'))),
  ],
  ['s3', () => run, async () => s3MediaStore(config)],
];
describe.each(stores)('the %s store keeps the MediaStore contract', (_kind, enabled, make) => {
  it('write once, read, size, a missing key is null, remove', async (ctx) => {
    if (!enabled()) ctx.skip();
    const store = await make();
    const key = `stores/${randomUUID()}/uploads/${randomUUID()}.png`;
    expect(await store.size(key)).toBeNull();
    expect(await store.read(key)).toBeNull();
    await store.write(key, png(64), 'image/png');
    expect(await store.size(key)).toBe(64);
    expect(Buffer.compare((await store.read(key)) ?? Buffer.alloc(0), png(64))).toBe(0);
    await expect(store.write(key, png(32), 'image/png')).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await store.size(key)).toBe(64);
    await store.remove(key);
    expect(await store.size(key)).toBeNull();
    await expect(store.size('../../etc/passwd')).rejects.toThrow('Not a media key');
    expect(store.publicPath(key)).toBe(`/media/${key}`);
  });
});

describe("the S3 store's write answers", () => {
  const answer = (httpStatusCode: number) =>
    vi.spyOn(S3Client.prototype, 'send').mockRejectedValueOnce(
      new S3ServiceException({
        name: 'Conflict',
        $fault: 'client',
        $metadata: { httpStatusCode },
      }),
    );
  const key = `stores/${randomUUID()}/variants/${randomUUID()}.webp`;

  it('412: the key already holds bytes (EEXIST)', async () => {
    answer(412);
    await expect(
      s3MediaStore(config).write(key, Buffer.from('x'), 'image/webp'),
    ).rejects.toMatchObject({
      code: 'EEXIST',
    });
  });

  it('409: a conflicting write was in flight: retryable, never taken as stored', async () => {
    answer(409);
    const err = await s3MediaStore(config)
      .write(key, Buffer.from('x'), 'image/webp')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntegrationError);
    expect(err).toMatchObject({ retryable: true });
  });
});
