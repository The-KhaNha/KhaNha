import type { RequestHandler } from 'express';
import { mediaStore } from '../integrations/media';
import { currentStore, requestContext } from '../middleware/auth';
import type { CreateUploadInput } from '../schemas/media.schema';
import * as mediaService from '../services/media.service';
import type { BodyHandler } from '../types/http';
import { toMediaUploadDto } from '../utils/serializers';

// Photo uploads (P3.3), every route after requireStore('menu.edit').

const dto = (row: mediaService.MediaUploadRow) =>
  toMediaUploadDto(row, mediaStore().publicPath(row.original_key));

/** POST /api/stores/:storeId/media/uploads: an upload id and where to send the bytes. */
export const createUpload: BodyHandler<CreateUploadInput> = async (req, res) => {
  res
    .status(201)
    .json(await mediaService.createUpload(currentStore(req).id, req.body, requestContext(req)));
};

/** PUT /api/stores/:storeId/media/uploads/:uploadId/file (local mode): the raw bytes. */
export const putFile: RequestHandler = async (req, res) => {
  const body: unknown = req.body;
  await mediaService.putLocalFile(
    currentStore(req).id,
    String(req.params.uploadId),
    Buffer.isBuffer(body) ? body : Buffer.alloc(0),
    req.headers['content-type'],
  );
  res.status(204).end();
};

/** POST /api/stores/:storeId/media/uploads/:uploadId/complete. */
export const completeUpload: RequestHandler = async (req, res) => {
  const row = await mediaService.completeUpload(
    currentStore(req).id,
    String(req.params.uploadId),
    requestContext(req),
  );
  res.json({ upload: dto(row) });
};

/** GET /api/stores/:storeId/media/uploads/:uploadId. */
export const getUpload: RequestHandler = async (req, res) => {
  res.json({
    upload: dto(await mediaService.getUpload(currentStore(req).id, String(req.params.uploadId))),
  });
};
