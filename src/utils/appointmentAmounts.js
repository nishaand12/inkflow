/**
 * Derive appointment money amounts for reporting and settlements.
 *
 * At checkout we store:
 * - appointment.charge_amount: pre-tax net (tax backed out for tax-inclusive lines)
 * - appointment.tax_amount: total tax
 * - charge.line_total: customer-facing line amount (tax-inclusive when applicable)
 *
 * Downstream code must not treat line_total as pre-tax when computing splits or net revenue.
 */

export function getPreTaxRatio(preTaxNet, lineTotalSum) {
  const net = Number(preTaxNet) || 0;
  const sum = Number(lineTotalSum) || 0;
  if (sum === 0) return 1;
  return net / sum;
}

/** Pre-tax amount for a single charge line. */
export function getChargePreTaxAmount(charge, preTaxRatio) {
  return (Number(charge?.line_total) || 0) * preTaxRatio;
}

/**
 * @returns {{
 *   lineTotalSum: number,
 *   preTaxNet: number,
 *   servicePreTax: number,
 *   productPreTax: number,
 *   tax: number,
 *   tip: number,
 *   discount: number,
 *   totalCollected: number,
 *   customerTotal: number,
 *   preTaxRatio: number,
 * }}
 */
export function getAppointmentAmounts(appointment, charges = []) {
  const tip = Number(appointment?.tip_amount) || 0;
  const tax = Number(appointment?.tax_amount) || 0;
  const discount = Number(appointment?.discount_amount) || 0;
  const preTaxNet = Number(appointment?.charge_amount) || 0;
  const deposit = Number(appointment?.deposit_amount) || 0;

  const chargeList = Array.isArray(charges) ? charges : [];

  if (chargeList.length === 0) {
    const fallbackPreTax = preTaxNet > 0 ? preTaxNet : deposit;
    const totalCollected = fallbackPreTax + tax;
    return {
      lineTotalSum: fallbackPreTax,
      preTaxNet: fallbackPreTax,
      servicePreTax: fallbackPreTax,
      productPreTax: 0,
      tax,
      tip,
      discount,
      totalCollected,
      customerTotal: totalCollected,
      preTaxRatio: 1,
    };
  }

  const lineTotalSum = chargeList.reduce((s, c) => s + (Number(c.line_total) || 0), 0);
  const serviceLineTotal = chargeList
    .filter((c) => c.line_type === "service")
    .reduce((s, c) => s + (Number(c.line_total) || 0), 0);
  const productLineTotal = chargeList
    .filter((c) => c.line_type === "product")
    .reduce((s, c) => s + (Number(c.line_total) || 0), 0);

  const preTaxRatio = getPreTaxRatio(preTaxNet, lineTotalSum);
  const servicePreTax = serviceLineTotal * preTaxRatio;
  const productPreTax = productLineTotal * preTaxRatio;
  const totalCollected = preTaxNet + tax;
  const customerTotal = totalCollected > 0 ? totalCollected : lineTotalSum;

  return {
    lineTotalSum,
    preTaxNet,
    servicePreTax,
    productPreTax,
    tax,
    tip,
    discount,
    totalCollected,
    customerTotal,
    preTaxRatio,
  };
}

/** Amounts shape used by settlements and revenue split calculations. */
export function getAppointmentSettlementAmounts(appointment, appointmentCharges) {
  const amounts = getAppointmentAmounts(appointment, appointmentCharges);
  return {
    gross: amounts.customerTotal,
    service: amounts.servicePreTax,
    product: amounts.productPreTax,
    tip: amounts.tip,
    preTaxNet: amounts.preTaxNet,
  };
}
