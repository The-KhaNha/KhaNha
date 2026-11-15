import { z } from 'zod';
import { MEDIA_UPLOAD, type MediaContentType } from './limits';

const TYPES = Object.keys(MEDIA_UPLOAD.types) as [MediaContentType, ...MediaContentType[]];
const maxMb = MEDIA_UPLOAD.maxBytes / (1024 * 1024);

/** POST /stores/:storeId/media/uploads: the photo the client is about to send, as it declares it. */
export const createUploadSchema = z.strictObject({
  contentType: z.enum(TYPES, 'Upload a JPEG, PNG or WebP photo.'),
  byteSize: z
    .number('byteSize must be a number.')
    .int('byteSize must be a whole number of bytes.')
    .min(1, 'The photo is empty.')
    .max(MEDIA_UPLOAD.maxBytes, `A photo can be at most ${maxMb} MB.`),
});

export type CreateUploadInput = z.infer<typeof createUploadSchema>;
