import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { IntegrationError } from '../../utils/errors';
import { MEDIA_KEY, type MediaStore } from './port';

export interface S3MediaConfig {
  bucket: string;
  region: string;
  /** An S3-compatible server (RustFS in compose and CI); unset on AWS. */
  endpoint?: string;
  /** The browser's view of `endpoint` when it differs from the API's (compose: localhost, not the service name). */
  uploadOrigin?: string;
}

/** How long a presigned upload form stays valid. */
const UPLOAD_EXPIRES_S = 5 * 60;

/**
 * Photos in an S3 bucket (ADR-006). The browser posts the bytes straight to the bucket with a presigned form that pins
 * the key, the type and the exact size, so the bucket itself refuses anything else. Credentials come from the SDK's
 * default chain: the instance role on AWS, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` against RustFS. The bucket is
 * private; `/media` reaches it through the CDN (or nginx in compose).
 */
const clientFor = (config: S3MediaConfig) =>
  new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  });

export function s3MediaStore(config: S3MediaConfig): MediaStore {
  const { bucket } = config;
  const client = clientFor(config);
  const checked = (key: string) => {
    if (!MEDIA_KEY.test(key)) throw new Error(`Not a media key: ${key}`);
    return key;
  };
  const status = (err: unknown) =>
    err instanceof S3ServiceException ? err.$metadata.httpStatusCode : undefined;
  // A 5xx or no answer at all may pass; a 4xx (a denied role, a missing bucket) or missing credentials will not
  // without someone fixing it.
  const failed = (operation: string) => (err: unknown) => {
    const code = status(err);
    const retryable =
      code === undefined ? (err as Error).name !== 'CredentialsProviderError' : code >= 500;
    throw new IntegrationError('s3', operation, retryable, { cause: err });
  };

  return {
    kind: 's3',
    async createUpload(key, contentType, maxBytes) {
      const post = await createPresignedPost(client, {
        Bucket: bucket,
        Key: checked(key),
        Fields: { 'Content-Type': contentType },
        // The service passes the declared size: the bucket refuses any other length, not only a larger one.
        Conditions: [
          ['content-length-range', maxBytes, maxBytes],
          ['eq', '$Content-Type', contentType],
        ],
        Expires: UPLOAD_EXPIRES_S,
      }).catch(failed('createUpload'));
      const url = config.uploadOrigin
        ? config.uploadOrigin.replace(/\/$/, '') + new URL(post.url).pathname
        : post.url;
      return { method: 'POST', url, fields: post.fields };
    },
    async read(key) {
      const Key = checked(key);
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key }));
        return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
      } catch (err) {
        if (status(err) === 404) return null;
        return failed('read')(err);
      }
    },
    async size(key) {
      const Key = checked(key);
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key }));
        return res.ContentLength ?? null;
      } catch (err) {
        if (status(err) === 404) return null;
        return failed('size')(err);
      }
    },
    // Write-once, like the local store: If-None-Match makes the bucket refuse a key that already holds bytes (412).
    async write(key, bytes, contentType) {
      const Key = checked(key);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key,
            Body: bytes,
            ContentType: contentType,
            IfNoneMatch: '*',
          }),
        );
      } catch (err) {
        if (status(err) === 412)
          throw Object.assign(new Error(`Already stored: ${key}`), { code: 'EEXIST' });
        failed('write')(err);
      }
    },
    async remove(key) {
      const Key = checked(key);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key })).catch(failed('remove'));
    },
    publicPath: (key) => `/media/${key}`,
  };
}

/**
 * Development and CI only (`pnpm run media:bucket`; on AWS the bucket is Terraform's): makes the bucket if it is
 * missing and lets `origins` post uploads to it from the browser. Safe to repeat.
 */
export async function ensureMediaBucket(config: S3MediaConfig, origins: string[]): Promise<void> {
  const client = clientFor(config);
  await client.send(new CreateBucketCommand({ Bucket: config.bucket })).catch((err: unknown) => {
    if (!(err instanceof BucketAlreadyOwnedByYou)) throw err;
  });
  await client.send(
    new PutBucketCorsCommand({
      Bucket: config.bucket,
      CORSConfiguration: {
        CORSRules: [{ AllowedOrigins: origins, AllowedMethods: ['POST'], AllowedHeaders: ['*'] }],
      },
    }),
  );
}
