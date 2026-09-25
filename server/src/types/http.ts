import type { RequestHandler } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';

/** Route handler whose `req.body` was produced by `validate(schema)`. */
export type BodyHandler<Body, Params = ParamsDictionary> = RequestHandler<Params, unknown, Body>;

/** Route handler whose `req.query` was produced by `validate(schema, 'query')`. */
export type QueryHandler<Query> = RequestHandler<ParamsDictionary, unknown, unknown, Query>;
