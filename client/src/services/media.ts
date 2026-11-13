import type { MediaUpload, UploadTarget } from '../types/api';
import { ApiError, request } from './api';

// A photo on a slow uplink: 2 MB at 250 kbit/s is about a minute.
const UPLOAD_TIMEOUT_MS = 120_000;

const base = (storeId: string) => `/stores/${storeId}/media/uploads`;

/** Starts an upload: its id, and where and how to send the bytes. */
export const startUpload = (storeId: string, photo: Blob, signal?: AbortSignal) =>
  request<{ uploadId: string; upload: UploadTarget }>(base(storeId), {
    method: 'POST',
    body: { contentType: photo.type, byteSize: photo.size },
    signal,
  });

/**
 * Sends the bytes as the start answer says: the bucket's form (its fields, then the file; never through the API, so
 * no token goes with it) or the API's own PUT (local storage).
 */
export async function sendPhoto(target: UploadTarget, photo: Blob, signal?: AbortSignal) {
  if (target.method === 'PUT') {
    // The type the server declared for this upload (it refuses any other).
    const type = target.headers?.['Content-Type'] ?? photo.type;
    await request<void>(target.url.replace(/^\/api/, ''), {
      method: 'PUT',
      blob: type === photo.type ? photo : new Blob([photo], { type }),
      signal,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
    return;
  }
  const form = new FormData();
  for (const [name, value] of Object.entries(target.fields ?? {})) form.append(name, value);
  form.append('file', photo);
  const timeout = new AbortController();
  const stop = () => timeout.abort();
  if (signal?.aborted) stop();
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(target.url, { method: 'POST', body: form, signal: timeout.signal });
    // The bucket refuses a form that does not match its policy (size, type, key, expiry) with a 4xx.
    if (!res.ok)
      throw new ApiError(res.status, 'UPLOAD_INVALID', 'The photo was refused. Please try again.');
  } catch (err) {
    if (signal?.aborted || err instanceof ApiError) throw err;
    throw new ApiError(
      0,
      'UNREACHABLE',
      "We couldn't send the photo. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

export const completeUpload = async (storeId: string, uploadId: string, signal?: AbortSignal) =>
  (
    await request<{ upload: MediaUpload }>(`${base(storeId)}/${uploadId}/complete`, {
      method: 'POST',
      signal,
    })
  ).upload;

export const fetchUpload = async (storeId: string, uploadId: string, signal?: AbortSignal) =>
  (await request<{ upload: MediaUpload }>(`${base(storeId)}/${uploadId}`, { signal })).upload;
