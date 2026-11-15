import { env } from '../../utils/env';
import { IntegrationError } from '../../utils/errors';
import { localMediaStore } from './local';
import type { MediaStore } from './port';
import { s3MediaStore } from './s3';

// No bucket configured (staging until P8 gives it one): the API still starts, and every media call is a 503
// UPSTREAM_UNAVAILABLE instead of a crash.
const notConfigured = (operation: string) =>
  Promise.reject(
    new IntegrationError('s3', operation, false, {
      cause: new Error('MEDIA_BUCKET is not set; set it, or MEDIA_STORAGE=local to develop.'),
    }),
  );

const unconfigured: MediaStore = {
  kind: 's3',
  createUpload: () => notConfigured('createUpload'),
  read: () => notConfigured('read'),
  size: () => notConfigured('size'),
  write: () => notConfigured('write'),
  remove: () => notConfigured('remove'),
  publicPath: (key) => `/media/${key}`,
};

let s3: MediaStore | null = null;
let local: MediaStore | null = null;

/**
 * The store MEDIA_STORAGE names, read on every call (a test switches it). Each store is built once, so the bucket
 * settings are read on first use only.
 */
export function mediaStore(): MediaStore {
  if (env.MEDIA_STORAGE === 's3') {
    if (!env.MEDIA_BUCKET) return unconfigured;
    s3 ??= s3MediaStore({
      bucket: env.MEDIA_BUCKET,
      region: env.AWS_REGION,
      endpoint: env.MEDIA_S3_ENDPOINT,
      uploadOrigin: env.MEDIA_UPLOAD_ORIGIN,
    });
    return s3;
  }
  local ??= localMediaStore();
  return local;
}
