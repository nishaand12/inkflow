/** Max tender rows at checkout (primary + optional second). */
export const MAX_SPLIT_TENDERS = 2;

export function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function createTenderRow(overrides = {}) {
  return {
    id: overrides.id || `tender-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    method: overrides.method || "",
    amount: overrides.amount != null ? String(overrides.amount) : "",
    tip: overrides.tip != null ? String(overrides.tip) : "",
    paymentId: overrides.paymentId || null,
  };
}

export function joinPaymentMethods(methods) {
  return (methods || []).filter(Boolean).join(", ");
}

export function parsePaymentMethods(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parsePaymentMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Balance portion of a payment row (excludes tip stored in metadata). */
export function getPaymentBalanceAmount(payment) {
  const total = roundMoney(payment?.amount);
  const meta = parsePaymentMetadata(payment?.metadata);
  const tip = roundMoney(meta.tip);
  if (tip > 0 && tip <= total) return roundMoney(total - tip);
  return total;
}

export function getPaymentTipAmount(payment) {
  return roundMoney(parsePaymentMetadata(payment?.metadata).tip);
}

/**
 * Build tender rows from paid/voided balance payment rows for re-checkout preload
 * or payment-method edit.
 */
export function tenderRowsFromPayments(payments) {
  const rows = (payments || [])
    .filter((p) => p && (p.status === "paid" || p.status === "voided"))
    .map((p) =>
      createTenderRow({
        paymentId: p.id,
        method: p.tender_type || "",
        amount: getPaymentBalanceAmount(p),
        tip: getPaymentTipAmount(p) || "",
      })
    );
  if (rows.length === 0) return [createTenderRow()];
  return rows.slice(0, MAX_SPLIT_TENDERS);
}

export function sumTenderAmounts(rows) {
  return roundMoney(
    (rows || []).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  );
}

export function sumTenderTips(rows) {
  return roundMoney(
    (rows || []).reduce((s, r) => s + (parseFloat(r.tip) || 0), 0)
  );
}

/**
 * Validate split tender rows against balance due (merchandise after deposit, before tip).
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateSplitTenders(rows, balanceDue) {
  const balance = roundMoney(balanceDue);
  const active = (rows || []).filter(
    (r) => (parseFloat(r.amount) || 0) > 0 || (parseFloat(r.tip) || 0) > 0
  );

  if (balance > 0 && active.length === 0) {
    return { ok: false, error: "Add a payment method and amount." };
  }

  for (const r of active) {
    if (!r.method) {
      return { ok: false, error: "Select a payment method for each tender row." };
    }
  }

  const methods = active.map((r) => r.method);
  if (new Set(methods).size !== methods.length) {
    return { ok: false, error: "Each payment method can only be used once." };
  }

  const amountSum = sumTenderAmounts(rows);
  if (amountSum !== balance) {
    const remaining = roundMoney(balance - amountSum);
    if (remaining > 0) {
      return {
        ok: false,
        error: `Payment amounts are short by $${remaining.toFixed(2)}.`,
      };
    }
    return {
      ok: false,
      error: `Payment amounts exceed balance by $${Math.abs(remaining).toFixed(2)}.`,
    };
  }

  return { ok: true };
}

/**
 * Build finalize_sale p_payment payload (array, or null when nothing to collect).
 * Each payment amount = balance amount + tip; tip also stored in metadata.
 */
export function buildPaymentPayload(rows, { channel = "in_person" } = {}) {
  const payments = [];
  for (const r of rows || []) {
    const balanceAmt = roundMoney(parseFloat(r.amount) || 0);
    const tipAmt = roundMoney(parseFloat(r.tip) || 0);
    const total = roundMoney(balanceAmt + tipAmt);
    if (total <= 0 || !r.method) continue;
    const entry = {
      tender_type: r.method,
      channel,
      amount: total,
    };
    if (tipAmt > 0) {
      entry.metadata = { tip: tipAmt, balance_amount: balanceAmt };
    }
    payments.push(entry);
  }
  if (payments.length === 0) return null;
  return payments;
}
