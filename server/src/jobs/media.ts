import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { mediaStore } from '../integrations/media';
import { MEDIA_UPLOAD, MEDIA_VARIANTS } from '../schemas/limits';
import {
  deleteUpload,
  finishUpload,
  getUploadForJob,
  SWEEP_BATCH,
  sweepCandidates,
  uploadShown,
  variantHeldElsewhere,
  type MediaVariant,
} from '../services/media.service';
import type { JobContext, JobHandler } from './runner';

// The production host has 1 GB (P8): one image at a time, no libvips cache, one thread.
sharp.cache(false);
sharp.concurrency(1);

// sharp's names for the accepted types: image/jpeg → jpeg.
const FORMATS = new Set(Object.keys(MEDIA_UPLOAD.types).map((type) => type.split('/')[1]));

/**
 * Why a photo can never be processed: the upload is marked FAILED with `message`, which the manager sees, and the job
 * ends (nothing is dead-lettered). `detail` (a decoder's own words) is logged only.
 */
class Refused extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

/**
 * The WebP variants of an original, keyed by its content (`stores/<store>/variants/<sha256 prefix>-<width>.webp`), so
 * a rerun writes the same keys. The bytes are untrusted even after `complete` (a presigned form can replace them at
 * the same size): sharp decides the real format and size here. Rotation follows the EXIF orientation; the output
 * carries no metadata.
 */
export async function makeVariants(
  storeId: string,
  original: Buffer,
): Promise<{ variant: MediaVariant; bytes: Buffer }[]> {
  const input = () =>
    sharp(original, { limitInputPixels: MEDIA_VARIANTS.maxSide * MEDIA_VARIANTS.maxSide });
  const meta = await input()
    .metadata()
    .catch((err: unknown) => {
      throw new Refused('not a photo', (err as Error).message);
    });
  if (!meta.format || !FORMATS.has(meta.format))
    throw new Refused('not a JPEG, PNG or WebP', meta.format);
  if ((meta.width ?? 0) > MEDIA_VARIANTS.maxSide || (meta.height ?? 0) > MEDIA_VARIANTS.maxSide)
    throw new Refused(`larger than ${MEDIA_VARIANTS.maxSide} pixels on a side`);

  // One decode: rotated by the EXIF orientation and cut to the widest variant, kept raw; every width comes from it.
  const widest = Math.max(...MEDIA_VARIANTS.widths);
  const { data: pixels, info: raw } = await input()
    .rotate()
    .resize({ width: widest, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true })
    .catch((err: unknown) => {
      throw new Refused('could not be decoded', (err as Error).message);
    });
  const hash = createHash('sha256').update(original).digest('hex').slice(0, 16);
  const variants = [];
  for (const width of MEDIA_VARIANTS.widths) {
    const { data, info } = await sharp(pixels, {
      raw: { width: raw.width, height: raw.height, channels: raw.channels },
    })
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: MEDIA_VARIANTS.webpQuality })
      .toBuffer({ resolveWithObject: true });
    variants.push({
      variant: {
        width: info.width,
        height: info.height,
        key: `stores/${storeId}/variants/${hash}-${width}.webp`,
      },
      bytes: data,
    });
  }
  return variants;
}

/** How long one sweep may run: well inside the handler's visibility timeout, so no second reader takes the message. */
const SWEEP_BUDGET_MS = 60_000;

/**
 * media.sweep (nightly): for each upload media_sweep_candidates names, removes the variant keys nothing else shows and
 * the original, then deletes the row. Batches of SWEEP_BATCH while full ones come back, within SWEEP_BUDGET_MS and
 * until shutdown; what is left waits for the next night. A failure on one upload is logged and leaves its row for the
 * next night; the rest go on. On S3 the bucket's lifecycle rule (originals expire after a day, P8) is the backstop.
 * `now` is when the sweep was asked for.
 */
export async function sweepMedia(
  now: Date,
  { log, signal }: Pick<JobContext, 'log'> & { signal?: AbortSignal },
): Promise<number> {
  const store = mediaStore();
  const deadline = Date.now() + SWEEP_BUDGET_MS;
  let swept = 0;
  let failed = 0;
  for (;;) {
    const batch = await sweepCandidates(now);
    let batchFailed = false;
    for (const { upload_id, original_key, remove_keys } of batch) {
      if (signal?.aborted || Date.now() > deadline) break;
      try {
        // An item may have taken the photo since the batch was read: look again just before anything goes.
        // ponytail: a check, not a lock; an attach landing between this read and the removal still loses its photo.
        // The window is milliseconds, once a night, for an upload left unattached over 24 hours.
        if (await uploadShown(upload_id)) continue;
        // The batch was chosen together; an upload sharing a key may have been kept since (shown, or skipped on a
        // failure), so a key goes only while no other upload still lists it.
        for (const key of remove_keys)
          if (!(await variantHeldElsewhere(upload_id, key))) await store.remove(key);
        await store.remove(original_key);
        await deleteUpload(upload_id);
        swept += 1;
      } catch (err) {
        failed += 1;
        batchFailed = true;
        log.warn({ err, uploadId: upload_id }, 'Media sweep skipped an upload');
      }
    }
    // A failed or shown upload comes back in the next batch: stop rather than read it again tonight.
    if (batchFailed || batch.length < SWEEP_BATCH || signal?.aborted || Date.now() > deadline)
      break;
  }
  log.info({ uploads: swept, failed }, 'Media swept');
  return swept;
}

/**
 * media.uploaded → the upload's variants; media.sweep → sweepMedia (docs/JOBS.md "Media events"). A finished upload (PROCESSED or FAILED) is
 * acknowledged without reading the store: a redelivery after a completed run costs one row read and an idempotent
 * removal of the original. A crash before
 * the mark reruns the whole handler, which writes the same content-addressed keys. The original is deleted last.
 */
export const mediaHandler: JobHandler<{ key?: string }> = {
  queue: 'q_media',
  concurrency: 1,
  // An 8 MB, 6000×6000 photo takes a few seconds on one thread; the margin covers a slow store.
  visibilityTimeoutSec: 120,
  maxAttempts: 5,
  backoff: { baseSec: 10, maxSec: 900 },
  async handle({ event }, { log, signal }) {
    if (event.type === 'media.sweep') {
      await sweepMedia(new Date(event.occurredAt), { log, signal });
      return;
    }
    const upload = await getUploadForJob(event.aggregateId);
    if (!upload || upload.status === 'PENDING') return;
    const store = mediaStore();
    // Finished: only the original's removal may be left over (a crash or a store failure after the mark). Removing
    // is idempotent and reads nothing.
    if (upload.status !== 'UPLOADED') return store.remove(upload.original_key);
    const refuse = async (failure: string, detail?: string) => {
      await finishUpload(upload.id, { failure }, event.requestId);
      await store.remove(upload.original_key);
      log.warn({ uploadId: upload.id, failure, detail }, 'Photo refused');
    };

    const original = await store.read(upload.original_key);
    if (!original) return refuse('the original is missing');
    let made;
    try {
      made = await makeVariants(upload.store_id, original);
    } catch (err) {
      if (err instanceof Refused) return refuse(err.message, err.detail);
      throw err;
    }
    for (const { variant, bytes } of made)
      await store.write(variant.key, bytes, 'image/webp').catch((err: unknown) => {
        // Content-addressed: the same key already holds these bytes (a rerun, or the same photo again).
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      });
    await finishUpload(upload.id, { variants: made.map((m) => m.variant) }, event.requestId);
    await store.remove(upload.original_key);
    log.info({ uploadId: upload.id, variants: made.length }, 'Photo processed');
  },
};
