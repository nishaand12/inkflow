/**
 * Canonical sale-line math. Mirrors the server-side finalize_sale() RPC so the
 * client preview and the persisted rows always agree.
 *
 * A line item (cart shape) has:
 *   line_type, quantity, unit_price, discount_amount, tax_rate, tax_inclusive,
 *   revenue_sign ('positive' | 'negative'), plus display fields.
 */

export const DEFAULT_SERVICE_TAX_RATE = 0.13;

export function lineSign(li) {
  return li.revenue_sign === "negative" ? -1 : 1;
}

export function lineGrossAfterDiscount(li) {
  const qty = Number(li.quantity) || 0;
  const unit = Number(li.unit_price) || 0;
  const disc = Number(li.discount_amount) || 0;
  return Math.max(0, qty * unit - disc);
}

export function lineTaxRate(li) {
  const r = Number(li.tax_rate);
  return Number.isFinite(r) && r > 0 ? r : 0;
}

/** Signed pre-tax net for a line. */
export function lineNetAmount(li) {
  const gross = lineGrossAfterDiscount(li);
  const rate = lineTaxRate(li);
  const net = rate > 0 && li.tax_inclusive ? gross / (1 + rate) : gross;
  return lineSign(li) * net;
}

/** Signed tax for a line. */
export function lineTaxAmount(li) {
  const gross = lineGrossAfterDiscount(li);
  const rate = lineTaxRate(li);
  if (rate <= 0) return 0;
  const tax = li.tax_inclusive ? gross - gross / (1 + rate) : gross * rate;
  return lineSign(li) * tax;
}

/** Signed line total (net + tax) — the customer-facing amount for the line. */
export function lineTotal(li) {
  return lineNetAmount(li) + lineTaxAmount(li);
}

/** Totals for a cart of lines + tip. */
export function computeSaleTotals(lines, tip = 0) {
  const subtotal = lines.reduce((s, li) => s + lineNetAmount(li), 0);
  const taxTotal = lines.reduce((s, li) => s + lineTaxAmount(li), 0);
  const discountTotal = lines.reduce((s, li) => s + (Number(li.discount_amount) || 0), 0);
  const grossBeforeDiscounts = lines.reduce(
    (s, li) => s + lineSign(li) * (Number(li.quantity) || 0) * (Number(li.unit_price) || 0),
    0
  );
  const tipTotal = Math.max(0, Number(tip) || 0);
  const grandTotal = subtotal + taxTotal;
  return {
    subtotal,
    taxTotal,
    discountTotal,
    grossBeforeDiscounts,
    tipTotal,
    grandTotal,
    totalWithTip: grandTotal + tipTotal,
  };
}

/**
 * Service vs product net + tax split for a cart (drives artist commission).
 * serviceTax/productTax come from each line's own rate, so mixed-rate carts
 * (tax-exempt gift cards, zero-rated services) allocate correctly.
 */
export function saleServiceProductNet(lines) {
  let service = 0;
  let product = 0;
  let serviceTax = 0;
  let productTax = 0;
  for (const li of lines) {
    const net = lineNetAmount(li);
    const tax = lineTaxAmount(li);
    if (li.line_type === "service") {
      service += net;
      serviceTax += tax;
    } else {
      product += net;
      productTax += tax;
    }
  }
  return {
    service: Math.max(0, service),
    product: Math.max(0, product),
    serviceTax: Math.max(0, serviceTax),
    productTax: Math.max(0, productTax),
  };
}

/** Build the p_lines jsonb payload for finalize_sale. */
export function buildFinalizeLines(lines, resolveCategoryName = () => "") {
  return lines.map((li) => ({
    line_type: li.line_type || "product",
    reporting_category_id: li.reporting_category_id || null,
    reporting_category_name:
      li.reporting_category_name || resolveCategoryName(li.reporting_category_id) || null,
    product_id: li.product_id || null,
    description: li.description,
    quantity: Number(li.quantity) || 1,
    unit_price: Number(li.unit_price) || 0,
    discount_amount: Number(li.discount_amount) || 0,
    tax_rate: lineTaxRate(li),
    tax_inclusive: Boolean(li.tax_inclusive),
    revenue_sign: lineSign(li),
  }));
}

/** Map cart lines that use `_revenue_sign` (CheckoutDialog) to canonical shape. */
export function normalizeCartLines(lines) {
  return (lines || []).map((li) => ({
    ...li,
    revenue_sign: li.revenue_sign ?? (li._revenue_sign === "negative" ? "negative" : "positive"),
  }));
}

/**
 * Checked-out summary from a unified sale + line items.
 * merchandiseTotal is what the customer pays for goods (tax already included when
 * lines are tax-inclusive — tax is shown for reporting, not added again).
 */
export function buildCheckoutSummaryFromSale(sale, lineItems, appointment) {
  const lines = [...(lineItems || [])].sort((a, b) =>
    String(a.created_at || "").localeCompare(String(b.created_at || ""))
  );

  const tip = Number(appointment?.tip_amount) || Number(sale?.tip_total) || 0;

  const grossBeforeDiscounts = lines.reduce((sum, li) => {
    const sign = (Number(li.line_total) || 0) < 0 ? -1 : 1;
    return sum + sign * (Number(li.quantity) || 0) * (Number(li.unit_price) || 0);
  }, 0);

  const lineDiscountsTotal = lines.reduce(
    (s, li) => s + (Number(li.discount_amount) || 0),
    0
  );

  const tax = sale
    ? Number(sale.tax_total) || 0
    : lines.reduce((s, li) => s + (Number(li.tax_amount) || 0), 0) ||
      Number(appointment?.tax_amount) ||
      0;

  const merchandiseTotal = sale
    ? (Number(sale.subtotal) || 0) + (Number(sale.tax_total) || 0)
    : lines.reduce((s, li) => s + (Number(li.line_total) || 0), 0);

  const netPreTax =
    sale != null
      ? Number(sale.subtotal) || Math.max(0, merchandiseTotal - tax)
      : Math.max(0, merchandiseTotal - tax);

  const allTaxInclusive =
    lines.length > 0 && lines.every((li) => li.tax_inclusive !== false);

  const depositOnFile = Number(appointment?.deposit_amount) || 0;
  const depositCredited =
    appointment?.deposit_status === "paid"
      ? Math.min(depositOnFile, Math.max(0, merchandiseTotal))
      : 0;

  return {
    lines,
    grossBeforeDiscounts,
    lineDiscountsTotal,
    netPreTax,
    tax,
    merchandiseTotal,
    tip,
    totalBeforeTip: merchandiseTotal,
    grandTotal: merchandiseTotal + tip,
    allTaxInclusive,
    depositCredited,
    amountDue: Math.max(0, merchandiseTotal - depositCredited) + tip,
  };
}

/**
 * Legacy appointment_charges rows store line_total as the sticker price (tax-inclusive
 * when prices include tax). Do not add appointment.tax_amount on top again.
 */
export function buildCheckoutSummaryFromLegacyCharges(charges, appointment) {
  const lines = [...(charges || [])].sort((a, b) =>
    String(a.created_at || "").localeCompare(String(b.created_at || ""))
  );

  const grossBeforeDiscounts = lines.reduce(
    (sum, charge) => sum + Math.abs(Number(charge.quantity) || 0) * (Number(charge.unit_price) || 0),
    0
  );
  const lineDiscountsTotal = lines.reduce(
    (s, c) => s + (Number(c.discount_amount) || 0),
    0
  );
  const merchandiseTotal = lines.reduce(
    (s, c) => s + (Number(c.line_total) || 0),
    0
  );
  const tax = Number(appointment?.tax_amount) || 0;
  const tip = Number(appointment?.tip_amount) || 0;
  const depositOnFile = Number(appointment?.deposit_amount) || 0;
  const depositCredited =
    appointment?.deposit_status === "paid"
      ? Math.min(depositOnFile, Math.max(0, merchandiseTotal))
      : 0;

  return {
    lines,
    grossBeforeDiscounts,
    lineDiscountsTotal,
    netPreTax: Math.max(0, merchandiseTotal - tax),
    tax,
    merchandiseTotal,
    tip,
    totalBeforeTip: merchandiseTotal,
    grandTotal: merchandiseTotal + tip,
    allTaxInclusive: true,
    depositCredited,
    amountDue: Math.max(0, merchandiseTotal - depositCredited) + tip,
  };
}
