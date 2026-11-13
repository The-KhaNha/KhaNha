import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { env } from '../../utils/env';
import { IntegrationError } from '../../utils/errors';
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
    if (!MEDIA_KEY.test(key) || !full.startsWith(base + sep))
      throw new Error(`Not a media key: ${key}`);
    return full;
  };
  const code = (err: unknown) => (err as NodeJS.ErrnoException).code;
  // A folder that cannot be read or written is the store being down, reported like any other provider's failure.
  const failed = (operation: string) => (err: unknown) =>
    Promise.reject(new IntegrationError('local-media', operation, false, { cause: err }));

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
      return readFile(pathOf(key)).catch((err) =>
        code(err) === 'ENOENT' ? null : failed('read')(err),
      );
    },
    async size(key) {
      return stat(pathOf(key)).then(
        (s) => s.size,
        (err) => (code(err) === 'ENOENT' ? null : failed('size')(err)),
      );
    },
    // The bytes go to a hidden sibling first and are linked to the key only once complete, so neither /media nor a
    // completing upload ever sees a half-written photo. link() never replaces: a key's bytes never change after they
    // land (which is what lets /media cache them as immutable), and a second write of a key is EEXIST, passed on as is.
    async write(key, bytes) {
      const full = pathOf(key);
      const temp = join(dirname(full), `.${basename(full)}.${randomUUID()}.part`);
      try {
        await mkdir(dirname(full), { recursive: true });
        await writeFile(temp, bytes, { flag: 'wx' });
        await link(temp, full);
      } catch (err) {
        if (code(err) === 'EEXIST') throw err;
        await failed('write')(err);
      } finally {
        // Best effort: a leftover hidden part file is never served and never read as a photo.
        await rm(temp, { force: true }).catch(() => undefined);
      }
    },
    async remove(key) {
      await rm(pathOf(key), { force: true }).catch(failed('remove'));
    },
    publicPath: (key) => `/media/${key}`,
  };
}
