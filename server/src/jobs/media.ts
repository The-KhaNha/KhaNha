import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { mediaStore } from '../integrations/media';
import { MEDIA_UPLOAD, MEDIA_VARIANTS } from '../schemas/limits';
import { finishUpload, getUploadForJob, type MediaVariant } from '../services/media.service';
import type { JobHandler } from './runner';

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

/**
 * media.uploaded → the upload's variants (docs/JOBS.md "Media events"). A finished upload (PROCESSED or FAILED) is
 * acknowledged without reading the store: a redelivery after a completed run costs one row read and an idempotent
 * removal of the original. A crash before
 * the mark reruns the whole handler, which writes the same content-addressed keys. The original is deleted last.
 */
export const mediaHandler: JobHandler<{ key: string }> = {
  queue: 'q_media',
  concurrency: 1,
  // An 8 MB, 6000×6000 photo takes a few seconds on one thread; the margin covers a slow store.
  visibilityTimeoutSec: 120,
  maxAttempts: 5,
  backoff: { baseSec: 10, maxSec: 900 },
  async handle({ event }, { log }) {
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
