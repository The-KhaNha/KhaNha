import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { describeIssue } from '../../src/middleware/validate';

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
