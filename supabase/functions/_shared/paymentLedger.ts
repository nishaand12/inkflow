/**
 * Studio-local business date for POS reconciliation (YYYY-MM-DD).
 */
export function businessDateInTimezone(isoTimestamp: string, timezone: string): string {
  return new Date(isoTimestamp).toLocaleDateString("en-CA", {
    timeZone: timezone || "UTC",
  });
}

export type PaymentLedgerFields = {
  location_id: string | null;
  business_date: string;
  tender_type: string;
  channel: "in_person" | "online";
  purpose: string;
  occurred_at: string;
};

/** Build ledger columns for a paid payment row. */
export function buildPaymentLedgerFields(opts: {
  locationId: string | null | undefined;
  timezone: string | null | undefined;
  paidAt?: string;
  tenderType: string;
  channel: "in_person" | "online";
  purpose: string;
}): PaymentLedgerFields {
  const paidAt = opts.paidAt || new Date().toISOString();
  return {
    location_id: opts.locationId || null,
    business_date: businessDateInTimezone(paidAt, opts.timezone || "UTC"),
    tender_type: opts.tenderType,
    channel: opts.channel,
    purpose: opts.purpose,
    occurred_at: paidAt,
  };
}
