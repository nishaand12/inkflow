/** Metadata written when a Stripe Checkout deposit payment is marked paid. */
export function mergeStripeDepositPaidMetadata(
  existing: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...existing }
      : {};
  return {
    ...base,
    collection_channel: "online",
    method: "Stripe",
  };
}
