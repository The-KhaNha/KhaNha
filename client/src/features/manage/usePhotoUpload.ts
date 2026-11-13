import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfig } from '../config/useConfig';
import { ApiError } from '../../services/api';
import { completeUpload, fetchUpload, sendPhoto, startUpload } from '../../services/media';
import type { MediaUpload } from '../../types/api';

/** The longer side a photo is redrawn to before it is sent: plenty for the 900px variant, a fraction of a phone photo. */
export const UPLOAD_MAX_SIDE = 2000;
const JPEG_QUALITY = 0.85;
/** How long to wait for the worker before offering a retry. */
const PROCESS_WAIT_MS = 120_000;

export type PhotoUploadStatus =
  'idle' | 'preparing' | 'sending' | 'processing' | 'ready' | 'failed';

export interface PhotoUploadState {
  status: PhotoUploadStatus;
  /** A local preview of the chosen photo while it goes up; the processed variant once ready. */
  preview: string | null;
  /** Set once the upload is processed: what the item save sends as `imageUploadId`. */
  uploadId: string | null;
  error: string | null;
}

const IDLE: PhotoUploadState = { status: 'idle', preview: null, uploadId: null, error: null };

/** The size that fits `width` × `height` within `max` on its longer side, never enlarged. */
export function fitWithin(width: number, height: number, max = UPLOAD_MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** A photo's size from its header, without decoding its pixels. */
function measure(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't a photo we can read. Try a JPEG or PNG."));
    };
    img.src = url;
  });
}

/**
 * Redraws any photo the browser can show as a JPEG at most UPLOAD_MAX_SIDE on its longer side: less data on a metered
 * connection, and one of the types the server takes whatever the camera wrote. It is decoded straight at that size
 * (a 50 MP photo never sits in a low-end phone's memory at full size), the browser applies the EXIF orientation, and
 * transparency becomes white rather than JPEG's black.
 */
async function asJpeg(file: File): Promise<Blob> {
  const { width, height } = await measure(file);
  const size = fitWithin(width, height);
  const bitmap = await createImageBitmap(file, {
    resizeWidth: size.width,
    resizeHeight: size.height,
    resizeQuality: 'high',
  }).catch(() => {
    throw new Error("That file isn't a photo we can read. Try a JPEG or PNG.");
  });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error("We couldn't prepare that photo. Please try again.");
  }
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("We couldn't prepare that photo."))),
      'image/jpeg',
      JPEG_QUALITY,
    ),
  );
}

/** Resolves after `ms` of the tab being visible: a hidden tab does not poll (people pay for data). */
function visibleDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      document.removeEventListener('visibilitychange', arm);
      signal.removeEventListener('abort', stop);
    };
    const arm = () => {
      clearTimeout(timer);
      if (!document.hidden)
        timer = setTimeout(() => {
          done();
          resolve();
        }, ms);
    };
    const stop = () => {
      clearTimeout(timer);
      done();
      reject(signal.reason);
    };
    document.addEventListener('visibilitychange', arm);
    signal.addEventListener('abort', stop, { once: true });
    arm();
  });
}

const message = (err: unknown) =>
  err instanceof ApiError || err instanceof Error
    ? err.message
    : 'Something went wrong. Please try again.';

/**
 * A photo for one of the store's items (P3.3): prepare, start the upload, send it as the server says, complete it, then
 * wait for the worker to process it. Every step shows; a failure keeps the chosen file for `retry`; `cancel` stops
 * whatever is running, including the wait.
 */
export function usePhotoUpload(storeId: string) {
  const { polling } = useConfig();
  const [state, setState] = useState<PhotoUploadState>(IDLE);
  const file = useRef<File | null>(null);
  const run = useRef<AbortController | null>(null);
  const localPreview = useRef<string | null>(null);

  const dropPreview = () => {
    if (localPreview.current) URL.revokeObjectURL(localPreview.current);
    localPreview.current = null;
  };
  useEffect(
    () => () => {
      run.current?.abort();
      dropPreview();
    },
    [],
  );

  const upload = useCallback(
    async (chosen: File) => {
      run.current?.abort();
      const controller = new AbortController();
      run.current = controller;
      const { signal } = controller;
      file.current = chosen;
      dropPreview();
      localPreview.current = URL.createObjectURL(chosen);
      const preview = localPreview.current;
      const step = (status: PhotoUploadStatus) =>
        !signal.aborted && setState({ status, preview, uploadId: null, error: null });
      try {
        step('preparing');
        const photo = await asJpeg(chosen);
        step('sending');
        const { uploadId, upload: target } = await startUpload(storeId, photo, signal);
        await sendPhoto(target, photo, signal);
        let current: MediaUpload = await completeUpload(storeId, uploadId, signal);
        step('processing');
        const deadline = Date.now() + PROCESS_WAIT_MS;
        while (current.status === 'UPLOADED') {
          if (Date.now() > deadline)
            throw new Error('The photo is taking a while to process. Try again in a moment.');
          await visibleDelay(polling.orderMs, signal);
          current = await fetchUpload(storeId, uploadId, signal);
        }
        if (current.status !== 'PROCESSED')
          throw new Error(
            current.failure
              ? `That photo can't be used: ${current.failure}.`
              : 'That photo could not be processed.',
          );
        if (signal.aborted) return;
        setState({ status: 'ready', preview: current.url, uploadId, error: null });
      } catch (err) {
        if (signal.aborted) return;
        setState({ status: 'failed', preview, uploadId: null, error: message(err) });
      }
    },
    [storeId, polling.orderMs],
  );

  const cancel = useCallback(() => {
    run.current?.abort();
    dropPreview();
    file.current = null;
    setState(IDLE);
  }, []);

  const retry = useCallback(() => {
    if (file.current) void upload(file.current);
  }, [upload]);

  return { ...state, upload, cancel, retry };
}
