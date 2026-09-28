/**
 * Field bounds the API enforces and the client's forms mirror. The client's one copy is
 * client/src/config/fallbacks.json (`validation`), kept equal by test/unit/limits-parity.safe.test.ts.
 */
export const LIMITS = {
  nameMin: 2,
  nameMax: 60,
  noteMax: 200,
  // bcrypt only reads the first 72 bytes, so a longer password would silently be truncated.
  password: { min: 6, max: 72 },
  phoneDigits: { min: 10, max: 15 },
} as const;
