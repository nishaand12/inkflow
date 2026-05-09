/**
 * Labels shown at manual checkout and in-person deposit recording.
 * Values are persisted (e.g. appointments.payment_method, payment metadata) for reporting.
 */
export const CHECKOUT_PAYMENT_METHOD_OPTIONS = [
  { value: "Cash", label: "Cash" },
  { value: "E-Transfer", label: "E-Transfer" },
  { value: "Amex", label: "Amex" },
  { value: "Mastercard", label: "Mastercard" },
  { value: "Visa", label: "Visa" },
  { value: "Debit", label: "Debit" },
  { value: "Other", label: "Other" },
];

export const CHECKOUT_PAYMENT_METHOD_VALUES = CHECKOUT_PAYMENT_METHOD_OPTIONS.map((o) => o.value);
