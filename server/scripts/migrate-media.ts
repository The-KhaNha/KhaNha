// `pnpm run migrate:media [--check] [--production]`: moves the photos bundled in client/public/images to the media
// store for the environment server/.env names (scripts/media-migration.ts). `--check` changes nothing: it prints how
// many menu items and order lines still point at /images/ and exits non-zero unless none do. Production only with
// --production, which the user runs.
import { env } from '../src/utils/env';
import { logger } from '../src/utils/logger';
import { bundledPhotoRows, migrateBundledPhotos } from './media-migration';

async function main(): Promise<void> {
  const production = process.argv.includes('--production');
  if (env.APP_ENV === 'production' && !production)
    throw new Error('APP_ENV is production: pass --production to move its photos.');
  if (env.APP_ENV !== 'production' && production)
    throw new Error(`--production was passed but APP_ENV is ${env.APP_ENV}.`);

  if (process.argv.includes('--check')) {
    const left = await bundledPhotoRows();
    logger.info({ appEnv: env.APP_ENV, rows: left }, 'Rows still on bundled photos');
    if (left > 0) process.exitCode = 1;
    return;
  }
  const { photos, rows } = await migrateBundledPhotos(logger);
  logger.info({ appEnv: env.APP_ENV, photos, rows }, 'Bundled photos moved to media');
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Photo migration failed');
  process.exitCode = 1;
});
