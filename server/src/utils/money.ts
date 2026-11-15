/**
 * The only place money changes unit (ADR-004): every amount is paise in the database, and the API's existing fields
 * (`price`, `total`, `unitPrice`, `lineTotal`) are whole rupees. A conversion anywhere else is a bug
 * (test/unit/money-boundary.safe.test.ts).
 */
const PAISE_PER_RUPEE = 100;

/**
 * Paise to whole rupees, for the API's rupee fields. The database refuses a paise value that is not a whole rupee
 * while such a field exists, so a remainder means that check is gone: it throws rather than round a price.
 */
export function paiseToRupees(paise: number): number {
  if (!Number.isSafeInteger(paise) || paise % PAISE_PER_RUPEE !== 0) {
    throw new RangeError(`Not a whole number of rupees in paise: ${paise}`);
  }
  return paise / PAISE_PER_RUPEE;
}

export function rupeesToPaise(rupees: number): number {
  const paise = rupees * PAISE_PER_RUPEE;
  if (!Number.isSafeInteger(paise)) throw new RangeError(`Not a whole number of paise: ${rupees}`);
  return paise;
}
