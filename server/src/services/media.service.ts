import { randomUUID } from 'node:crypto';
import { mediaStore } from '../integrations/media';
import type { UploadTarget } from '../integrations/media/port';
import { MEDIA_UPLOAD, type MediaContentType } from '../schemas/limits';
import type { CreateUploadInput } from '../schemas/media.schema';
import type { RequestContext } from '../types/auth';
import type { Tables } from '../types/database';
import { notFound, uploadInvalid } from '../utils/errors';
import { isUuid } from '../utils/ids';
import { raisedByDatabase, supabaseAdmin } from '../utils/supabase';

export type MediaUploadRow = Tables<'media_uploads'>;

// The first bytes of each accepted format: the declared type and the file's extension prove nothing on their own.
const SIGNATURES: Record<MediaContentType, (bytes: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** Whether `bytes` start the way a file of `contentType` does. */
export const looksLike = (contentType: string, bytes: Buffer): boolean =>
  contentType in SIGNATURES && SIGNATURES[contentType as MediaContentType](bytes);

/** One of this store's uploads; another store's, an unknown or a malformed id is 404. */
async function findUpload(storeId: string, uploadId: string): Promise<MediaUploadRow> {
  if (!isUuid(uploadId)) throw notFound('Upload not found.');
  const { data } = await supabaseAdmin
    .from('media_uploads')
    .select('*')
    .eq('id', uploadId.toLowerCase())
    .eq('store_id', storeId)
    .maybeSingle()
    .throwOnError();
  if (!data) throw notFound('Upload not found.');
  return data;
}

/**
 * Starts an upload: a PENDING row whose storage key the API makes (`stores/<store>/uploads/<id>.<ext>`), and where
 * the client sends the bytes. The store is asked first, so an unreachable one leaves no row behind.
 */
export async function createUpload(
  storeId: string,
  input: CreateUploadInput,
  ctx: RequestContext,
): Promise<{ uploadId: string; upload: UploadTarget }> {
  const id = randomUUID();
  const key = `stores/${storeId}/uploads/${id}.${MEDIA_UPLOAD.types[input.contentType]}`;
  const upload = await mediaStore().createUpload(
    key,
    input.contentType,
    input.byteSize,
    id,
    storeId,
  );
  await supabaseAdmin
    .from('media_uploads')
    .insert({
      id,
      store_id: storeId,
      created_by: ctx.actor.id,
      original_key: key,
      content_type: input.contentType,
      byte_size: input.byteSize,
    })
    .throwOnError();
  return { uploadId: id, upload };
}

/**
 * Local mode's upload route (S3 takes the bytes itself): exactly the declared size, of the declared type, starting
 * the way that type does, into a PENDING upload. Anything else is refused and nothing is written.
 */
export async function putLocalFile(
  storeId: string,
  uploadId: string,
  bytes: Buffer,
  contentType: string | undefined,
): Promise<void> {
  const store = mediaStore();
  if (store.kind !== 'local') throw notFound('Not found.');
  const row = await findUpload(storeId, uploadId);
  if (row.status !== 'PENDING') throw uploadInvalid('This upload is already finished.', 'state');
  if (contentType?.split(';')[0]?.trim().toLowerCase() !== row.content_type)
    throw uploadInvalid(`Send the photo as ${row.content_type}, as declared.`, 'type');
  if (bytes.length !== row.byte_size)
    throw uploadInvalid(
      'The photo is not the size declared when the upload started.',
      'sizeMismatch',
    );
  if (!looksLike(row.content_type, bytes))
    throw uploadInvalid('That file is not a JPEG, PNG or WebP photo.', 'content');
  // Write-once: a photo already sent for this upload (or one racing this request) is never replaced.
  await store.write(row.original_key, bytes, row.content_type).catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST')
      throw uploadInvalid('The photo for this upload was already sent.', 'state');
    throw err;
  });
}

/**
 * Marks the upload UPLOADED (complete_media_upload, which emits media.uploaded) once its bytes are in storage at the
 * declared size and they start the way the declared type does. A second call changes nothing and emits nothing. Answers the upload as it now stands.
 */
export async function completeUpload(
  storeId: string,
  uploadId: string,
  ctx: RequestContext,
): Promise<MediaUploadRow> {
  const row = await findUpload(storeId, uploadId);
  if (row.status === 'PENDING') {
    const store = mediaStore();
    const size = await store.size(row.original_key);
    if (size === null)
      throw uploadInvalid(
        'The photo has not arrived yet: send it, then finish the upload.',
        'notUploaded',
      );
    if (size !== row.byte_size) {
      await store.remove(row.original_key);
      throw uploadInvalid(
        'The photo is not the size declared when the upload started.',
        'sizeMismatch',
      );
    }
    // A bucket upload never passed through the API: the presigned form pins the type header and the size, not the
    // bytes, so the photo is checked here, as the local PUT checks it before writing.
    const bytes = await store.read(row.original_key);
    if (!bytes || !looksLike(row.content_type, bytes)) {
      await store.remove(row.original_key);
      throw uploadInvalid('That file is not a JPEG, PNG or WebP photo.', 'content');
    }
  }
  try {
    await supabaseAdmin
      .rpc('complete_media_upload', {
        p_store_id: storeId,
        p_upload_id: row.id,
        p_actor: ctx.actor,
        p_request_id: ctx.requestId,
      })
      .throwOnError();
  } catch (err) {
    if (raisedByDatabase(err, 'NOT_FOUND')) throw notFound('Upload not found.');
    throw err;
  }
  // Read again either way: a request racing this one may have completed the upload after the read above.
  return findUpload(storeId, row.id);
}

export const getUpload = findUpload;

/** One variant the pipeline wrote: its key and its real size. */
export type MediaVariant = { width: number; height: number; key: string };

/** The worker's read of an upload, by id alone (the event names it); null once it is gone. */
export async function getUploadForJob(uploadId: string): Promise<MediaUploadRow | null> {
  const { data } = await supabaseAdmin
    .from('media_uploads')
    .select('*')
    .eq('id', uploadId)
    .maybeSingle()
    .throwOnError();
  return data;
}

/**
 * Ends an UPLOADED upload: PROCESSED with its variants, or FAILED with a reason (finish_media_upload, which emits
 * media.processed / media.failed). Recorded as the worker, under the request that completed the upload. A repeat
 * changes nothing; returns whether this call moved it.
 */
export async function finishUpload(
  uploadId: string,
  outcome: { variants: MediaVariant[] } | { failure: string },
  requestId: string | null,
): Promise<boolean> {
  const processed = 'variants' in outcome;
  const { data } = await supabaseAdmin
    .rpc('finish_media_upload', {
      p_upload_id: uploadId,
      p_status: processed ? 'PROCESSED' : 'FAILED',
      p_variants: processed ? outcome.variants : undefined,
      p_failure: processed ? undefined : outcome.failure,
      p_actor: { type: 'WORKER' },
      p_request_id: requestId ?? undefined,
    })
    .throwOnError();
  return data;
}

/**
 * A processed upload of this store, for an item to show: its variants, narrowest first. Anything else (another store's,
 * unknown, not processed yet, failed, or swept after 24 hours unattached) is UPLOAD_INVALID `state`: upload again.
 */
export async function processedVariants(
  storeId: string,
  uploadId: string,
): Promise<MediaVariant[]> {
  const { data } = await supabaseAdmin
    .from('media_uploads')
    .select('status, variants')
    .eq('id', uploadId)
    .eq('store_id', storeId)
    .maybeSingle()
    .throwOnError();
  if (data?.status !== 'PROCESSED' || !Array.isArray(data.variants) || data.variants.length === 0)
    throw uploadInvalid('That photo is not ready to use: upload it again.', 'state');
  return data.variants as MediaVariant[];
}

/** Uploads the sweep reads at a time. */
export const SWEEP_BATCH = 50;

/** What the nightly sweep may delete (media_sweep_candidates): uploads, oldest first, and the variant keys with each. */
export async function sweepCandidates(
  now: Date,
): Promise<{ upload_id: string; original_key: string; remove_keys: string[] }[]> {
  const { data } = await supabaseAdmin
    .rpc('media_sweep_candidates', { p_now: now.toISOString(), p_limit: SWEEP_BATCH })
    .throwOnError();
  return data;
}

/** Whether a menu item or an order line shows one of the upload's variants (media_upload_shown). */
export async function uploadShown(uploadId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .rpc('media_upload_shown', { p_upload_id: uploadId })
    .throwOnError();
  return data;
}

/** Whether an upload other than `uploadId` lists `key` among its variants (two uploads of one photo share keys). */
export async function variantHeldElsewhere(uploadId: string, key: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('media_uploads')
    .select('id')
    .neq('id', uploadId)
    .contains('variants', JSON.stringify([{ key }]))
    .limit(1)
    .throwOnError();
  return data.length > 0;
}

/** Deletes a swept upload's row, once its objects are gone. */
export async function deleteUpload(uploadId: string): Promise<void> {
  await supabaseAdmin.from('media_uploads').delete().eq('id', uploadId).throwOnError();
}
