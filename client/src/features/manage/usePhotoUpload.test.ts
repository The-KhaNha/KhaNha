import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/api';
import type { MediaUpload } from '../../types/api';
import { CONFIG_FALLBACK } from '../config/fallbacks';
import { fitWithin, usePhotoUpload } from './usePhotoUpload';

const media = vi.hoisted(() => ({
  startUpload: vi.fn(),
  sendPhoto: vi.fn(),
  completeUpload: vi.fn(),
  fetchUpload: vi.fn(),
}));
vi.mock('../../services/media', () => media);
vi.mock('../config/useConfig', () => ({
  useConfig: () => ({ ...CONFIG_FALLBACK, polling: { ...CONFIG_FALLBACK.polling, orderMs: 10 } }),
}));

const upload = (status: MediaUpload['status'], extra: Partial<MediaUpload> = {}): MediaUpload => ({
  id: 'u1',
  status,
  contentType: 'image/jpeg',
  byteSize: 1,
  url: '/media/stores/s1/uploads/u1.jpg',
  variants: null,
  failure: null,
  createdAt: '2026-11-14T00:00:00Z',
  ...extra,
});
const processed = upload('PROCESSED', { url: '/media/stores/s1/variants/abc-900.webp' });
const file = () => new File(['photo'], 'dosa.heic', { type: 'image/heic' });
let context: {
  drawImage: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  fillStyle: string;
};

beforeEach(() => {
  // jsdom has no image decoding or canvas encoding: a 4000×3000 photo decodes, and the canvas encodes a JPEG.
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })),
  );
  context = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  // The header read: jsdom loads no images, so a 4000×3000 photo "loads" at once.
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 4000;
      naturalHeight = 3000;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_url: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
    cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
  });
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: vi.fn() }),
  );
  media.startUpload.mockResolvedValue({
    uploadId: 'u1',
    upload: { method: 'PUT', url: '/api/stores/s1/media/uploads/u1/file' },
  });
  media.sendPhoto.mockResolvedValue(undefined);
  media.completeUpload.mockResolvedValue(upload('UPLOADED'));
  media.fetchUpload.mockResolvedValue(processed);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.values(media).forEach((fn) => fn.mockReset());
});

describe('fitWithin', () => {
  it('scales the longer side down to the limit and never enlarges', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 6000)).toEqual({ width: 1000, height: 2000 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('usePhotoUpload', () => {
  it('sends a JPEG of the photo, completes it, and waits until it is processed', async () => {
    const { result } = renderHook(() => usePhotoUpload('s1'));
    await act(() => result.current.upload(file()));
    expect(result.current).toMatchObject({
      status: 'ready',
      uploadId: 'u1',
      preview: processed.url,
      error: null,
    });
    const sent = media.sendPhoto.mock.calls[0]![1] as Blob;
    // Whatever the camera wrote (here HEIC), the server gets a JPEG, declared as such.
    expect(sent.type).toBe('image/jpeg');
    expect(media.startUpload).toHaveBeenCalledWith('s1', sent, expect.any(AbortSignal));
    expect(media.sendPhoto.mock.calls[0]![0]).toEqual({
      method: 'PUT',
      url: '/api/stores/s1/media/uploads/u1/file',
    });
    expect(media.fetchUpload).toHaveBeenCalledTimes(1);
    // Decoded straight at the size it is sent at, on white (a transparent PNG must not turn black).
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(File), {
      resizeWidth: 2000,
      resizeHeight: 1500,
      resizeQuality: 'high',
    });
    expect(context.fillStyle).toBe('white');
    expect(context.fillRect).toHaveBeenCalled();
  });

  it('a browser that gives no canvas fails the upload instead of sending a blank photo', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { result } = renderHook(() => usePhotoUpload('s1'));
    await act(() => result.current.upload(file()));
    expect(result.current.status).toBe('failed');
    expect(media.startUpload).not.toHaveBeenCalled();
  });

  it.each([
    [
      'starting',
      () => media.startUpload.mockRejectedValueOnce(new ApiError(0, 'UNREACHABLE', 'Offline')),
    ],
    [
      'sending',
      () => media.sendPhoto.mockRejectedValueOnce(new ApiError(0, 'UNREACHABLE', 'Offline')),
    ],
    [
      'completing',
      () =>
        media.completeUpload.mockRejectedValueOnce(new ApiError(400, 'UPLOAD_INVALID', 'Offline')),
    ],
  ])('a failure while %s shows its message, and retry starts again', async (_step, fail) => {
    fail();
    const { result } = renderHook(() => usePhotoUpload('s1'));
    await act(() => result.current.upload(file()));
    expect(result.current).toMatchObject({ status: 'failed', error: 'Offline', uploadId: null });
    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('a photo the worker refuses fails with its reason', async () => {
    media.fetchUpload.mockResolvedValue(upload('FAILED', { failure: 'not a photo' }));
    const { result } = renderHook(() => usePhotoUpload('s1'));
    await act(() => result.current.upload(file()));
    expect(result.current).toMatchObject({
      status: 'failed',
      error: "That photo can't be used: not a photo.",
    });
  });

  it('a file the browser cannot read fails before anything is sent', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => Promise.reject(new Error('decode'))),
    );
    const { result } = renderHook(() => usePhotoUpload('s1'));
    await act(() => result.current.upload(file()));
    expect(result.current.error).toMatch(/isn't a photo we can read/);
    expect(media.startUpload).not.toHaveBeenCalled();
  });

  it('cancel stops the wait: no more polls, and the field is empty again', async () => {
    media.fetchUpload.mockResolvedValue(upload('UPLOADED'));
    const { result } = renderHook(() => usePhotoUpload('s1'));
    act(() => void result.current.upload(file()));
    await waitFor(() => expect(media.fetchUpload).toHaveBeenCalled());
    act(() => result.current.cancel());
    const polls = media.fetchUpload.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(media.fetchUpload.mock.calls.length).toBe(polls);
    expect(result.current).toMatchObject({ status: 'idle', preview: null, uploadId: null });
  });

  it('a hidden tab does not poll until it is visible again', async () => {
    media.fetchUpload.mockResolvedValueOnce(upload('UPLOADED')).mockResolvedValue(processed);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const { result } = renderHook(() => usePhotoUpload('s1'));
    act(() => void result.current.upload(file()));
    await waitFor(() => expect(result.current.status).toBe('processing'));
    await new Promise((r) => setTimeout(r, 60));
    expect(media.fetchUpload).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
