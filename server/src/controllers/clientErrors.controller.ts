import type { RequestHandler } from 'express';
import type { ClientErrorsInput } from '../schemas/clientErrors.schema';

/**
 * One `warn` per report, never `error`: a browser cannot be allowed to page anyone. `clientVersion` is already on
 * `req.log` (app.ts customProps), so it is not repeated here.
 */
export const reportClientErrors: RequestHandler = (req, res) => {
  const { reports } = req.body as ClientErrorsInput;
  for (const { kind, message, stack, route, at } of reports) {
    req.log.warn({ kind, message, stack, route, at }, 'Client error');
  }
  res.status(204).end();
};
