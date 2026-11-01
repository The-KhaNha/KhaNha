import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { validationError } from '../utils/errors';

type Source = 'body' | 'query';

/**
 * Parses `req[source]` with the schema and replaces it with the parsed value,
 * so downstream handlers only ever see validated, stripped data.
 */
export function validate(schema: z.ZodType, source: Source = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(stripNullBytes(req[source]));
    if (!result.success) {
      const issue = result.error.issues[0];
      throw validationError(describeIssue(issue, source), topLevelField(issue));
    }

    if (source === 'body') {
      req.body = result.data;
    } else {
      // Express 5 defines req.query as a prototype getter, so shadow it with an own property.
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    next();
  };
}

/** The request field an issue is about (`items` for `items[2].quantity`), for a form to show it in place. */
function topLevelField(issue: z.core.$ZodIssue | undefined): string | undefined {
  const first = issue?.path[0];
  return typeof first === 'string' ? first : undefined;
}

/** Postgres text columns reject the NUL character, so it is dropped from every string before validation. */
function stripNullBytes(value: unknown): unknown {
  if (typeof value === 'string') return value.replaceAll('\0', '');
  if (Array.isArray(value)) return value.map(stripNullBytes);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, stripNullBytes(entry)]),
    );
  }
  return value;
}

/** Turns a zod issue into a sentence a customer can read, e.g. "Customer name is required." */
export function describeIssue(
  issue: z.core.$ZodIssue | undefined,
  source: Source = 'body',
): string {
  if (!issue) return 'The request is invalid.';
  const label = fieldLabel(issue.path, source);
  // zod's own wording ("Invalid input: expected string, received undefined") is replaced; a schema's message is kept.
  // The issue carries no input unless parsed with reportInput, so the wording is how a missing field is told apart.
  if (issue.code === 'invalid_type') {
    if (issue.message.endsWith('received undefined')) return `${label} is required.`;
    if (issue.message.startsWith('Invalid input')) return `${label} is invalid.`;
  }
  return issue.message;
}

function fieldLabel(path: PropertyKey[], source: Source): string {
  const name = [...path]
    .reverse()
    .find((segment): segment is string => typeof segment === 'string');
  if (!name) return source === 'body' ? 'Request body' : 'Query';
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
