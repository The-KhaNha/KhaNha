// `pnpm run media:bucket [origin…]`: the local S3 bucket (RustFS in compose and CI) and its CORS rule for CLIENT_ORIGIN
// plus any origins given (compose's web app: http://localhost:8080). On AWS
// the bucket is Terraform's, so this refuses production.
import { ensureMediaBucket } from '../src/integrations/media/s3';
import { env } from '../src/utils/env';
import { logger } from '../src/utils/logger';

if (env.APP_ENV === 'production' || !env.MEDIA_BUCKET || !env.MEDIA_S3_ENDPOINT) {
  logger.error(
    'media:bucket needs MEDIA_BUCKET and MEDIA_S3_ENDPOINT, and never runs on production',
  );
  process.exit(1);
}
const bucket = env.MEDIA_BUCKET;
ensureMediaBucket({ bucket, region: env.AWS_REGION, endpoint: env.MEDIA_S3_ENDPOINT }, [
  env.CLIENT_ORIGIN,
  ...process.argv.slice(2),
]).then(
  () => logger.info({ bucket }, 'Media bucket ready'),
  (err: unknown) => {
    logger.error({ err }, 'Media bucket setup failed');
    process.exit(1);
  },
);
