/** How the client sends an upload's bytes: straight to the bucket (S3) or to the API's own route (local). */
export interface UploadTarget {
  method: 'PUT' | 'POST';
  url: string;
  /** A POST policy's form fields, sent before the file. */
  fields?: Record<string, string>;
  /** Headers the PUT must carry. */
  headers?: Record<string, string>;
}

/**
 * Where photos live (P3.3, ADR-006). Keys are made by the API (`stores/<store>/uploads/<upload>.<ext>`), never by a
 * client. Each method fails with an IntegrationError when the store cannot be reached.
 */
export interface MediaStore {
  readonly kind: 's3' | 'local';
  /** Where and how the client sends `key`'s bytes: `maxBytes` of them (the declared size), as `contentType`. */
  createUpload(
    key: string,
    contentType: string,
    maxBytes: number,
    uploadId: string,
    storeId: string,
  ): Promise<UploadTarget>;
  read(key: string): Promise<Buffer | null>;
  /** The stored object's size, or null when nothing is there yet. */
  size(key: string): Promise<number | null>;
  /** Write-once: a key that already holds bytes is refused (an Error with code EEXIST). */
  write(key: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** The URL path a browser loads it from. */
  publicPath(key: string): string;
}

/** A storage key the API made: lower-case segments of letters, digits and dashes, one dot before the extension. */
export const MEDIA_KEY = /^stores\/[0-9a-f-]{36}\/(uploads|variants)\/[0-9a-z-]+\.(jpg|png|webp)$/;
