// The local media store: a photo appears at its key only once all its bytes are written, a key is never rewritten,
// and a folder that cannot be used fails as an IntegrationError (503), not a raw filesystem error.
import { mkdtemp, readdir, readFile, writeFile as realWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({ failNextWrite: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    // Writes half the bytes and then fails, like a full disk mid-write.
    writeFile: (async (path, data, options) => {
      if (!fs.failNextWrite) return real.writeFile(path, data, options);
      fs.failNextWrite = false;
      await real.writeFile(path, (data as Buffer).subarray(0, 4), options);
      throw Object.assign(new Error('no space left'), { code: 'ENOSPC' });
    }) as typeof real.writeFile,
  };
});

const dir = 'stores/00000000-0000-4000-8000-000000000001/uploads';
// The setup files load the store before this file's mock applies: load it (and its error class) afresh.
let localMediaStore: typeof import('../../src/integrations/media/local.js').localMediaStore;
let IntegrationError: typeof import('../../src/utils/errors.js').IntegrationError;
beforeAll(async () => {
  vi.resetModules();
  ({ localMediaStore } = await import('../../src/integrations/media/local.js'));
  ({ IntegrationError } = await import('../../src/utils/errors.js'));
});

const key = `${dir}/a.png`;
let root = '';
beforeEach(async () => {
  fs.failNextWrite = false;
  root = await mkdtemp(join(tmpdir(), 'media-local-'));
});

describe('localMediaStore', () => {
  it('writes once: the bytes land whole, a second write is EEXIST and keeps them, no temp file is left', async () => {
    const store = localMediaStore(root);
    await store.write(key, Buffer.from('first'), 'image/png');
    await expect(store.write(key, Buffer.from('second'), 'image/png')).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect((await store.read(key))?.toString()).toBe('first');
    expect(await readdir(join(root, dir))).toEqual(['a.png']);
  });

  it('a write that fails partway leaves nothing at the key', async () => {
    const store = localMediaStore(root);
    fs.failNextWrite = true;
    await expect(store.write(key, Buffer.from('0123456789'), 'image/png')).rejects.toBeInstanceOf(
      IntegrationError,
    );
    expect(await store.size(key)).toBeNull();
    expect(await readdir(join(root, dir))).toEqual([]);
  });

  it('a folder that cannot be used is an IntegrationError for every operation', async () => {
    const file = join(root, 'not-a-folder');
    await realWriteFile(file, 'x');
    const store = localMediaStore(file);
    for (const call of [
      () => store.size(key),
      () => store.read(key),
      () => store.write(key, Buffer.from('x'), 'image/png'),
    ])
      await expect(call()).rejects.toBeInstanceOf(IntegrationError);
    expect(await readFile(file, 'utf8')).toBe('x');
  });
});
