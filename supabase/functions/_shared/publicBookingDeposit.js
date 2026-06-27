/**
 * Deposit amount for public online booking. Client-supplied values must never be trusted.
 */
export function resolvePublicBookingDeposit(aptType) {
  const n = Number(aptType?.default_deposit);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}
