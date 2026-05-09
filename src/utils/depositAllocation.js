import { getCollectionBucket } from "./collectionBuckets";

/**
 * Paid deposit payment rows for an appointment (Stripe or in-person).
 * @param {Array<Record<string, unknown>>} allPayments
 * @param {string} appointmentId
 */
export function getPaidDepositRowsForAppointment(allPayments, appointmentId) {
  return (allPayments || []).filter(
    (p) =>
      p.appointment_id === appointmentId &&
      p.payment_type === "deposit" &&
      p.status === "paid"
  );
}

function isStripeOnlineDepositPayment(p) {
  const meta = p.metadata || {};
  if (meta.collection_channel === "in_person") return false;
  return true;
}

/**
 * Split capped paid-deposit dollars (see getPaidDepositAmount) into settlement buckets.
 * Uses paid `payments` rows when present; otherwise assumes legacy Stripe (online).
 * @returns {{ online: number, cash: number, terminal: number }}
 */
export function allocatePaidDepositToBuckets(paidDepositAmount, depositPaidRows) {
  const out = { online: 0, cash: 0, terminal: 0 };
  const paid = paidDepositAmount || 0;
  if (paid <= 0) return out;

  const rows = (depositPaidRows || []).filter(
    (p) => p.status === "paid" && p.payment_type === "deposit"
  );
  if (rows.length === 0) {
    out.online = paid;
    return out;
  }

  const totalRowAmount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  for (const r of rows) {
    const w =
      totalRowAmount > 0
        ? (Number(r.amount) || 0) / totalRowAmount
        : 1 / rows.length;
    const portion = paid * w;

    if (isStripeOnlineDepositPayment(r)) {
      out.online += portion;
    } else {
      const meta = r.metadata || {};
      const method = meta.method || "Other";
      const bucket = getCollectionBucket(method);
      if (bucket === "cash") out.cash += portion;
      else if (bucket === "terminal") out.terminal += portion;
      else out.online += portion;
    }
  }

  return out;
}

/**
 * Split paid deposit into reporting labels (checkout-style strings: Stripe, Cash, Visa, …).
 * @returns {Record<string, number>}
 */
export function allocatePaidDepositToMethodLabels(paidDepositAmount, depositPaidRows) {
  /** @type {Record<string, number>} */
  const labels = {};
  const paid = paidDepositAmount || 0;
  if (paid <= 0) return labels;

  const rows = (depositPaidRows || []).filter(
    (p) => p.status === "paid" && p.payment_type === "deposit"
  );

  const add = (label, amt) => {
    if (!label || amt <= 0) return;
    labels[label] = (labels[label] || 0) + amt;
  };

  if (rows.length === 0) {
    add("Stripe", paid);
    return labels;
  }

  const totalRowAmount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  for (const r of rows) {
    const w =
      totalRowAmount > 0
        ? (Number(r.amount) || 0) / totalRowAmount
        : 1 / rows.length;
    const portion = paid * w;
    const meta = r.metadata || {};
    if (isStripeOnlineDepositPayment(r)) {
      add("Stripe", portion);
    } else {
      add(meta.method || "Other", portion);
    }
  }

  return labels;
}
