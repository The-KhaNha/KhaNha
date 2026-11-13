import { env } from '../../utils/env';
import { IntegrationError } from '../../utils/errors';
import { localMediaStore } from './local';
import type { MediaStore } from './port';

const notYet = (operation: string) =>
  Promise.reject(
    new IntegrationError('s3', operation, false, {
      cause: new Error('The S3 media store arrives in P3 PR 09; set MEDIA_STORAGE=local to develop.'),
    }),
  );

// ponytail: placeholder until PR 09 adds the S3 store; every call is a 503 UPSTREAM_UNAVAILABLE.
const s3Placeholder: MediaStore = {
  kind: 's3',
  createUpload: () => notYet('createUpload'),
  read: () => notYet('read'),
  size: () => notYet('size'),
  write: () => notYet('write'),
  remove: () => notYet('remove'),
  publicPath: (key) => `/media/${key}`,
};

let local: MediaStore | null = null;

/** The store MEDIA_STORAGE names, read on every call (a test switches it). */
export function mediaStore(): MediaStore {
  if (env.MEDIA_STORAGE === 's3') return s3Placeholder;
  local ??= localMediaStore();
  return local;
}
