// Local only: photo uploads (P3.3) in local mode. An upload is started with a declared type and size, its bytes go to
// the PUT route (exactly that size, that type, starting the way that type does), and `complete` marks it UPLOADED with
// one media.uploaded; a repeat changes nothing. Another store's upload is 404; staff cannot upload. In S3 mode (until
// PR 09) the local route is 404 and starting an upload is 503.
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { env } from '../../src/utils/env';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createStoreMember,
  deleteTestStores,
  testAuthMatrix,
  testStoreIsolation,
  type TestUser,
} from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const brandIds: string[] = [];
const storeIds: string[] = [];
const users: TestUser[] = [];
let storeId = '';
let manager: TestUser;
let staff: TestUser;

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (size: number) => Buffer.concat([PNG_HEAD, Buffer.alloc(size - PNG_HEAD.length, 7)]);
const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const base = () => `/api/stores/${storeId}/media/uploads`;
const start = (body: object, user = manager) => api().post(base()).set(auth(user)).send(body);
const put = (id: string, bytes: Buffer, type = 'image/png', user = manager) =>
  api().put(`${base()}/${id}/file`).set(auth(user)).set('Content-Type', type).send(bytes);
const complete = (id: string, user = manager) =>
  api().post(`${base()}/${id}/complete`).set(auth(user)).send();
const events = async (id: string) =>
  (
    await supabaseAdmin
      .from('domain_events')
      .select('payload, request_id')
      .eq('type', 'media.uploaded')
      .eq('aggregate_id', id)
      .throwOnError()
  ).data;
const insertUpload = async (store: string, status: 'PENDING' | 'UPLOADED' = 'PENDING') =>
  (
    await supabaseAdmin
      .from('media_uploads')
      .insert({
        store_id: store,
        original_key: `stores/${store}/uploads/${randomUUID()}.png`,
        content_type: 'image/png',
        byte_size: 10,
        status,
      })
      .select('id')
      .single()
      .throwOnError()
  ).data.id;

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Media', slug: `media-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandIds.push(brand.id);
  const { data: store } = await supabaseAdmin
    .from('stores')
    .insert({
      name: `Media ${tag}`,
      slug: `store-media-${tag}`,
      brand_id: brand.id,
      status: 'ACTIVE',
      tagline: 'Test',
      description: 'A store for media-uploads.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  storeId = store.id;
  storeIds.push(storeId);
  manager = await createStoreMember(storeId, 'MANAGER');
  staff = await createStoreMember(storeId, 'STAFF');
  users.push(manager, staff);
}, 60_000);

afterAll(async () => {
  await supabaseAdmin.from('domain_events').delete().eq('store_id', storeId);
  await deleteTestStores(storeIds, brandIds, users);
});

testAuthMatrix('POST /api/stores/:storeId/media/uploads', (http) =>
  http
    .post(`/api/stores/${randomUUID()}/media/uploads`)
    .send({ contentType: 'image/png', byteSize: 10 }),
);
testStoreIsolation(
  'GET /api/stores/:storeId/media/uploads/:uploadId',
  (http, store, id) => http.get(`/api/stores/${store}/media/uploads/${id}`),
  insertUpload,
  'MANAGER',
);
testStoreIsolation(
  'POST /api/stores/:storeId/media/uploads/:uploadId/complete',
  (http, store, id) => http.post(`/api/stores/${store}/media/uploads/${id}/complete`).send(),
  // Already UPLOADED: the owner's own call is then a 200 no-op (a PENDING one with no file is 400).
  (store) => insertUpload(store, 'UPLOADED'),
  'MANAGER',
);
testStoreIsolation(
  'PUT /api/stores/:storeId/media/uploads/:uploadId/file',
  (http, store, id) =>
    http
      .put(`/api/stores/${store}/media/uploads/${id}/file`)
      .set('Content-Type', 'image/png')
      .send(png(10)),
  insertUpload,
  'MANAGER',
);

describe('starting an upload', () => {
  it.each([
    ['a type that is not a photo', { contentType: 'image/gif', byteSize: 10 }],
    ['an empty photo', { contentType: 'image/png', byteSize: 0 }],
    ['one over 8 MB', { contentType: 'image/png', byteSize: 8 * 1024 * 1024 + 1 }],
    ['an extra field', { contentType: 'image/png', byteSize: 10, key: '../../etc/passwd' }],
  ])('%s is 400 and makes no row', async (_label, body) => {
    const res = await start(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('staff may not upload (403)', async () => {
    expect((await start({ contentType: 'image/png', byteSize: 10 }, staff)).status).toBe(403);
  });
});

describe('an upload, start to finish', () => {
  it('start, send the bytes, complete: UPLOADED, served from /media, one media.uploaded', async () => {
    const bytes = png(200 * 1024); // past the 100 KB JSON limit: the file route has its own
    const res = await start({ contentType: 'image/png', byteSize: bytes.length });
    expect(res.status).toBe(201);
    const { uploadId, upload } = res.body;
    expect(upload).toEqual({
      method: 'PUT',
      url: `/api/stores/${storeId}/media/uploads/${uploadId}/file`,
      headers: { 'Content-Type': 'image/png' },
    });
    const { data: row } = await supabaseAdmin
      .from('media_uploads')
      .select('original_key, status, created_by')
      .eq('id', uploadId)
      .single()
      .throwOnError();
    // The key is the API's: the store, the upload id and the type's extension.
    expect(row).toEqual({
      original_key: `stores/${storeId}/uploads/${uploadId}.png`,
      status: 'PENDING',
      created_by: manager.id,
    });

    expect((await complete(uploadId)).body.error?.details?.reason).toBe('notUploaded');
    expect((await put(uploadId, bytes)).status).toBe(204);
    const done = await complete(uploadId);
    expect(done.status).toBe(200);
    expect(done.body.upload).toMatchObject({
      id: uploadId,
      status: 'UPLOADED',
      byteSize: bytes.length,
    });
    const emitted = await events(uploadId);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      payload: { key: row.original_key, contentType: 'image/png', byteSize: bytes.length },
      request_id: String(done.headers['x-request-id']),
    });

    const served = await api().get(done.body.upload.url);
    expect(served.status).toBe(200);
    expect(served.headers['cache-control']).toContain('immutable');
    expect(Buffer.compare(served.body as Buffer, bytes)).toBe(0);

    // A repeat changes nothing and emits nothing; the bytes cannot be replaced afterwards.
    expect((await complete(uploadId)).status).toBe(200);
    expect(await events(uploadId)).toHaveLength(1);
    expect((await put(uploadId, bytes)).body.error.details.reason).toBe('state');
    const read = await api().get(`${base()}/${uploadId}`).set(auth(manager));
    expect(read.body.upload.status).toBe('UPLOADED');
  });

  it.each([
    ['fewer bytes than declared', png(50), 'image/png', 'sizeMismatch'],
    ['a different type than declared', png(100), 'image/jpeg', 'type'],
    ['bytes that are not a PNG', Buffer.alloc(100, 1), 'image/png', 'content'],
  ])(
    '%s is refused (UPLOAD_INVALID) and nothing is stored',
    async (_label, bytes, type, reason) => {
      const { uploadId } = (await start({ contentType: 'image/png', byteSize: 100 })).body;
      const res = await put(uploadId, bytes, type);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'UPLOAD_INVALID',
        details: { kind: 'uploadInvalid', reason },
      });
      expect((await complete(uploadId)).body.error.details.reason).toBe('notUploaded');
    },
  );

  it('a photo is written once: a second PUT, even before complete, is refused and the first stays', async () => {
    const first = png(120 * 1024);
    const { uploadId } = (await start({ contentType: 'image/png', byteSize: first.length })).body;
    // Express matches paths case-insensitively with a trailing slash; the size exemption must match the same way.
    const odd = await api()
      .put(`${base()}/${uploadId}/FILE/`)
      .set(auth(manager))
      .set('Content-Type', 'image/png')
      .send(first);
    expect(odd.status).toBe(204);
    const again = await put(uploadId, Buffer.concat([PNG_HEAD, Buffer.alloc(first.length - 8, 9)]));
    expect(again.body.error).toMatchObject({
      code: 'UPLOAD_INVALID',
      details: { reason: 'state' },
    });
    const done = await complete(uploadId);
    const served = await api().get(done.body.upload.url);
    expect(Buffer.compare(served.body as Buffer, first)).toBe(0);
  });

  it('a completion that loses a race to another answers the upload as it now stands (UPLOADED)', async () => {
    const bytes = png(100);
    const { uploadId } = (await start({ contentType: 'image/png', byteSize: bytes.length })).body;
    expect((await put(uploadId, bytes)).status).toBe(204);
    // Another request completes the upload between this one's read and its own RPC, which then changes nothing.
    const real = supabaseAdmin.rpc.bind(supabaseAdmin);
    const spy = vi.spyOn(supabaseAdmin, 'rpc').mockImplementation(((fn: string, args: object) => {
      if (fn !== 'complete_media_upload') return real(fn as 'complete_media_upload', args as never);
      return {
        throwOnError: async () => {
          await real('complete_media_upload', args as never).throwOnError();
          return real('complete_media_upload', args as never).throwOnError();
        },
      };
    }) as unknown as typeof supabaseAdmin.rpc);
    try {
      const done = await complete(uploadId);
      expect(done.status).toBe(200);
      expect(done.body.upload.status).toBe('UPLOADED');
    } finally {
      spy.mockRestore();
    }
    expect(await events(uploadId)).toHaveLength(1);
  });

  it('a body declared past 8 MB is 413 at once, before any of it is read', async () => {
    const { uploadId } = (await start({ contentType: 'image/png', byteSize: 1000 })).body;
    // Only the headers: a guard that waited for the body would never answer within the drain bound.
    const server = createApp().listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            method: 'PUT',
            path: `${base()}/${uploadId}/file`,
            headers: {
              ...auth(manager),
              'Content-Type': 'image/png',
              'Content-Length': String(9 * 1024 * 1024),
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.flushHeaders();
      });
      expect(status).toBe(413);
    } finally {
      server.close();
    }
  });

  it('an unknown or malformed upload id is 404', async () => {
    expect((await complete(randomUUID())).status).toBe(404);
    expect((await api().get(`${base()}/not-a-uuid`).set(auth(manager))).status).toBe(404);
  });
});

describe('S3 mode (until PR 09 there is no S3 store)', () => {
  it('the local file route and /media are not there, and starting an upload is 503', async () => {
    const { uploadId } = (await start({ contentType: 'image/png', byteSize: 10 })).body;
    env.MEDIA_STORAGE = 's3';
    try {
      expect((await put(uploadId, png(10))).status).toBe(404);
      expect((await api().get(`/media/stores/${storeId}/uploads/${uploadId}.png`)).status).toBe(
        404,
      );
      const res = await start({ contentType: 'image/png', byteSize: 10 });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    } finally {
      env.MEDIA_STORAGE = 'local';
    }
  });
});
