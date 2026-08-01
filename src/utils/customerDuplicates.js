/**
 * Duplicate-customer matching.
 *
 * Extracted so the null-handling is testable: customers may have no email
 * (walk-ins are often phone-only), and a raw `c.email.toLowerCase()` throws
 * mid-submit — which killed the save before the mutation fired, silently.
 */

const norm = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");
const normPhone = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * Existing customers matching the draft on email or phone.
 *
 * A blank field never matches: without this, two customers who both lack an
 * email would compare "" === "" and be reported as duplicates of each other.
 */
export function findDuplicateCustomers(existingCustomers, draft) {
  const email = norm(draft?.email);
  const phone = normPhone(draft?.phone_number);
  if (!email && !phone) return [];

  return (existingCustomers || []).filter((candidate) => {
    if (!candidate) return false;
    const emailMatch = Boolean(email) && norm(candidate.email) === email;
    const phoneMatch = Boolean(phone) && normPhone(candidate.phone_number) === phone;
    return emailMatch || phoneMatch;
  });
}
