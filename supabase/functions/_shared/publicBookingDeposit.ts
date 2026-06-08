/** Appointment type row fields needed to resolve public booking deposit. */
export type PublicBookingDepositSource = {
  default_deposit?: number | string | null;
};

/**
 * Public booking must never trust client-supplied deposit amounts.
 * Always derive the deposit from the appointment type configuration.
 */
export function resolvePublicBookingDeposit(
  aptType: PublicBookingDepositSource
): number {
  const raw = aptType.default_deposit;
  const n = typeof raw === "string" ? parseFloat(raw) : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}
