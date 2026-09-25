import type { RequestHandler } from 'express';
import type { ZodIssue, ZodTypeAny } from 'zod';
import { validationError } from '../utils/errors';

type Source = 'body' | 'query';

/**
 * Parses `req[source]` with the schema and replaces it with the parsed value,
 * so downstream handlers only ever see validated, stripped data.
 */
export function validate(schema: ZodTypeAny, source: Source = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(stripNullBytes(req[source]));
    if (!result.success) throw validationError(describeIssue(result.error.issues[0], source));

    if (source === 'body') {
      req.body = result.data;
    } else {
      // Express 5 defines req.query as a prototype getter, so shadow it with an own property.
      Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true, enumerable: true });
    }
    next();
  };
}

/** Postgres text columns reject the NUL character, so it is dropped from every string before validation. */
function stripNullBytes(value: unknown): unknown {
  if (typeof value === 'string') return value.replaceAll('\0', '');
  if (Array.isArray(value)) return value.map(stripNullBytes);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, stripNullBytes(entry)]));
  }
  return value;
}

/** Turns a zod issue into a sentence a customer can read, e.g. "Customer name is required." */
export function describeIssue(issue: ZodIssue | undefined, source: Source = 'body'): string {
  if (!issue) return 'The request is invalid.';
  const label = fieldLabel(issue.path, source);
  if (issue.code === 'invalid_type') {
    if (issue.received === 'undefined') return `${label} is required.`;
    if (issue.message.startsWith('Expected ')) return `${label} is invalid.`;
  }
  return issue.message;
}

function fieldLabel(path: (string | number)[], source: Source): string {
  const name = [...path].reverse().find((segment): segment is string => typeof segment === 'string');
  if (!name) return source === 'body' ? 'Request body' : 'Query';
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
