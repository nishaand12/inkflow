import { supabase } from "@/utils/supabase";
import { containsPattern, escapeLikeTerm } from "@/utils/likePattern";

/**
 * Server-side customer lookup.
 *
 * Every customer-facing screen used to download the studio's entire customer
 * table and filter it in the browser. Past the API row cap that response is
 * silently truncated, so customers become unfindable in search — which leads
 * staff to re-create them, producing real duplicates.
 */

export const CUSTOMER_SEARCH_LIMIT = 25;
export const CUSTOMER_PAGE_SIZE = 50;

export { escapeLikeTerm };

function baseSelect(studioId, { activeOnly }) {
  let query = supabase.from("customers").select("*").eq("studio_id", studioId);
  if (activeOnly) query = query.eq("is_active", true);
  return query;
}

/**
 * Customers matching `term` on name, email or phone. A blank term returns the
 * first page by name so the picker still opens with something useful.
 */
export async function searchCustomers(
  studioId,
  term,
  { limit = CUSTOMER_SEARCH_LIMIT, activeOnly = true } = {}
) {
  if (!studioId) return [];

  const trimmed = String(term ?? "").trim();
  let query = baseSelect(studioId, { activeOnly });

  if (trimmed) {
    const pattern = containsPattern(trimmed);
    query = query.or(
      `name.ilike.${pattern},email.ilike.${pattern},phone_number.ilike.${pattern}`
    );
  }

  const { data, error } = await query.order("name", { ascending: true }).limit(limit);
  if (error) throw error;
  return data || [];
}

/**
 * One page of customers for browsing. Ordered by name then id so paging is
 * deterministic — an unordered page can repeat or skip rows between fetches.
 */
export async function listCustomersPage(
  studioId,
  { offset = 0, pageSize = CUSTOMER_PAGE_SIZE, term = "", activeOnly = false } = {}
) {
  if (!studioId) return [];

  const trimmed = String(term ?? "").trim();
  let query = baseSelect(studioId, { activeOnly });

  if (trimmed) {
    const pattern = containsPattern(trimmed);
    query = query.or(
      `name.ilike.${pattern},email.ilike.${pattern},phone_number.ilike.${pattern}`
    );
  }

  const { data, error } = await query
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + pageSize - 1);

  if (error) throw error;
  return data || [];
}

/**
 * Multi-field search where every supplied field must match (AND), as opposed
 * to searchCustomers' single term across fields (OR).
 */
export async function advancedSearchCustomers(
  studioId,
  fields = {},
  { limit = CUSTOMER_PAGE_SIZE } = {}
) {
  if (!studioId) return [];

  const supported = ["name", "phone_number", "email", "instagram_username"];
  const active = supported
    .map((column) => [column, String(fields[column] ?? "").trim()])
    .filter(([, value]) => value !== "");

  if (active.length === 0) return [];

  let query = supabase.from("customers").select("*").eq("studio_id", studioId);
  for (const [column, value] of active) {
    query = query.ilike(column, containsPattern(value));
  }

  const { data, error } = await query
    .order("name", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/** Exact-match duplicate lookup across the whole table, not just a page. */
export async function findExistingCustomers(studioId, { email, phone } = {}) {
  if (!studioId) return [];

  const cleanEmail = String(email ?? "").trim();
  const cleanPhone = String(phone ?? "").trim();
  if (!cleanEmail && !cleanPhone) return [];

  const clauses = [];
  if (cleanEmail) clauses.push(`email.ilike.${escapeLikeTerm(cleanEmail)}`);
  if (cleanPhone) clauses.push(`phone_number.eq.${cleanPhone}`);

  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("studio_id", studioId)
    .or(clauses.join(","))
    .limit(10);

  if (error) throw error;
  return data || [];
}
