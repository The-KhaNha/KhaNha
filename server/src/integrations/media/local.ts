import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { env } from '../../utils/env';
import { MEDIA_KEY, type MediaStore } from './port';

/**
 * Development only (refused in production by utils/env): photos in a folder, uploaded through the API's own PUT route
 * and served from `/media/*`. Every key is checked against MEDIA_KEY and resolved under the folder, so no value can name
 * a path outside it.
 */
export function localMediaStore(root = env.MEDIA_LOCAL_DIR): MediaStore {
  const base = resolve(root);
  const pathOf = (key: string) => {
    const full = resolve(base, key);
    if (!MEDIA_KEY.test(key) || !full.startsWith(base + sep)) throw new Error(`Not a media key: ${key}`);
    return full;
  };
  const missing = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT';

  return {
    kind: 'local',
    async createUpload(key, contentType, _maxBytes, uploadId, storeId) {
      pathOf(key);
      return {
        method: 'PUT',
        url: `/api/stores/${storeId}/media/uploads/${uploadId}/file`,
        headers: { 'Content-Type': contentType },
      };
    },
    async read(key) {
      return readFile(pathOf(key)).catch((err) => (missing(err) ? null : Promise.reject(err)));
    },
    async size(key) {
      return stat(pathOf(key)).then(
        (s) => s.size,
        (err) => (missing(err) ? null : Promise.reject(err)),
      );
    },
    async write(key, bytes) {
      const full = pathOf(key);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, bytes);
    },
    async remove(key) {
      await rm(pathOf(key), { force: true });
    },
    publicPath: (key) => `/media/${key}`,
  };
}
