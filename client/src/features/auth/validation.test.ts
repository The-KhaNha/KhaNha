import { describe, expect, it } from 'vitest';
import {
  NAME_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validateEmail,
  validateName,
  validateNote,
  validatePassword,
  validatePhone,
} from './validation';

describe('validateName', () => {
  it.each([
    ['1 char', 1, false],
    ['2 chars (min)', 2, true],
    [`${NAME_MAX_LENGTH} chars (max)`, NAME_MAX_LENGTH, true],
    [`${NAME_MAX_LENGTH + 1} chars`, NAME_MAX_LENGTH + 1, false],
  ])('%s -> ok=%s', (_label, length, ok) => {
    const error = validateName('a'.repeat(length as number));
    expect(error === undefined).toBe(ok as boolean);
  });

  it('says what is wrong: missing, or too short', () => {
    expect(validateName('')).toBe('Please enter your name.');
    expect(validateName('R')).toBe(`Your name needs at least 2 characters.`);
  });

  it('trims before counting', () => {
    expect(validateName(`  ${'a'.repeat(NAME_MAX_LENGTH)}  `)).toBeUndefined();
    expect(validateName('   ')).toBeDefined();
  });
});

describe('validateEmail', () => {
  it('requires a value', () => {
    expect(validateEmail('')).toBeDefined();
    expect(validateEmail('   ')).toBeDefined();
  });

  it('rejects a value with no @ or no domain', () => {
    expect(validateEmail('not-an-email')).toBeDefined();
    expect(validateEmail('a@b')).toBeDefined();
  });

  it('accepts a normal address', () => {
    expect(validateEmail('ann@example.test')).toBeUndefined();
  });
});

describe('validatePassword', () => {
  it.each([
    [`${PASSWORD_MIN_LENGTH - 1} chars`, PASSWORD_MIN_LENGTH - 1, false],
    [`${PASSWORD_MIN_LENGTH} chars (min)`, PASSWORD_MIN_LENGTH, true],
    [`${PASSWORD_MAX_LENGTH} chars (max)`, PASSWORD_MAX_LENGTH, true],
    [`${PASSWORD_MAX_LENGTH + 1} chars`, PASSWORD_MAX_LENGTH + 1, false],
  ])('%s -> ok=%s', (_label, length, ok) => {
    const error = validatePassword('a'.repeat(length as number));
    expect(error === undefined).toBe(ok as boolean);
  });

  it('requires a value', () => {
    expect(validatePassword('')).toBeDefined();
  });
});

describe('validatePhone', () => {
  it('is optional: blank passes', () => {
    expect(validatePhone('')).toBeUndefined();
    expect(validatePhone('   ')).toBeUndefined();
  });

  it('normalises spaces, dashes and parentheses before counting digits', () => {
    expect(validatePhone('987-654 (3210)')).toBeUndefined();
  });

  it.each([
    ['9 digits (too short)', '987654321', false],
    ['10 digits (min)', '9876543210', true],
    ['15 digits (max)', '987654321012345', true],
    ['16 digits (too long)', '9876543210123456', false],
  ])('%s -> ok=%s', (_label, value, ok) => {
    const error = validatePhone(value as string);
    expect(error === undefined).toBe(ok as boolean);
  });

  it('rejects letters', () => {
    expect(validatePhone('abcdefghij')).toBeDefined();
  });

  it('allows a leading +', () => {
    expect(validatePhone('+919876543210')).toBeUndefined();
  });
});

describe('validateNote', () => {
  it.each([
    [`${NOTE_MAX_LENGTH} chars (max)`, NOTE_MAX_LENGTH, true],
    [`${NOTE_MAX_LENGTH + 1} chars`, NOTE_MAX_LENGTH + 1, false],
  ])('%s -> ok=%s', (_label, length, ok) => {
    const error = validateNote('a'.repeat(length as number));
    expect(error === undefined).toBe(ok as boolean);
  });

  it('is optional: blank passes', () => {
    expect(validateNote('')).toBeUndefined();
  });
});
