import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendPhoto } from './media';

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  request: api.request,
}));

const photo = new Blob(['jpeg'], { type: 'image/jpeg' });

afterEach(() => {
  vi.unstubAllGlobals();
  api.request.mockReset();
});

describe('sendPhoto', () => {
  it('posts the bucket form straight to the bucket: its fields first, the file last, no token', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    await sendPhoto(
      {
        method: 'POST',
        url: 'https://media.example/bucket',
        fields: { key: 'stores/s/uploads/u.jpg', 'Content-Type': 'image/jpeg', Policy: 'p' },
      },
      photo,
    );
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://media.example/bucket');
    expect(init.headers).toBeUndefined();
    const form = init.body as FormData;
    expect([...form.keys()]).toEqual(['key', 'Content-Type', 'Policy', 'file']);
    expect(api.request).not.toHaveBeenCalled();
  });

  it('a form the bucket refuses is an error the editor can show', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<Error/>', { status: 403 })),
    );
    await expect(
      sendPhoto({ method: 'POST', url: 'https://media.example/bucket', fields: {} }, photo),
    ).rejects.toMatchObject({ code: 'UPLOAD_INVALID' });
  });

  it('a cancel before the send stops the bucket request at once', async () => {
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) =>
      init.signal?.aborted
        ? Promise.reject(new DOMException('aborted', 'AbortError'))
        : new Response(null, { status: 204 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      sendPhoto(
        { method: 'POST', url: 'https://media.example/b', fields: {} },
        photo,
        cancelled.signal,
      ),
    ).rejects.toBeDefined();
    expect((fetchSpy.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('the PUT carries the type the server declared', async () => {
    api.request.mockResolvedValue(undefined);
    await sendPhoto(
      {
        method: 'PUT',
        url: '/api/stores/s1/media/uploads/u1/file',
        headers: { 'Content-Type': 'image/png' },
      },
      photo,
    );
    expect((api.request.mock.calls[0]![1] as { blob: Blob }).blob.type).toBe('image/png');
  });

  it('puts the raw bytes to the API in local mode, signed in, with a long timeout', async () => {
    api.request.mockResolvedValue(undefined);
    await sendPhoto({ method: 'PUT', url: '/api/stores/s1/media/uploads/u1/file' }, photo);
    expect(api.request).toHaveBeenCalledWith('/stores/s1/media/uploads/u1/file', {
      method: 'PUT',
      blob: photo,
      signal: undefined,
      timeoutMs: 120_000,
    });
  });
});
