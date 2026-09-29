import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { describeIssue, validate } from '../../src/middleware/validate';

function issueFor(schema: z.ZodTypeAny, value: unknown): z.ZodIssue {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('expected the schema to fail');
  const [issue] = result.error.issues;
  if (!issue) throw new Error('expected at least one issue');
  return issue;
}

describe('describeIssue', () => {
  it('returns a generic message when there is no issue', () => {
    expect(describeIssue(undefined)).toBe('The request is invalid.');
  });

  it('labels a missing required field as "<Field> is required."', () => {
    const schema = z.object({ customerName: z.string() });
    expect(describeIssue(issueFor(schema, {}))).toBe('Customer name is required.');
  });

  it('labels a wrong type (present but not undefined) as "<Field> is invalid."', () => {
    const schema = z.object({ quantity: z.number() });
    expect(describeIssue(issueFor(schema, { quantity: 'x' }))).toBe('Quantity is invalid.');
  });

  it('falls back to the schema’s own message for a custom refinement', () => {
    const schema = z.object({ name: z.string().min(2, 'Name must be at least 2 characters.') });
    expect(describeIssue(issueFor(schema, { name: 'a' }))).toBe(
      'Name must be at least 2 characters.',
    );
  });

  it('camel-cases a nested field name into words ("customerPhone" -> "Customer phone")', () => {
    const schema = z.object({ customerPhone: z.string() });
    expect(describeIssue(issueFor(schema, {}))).toBe('Customer phone is required.');
  });

  it('labels an array item by its own field name, not the array', () => {
    const schema = z.object({ items: z.array(z.object({ menuItemId: z.string() })) });
    expect(describeIssue(issueFor(schema, { items: [{}] }))).toBe('Menu item id is required.');
  });

  it('falls back to "Request body" / "Query" with no named field on the path', () => {
    const schema = z.string();
    expect(describeIssue(issueFor(schema, 5), 'body')).toBe('Request body is invalid.');
    expect(describeIssue(issueFor(schema, 5), 'query')).toBe('Query is invalid.');
  });
});

describe('validate middleware', () => {
  const run = (schema: z.ZodTypeAny, value: unknown, source: 'body' | 'query' = 'body') => {
    const req = { [source]: value } as unknown as Request;
    const next = vi.fn();
    let thrown: unknown;
    try {
      validate(schema, source)(req, {} as Response, next);
    } catch (error) {
      thrown = error;
    }
    return { req, next, thrown };
  };

  it('names the top-level field at fault in details, even for a nested path', () => {
    const schema = z.object({ items: z.array(z.object({ quantity: z.number() })) });
    const { thrown, next } = run(schema, { items: [{}, { quantity: 'x' }] });
    expect(thrown).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: { field: 'items' },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('has no details when the failure is not about one field (body is not an object)', () => {
    const { thrown } = run(z.object({ a: z.string() }), 'x');
    expect(thrown).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((thrown as { details?: unknown }).details).toBeUndefined();
  });

  it('strips NUL bytes before validating and passes the parsed value on', () => {
    const { req, next, thrown } = run(z.object({ note: z.string().max(3) }), { note: 'a\0b\0c' });
    expect(thrown).toBeUndefined();
    expect(req.body).toEqual({ note: 'abc' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('validates a query source and replaces req.query with the parsed value', () => {
    const { req, thrown } = run(z.object({ n: z.coerce.number() }), { n: '5' }, 'query');
    expect(thrown).toBeUndefined();
    expect(req.query).toEqual({ n: 5 });
    const bad = run(z.object({ n: z.coerce.number() }), { n: 'x' }, 'query');
    expect(bad.thrown).toMatchObject({ details: { field: 'n' } });
  });
});
