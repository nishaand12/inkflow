/** How checkout `payment_method` and in-person deposit methods map to settlement / report buckets. */
export function getCollectionBucket(paymentMethod) {
  if (paymentMethod === "Stripe") return "online";
  if (paymentMethod === "Cash" || paymentMethod === "E-Transfer") return "cash";
  return "terminal";
}
