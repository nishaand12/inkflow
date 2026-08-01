/**
 * Canonical money handling.
 *
 * Currency was summed as raw floats and formatted with toFixed(2). Two things
 * go wrong with that:
 *
 *  - Drift. 100 - 100.0000000001 is not 0, so totals disagree by a penny
 *    between the register, reports and reconciliation.
 *  - Negative zero. (-0.0000001).toFixed(2) renders "-0.00", and any sign test
 *    on the unrounded value reports "negative" for a balance that is settled.
 *
 * Everything here rounds to whole cents first and normalises -0 to 0, so a
 * zero amount is zero for display, comparison and sign alike.
 *
 * Math.round's half-up-toward-positive behaviour is preserved deliberately:
 * it matches what the app already computed, so adopting these helpers does
 * not move any existing total.
 */

/** Whole cents, rounded. Never returns -0. */
export function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const cents = Math.round(n * 100);
  return cents === 0 ? 0 : cents;
}

/** Value rounded to cents. Never returns -0. */
export function roundMoney(value) {
  return toCents(value) / 100;
}

/** Sum rounded at each step so repeated addition cannot drift. */
export function sumMoney(values) {
  const cents = (values || []).reduce((total, value) => total + toCents(value), 0);
  return cents === 0 ? 0 : cents / 100;
}

/** -1, 0 or 1 — a settled amount is 0, never -1 from float noise. */
export function moneySign(value) {
  const cents = toCents(value);
  if (cents > 0) return 1;
  if (cents < 0) return -1;
  return 0;
}

/** True when the value is zero to the cent. */
export function isZeroMoney(value) {
  return toCents(value) === 0;
}

/** "$0.00" / "$-12.34". Never renders "-0.00". */
export function formatMoney(value) {
  return `$${roundMoney(value).toFixed(2)}`;
}

/** "0.00" — same rounding, no currency symbol (inputs, CSV, payloads). */
export function formatAmount(value) {
  return roundMoney(value).toFixed(2);
}
