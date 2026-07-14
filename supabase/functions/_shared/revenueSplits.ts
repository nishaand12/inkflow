/**
 * Server-side mirror of the split math in src/utils/revenueSplits.js and
 * src/utils/saleLines.js — keep the three in sync. Used by stripe-webhook so an
 * online "Check Out via Stripe" sale accrues the same artist_share a manual
 * checkout would have written.
 *
 * Rule precedence (first active match wins):
 *   1. appointment_type + artist (only when the artist has appointment-type splits enabled)
 *   2. appointment_type (no artist)
 *   3. artist (no appointment_type)
 *   4. none -> 0
 *
 * Percent splits apply to service net + service-line tax (artists remit HST on
 * their share); products and their tax are 100% shop; tips are handled outside
 * this module (100% artist). Fixed-amount splits pay an exact dollar amount
 * capped at pre-tax service.
 */

export interface SplitRule {
  artist_id?: string | null;
  appointment_type_id?: string | null;
  is_active?: boolean | null;
  split_mode?: string | null;
  split_value?: number | string | null;
  split_percent?: number | string | null;
}

export interface FinalizeLine {
  line_type?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  discount_amount?: number | string | null;
  tax_rate?: number | string | null;
  tax_inclusive?: boolean | null;
  revenue_sign?: number | string | null;
}

function lineSign(li: FinalizeLine): number {
  return Number(li.revenue_sign) < 0 ? -1 : 1;
}

function lineGrossAfterDiscount(li: FinalizeLine): number {
  const qty = Number(li.quantity) || 0;
  const unit = Number(li.unit_price) || 0;
  const disc = Number(li.discount_amount) || 0;
  return Math.max(0, qty * unit - disc);
}

function lineTaxRate(li: FinalizeLine): number {
  const r = Number(li.tax_rate);
  return Number.isFinite(r) && r > 0 ? r : 0;
}

function lineNetAmount(li: FinalizeLine): number {
  const gross = lineGrossAfterDiscount(li);
  const rate = lineTaxRate(li);
  const net = rate > 0 && li.tax_inclusive ? gross / (1 + rate) : gross;
  return lineSign(li) * net;
}

function lineTaxAmount(li: FinalizeLine): number {
  const gross = lineGrossAfterDiscount(li);
  const rate = lineTaxRate(li);
  if (rate <= 0) return 0;
  const tax = li.tax_inclusive ? gross - gross / (1 + rate) : gross * rate;
  return lineSign(li) * tax;
}

export function saleServiceProductNet(lines: FinalizeLine[]) {
  let service = 0;
  let product = 0;
  let serviceTax = 0;
  for (const li of lines) {
    if (li.line_type === "service") {
      service += lineNetAmount(li);
      serviceTax += lineTaxAmount(li);
    } else {
      product += lineNetAmount(li);
    }
  }
  return {
    service: Math.max(0, service),
    product: Math.max(0, product),
    serviceTax: Math.max(0, serviceTax),
  };
}

interface SplitContext {
  appointmentTypeId?: string | null;
  artistId?: string | null;
  appointmentTypeSplitEnabled?: boolean;
}

function isActive(rule: SplitRule): boolean {
  return Boolean(rule?.is_active);
}

export function resolveSplitRule(
  splitRules: SplitRule[] | null | undefined,
  { appointmentTypeId, artistId, appointmentTypeSplitEnabled = true }: SplitContext,
): SplitRule | null {
  const rules = Array.isArray(splitRules) ? splitRules : [];

  const byAppointmentAndArtist = rules.find(
    (rule) =>
      isActive(rule) &&
      rule.appointment_type_id === appointmentTypeId &&
      rule.artist_id === artistId,
  );
  if (byAppointmentAndArtist && appointmentTypeSplitEnabled !== false) {
    return byAppointmentAndArtist;
  }

  const byAppointment = rules.find(
    (rule) =>
      isActive(rule) &&
      rule.appointment_type_id === appointmentTypeId &&
      !rule.artist_id,
  );
  if (byAppointment) return byAppointment;

  const byArtist = rules.find(
    (rule) =>
      isActive(rule) &&
      rule.artist_id === artistId &&
      !rule.appointment_type_id,
  );
  if (byArtist) return byArtist;

  return null;
}

/** Artist share for a finalized sale, rounded to cents. Tips are NOT included. */
export function computeArtistShareForLines(
  splitRules: SplitRule[] | null | undefined,
  ctx: SplitContext,
  lines: FinalizeLine[],
): number {
  const rule = resolveSplitRule(splitRules, ctx);
  if (!rule) return 0;

  const { service, serviceTax } = saleServiceProductNet(lines);

  let share: number;
  if (rule.split_mode === "fixed_amount") {
    const fixed = Math.max(0, Number(rule.split_value) || 0);
    share = Math.min(fixed, service);
  } else {
    const rawPercent = Number(rule.split_value);
    const percent = Math.min(
      100,
      Math.max(
        0,
        Number.isFinite(rawPercent) ? rawPercent : Number(rule.split_percent) || 0,
      ),
    );
    share = (service + serviceTax) * (percent / 100);
  }

  return Math.round(share * 100) / 100;
}
