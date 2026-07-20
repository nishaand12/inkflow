import { supabase } from "@/utils/supabase";
import { eachDayOfInterval, format, parseISO } from "date-fns";

function applyLocationFilter(query, locationId) {
  if (locationId && locationId !== "all") {
    return query.eq("location_id", locationId);
  }
  return query;
}

/**
 * Reconciliations in the selected date range (any status).
 */
export async function fetchReconciliationsInRange({ studioId, startDate, endDate, locationId }) {
  let query = supabase
    .from("daily_reconciliations")
    .select("*")
    .eq("studio_id", studioId)
    .gte("business_date", startDate)
    .lte("business_date", endDate)
    .order("business_date", { ascending: false });

  query = applyLocationFilter(query, locationId);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Snapshot summaries for closed days in range (written at reconciliation close).
 * Prefer fetchDailyTotalsReport (RPC) for the Daily Totals tab.
 */
export async function fetchReconciliationSummariesInRange({ studioId, startDate, endDate, locationId }) {
  let query = supabase
    .from("reconciliation_report_summaries")
    .select("*")
    .eq("studio_id", studioId)
    .gte("business_date", startDate)
    .lte("business_date", endDate)
    .order("business_date", { ascending: false });

  query = applyLocationFilter(query, locationId);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Days × locations in range that are not closed (open reconciliation or no record).
 */
export function computeUnreconciledDays({ startDate, endDate, locationIds, reconciliations, locationId }) {
  const scopedLocationIds =
    locationId && locationId !== "all" ? [locationId] : locationIds;

  if (!scopedLocationIds.length || !startDate || !endDate || startDate > endDate) {
    return [];
  }

  const reconByKey = new Map();
  for (const recon of reconciliations) {
    reconByKey.set(`${recon.business_date}|${recon.location_id}`, recon);
  }

  const days = eachDayOfInterval({
    start: parseISO(`${startDate}T12:00:00`),
    end: parseISO(`${endDate}T12:00:00`),
  });

  const unreconciled = [];
  for (const day of days) {
    const businessDate = format(day, "yyyy-MM-dd");
    for (const locId of scopedLocationIds) {
      const recon = reconByKey.get(`${businessDate}|${locId}`);
      if (!recon || recon.status !== "closed") {
        unreconciled.push({
          business_date: businessDate,
          location_id: locId,
          status: recon?.status || "missing",
        });
      }
    }
  }
  return unreconciled;
}

/**
 * Shared report context for the unreconciled-days accordion detail list.
 */
export async function fetchReportContext({ studioId, startDate, endDate, locationId }) {
  const reconciliations = await fetchReconciliationsInRange({
    studioId,
    startDate,
    endDate,
    locationId,
  });
  return { reconciliations };
}

// ---------------------------------------------------------------------------
// Tab fetchers
// ---------------------------------------------------------------------------

function normalizeLocationId(locationId) {
  return locationId && locationId !== "all" ? locationId : null;
}

/**
 * Closed reconciliation daily totals for a date range (server-side aggregation).
 * @returns {Promise<{ rows: object[], period_summary: object, unreconciled_day_count: number }>}
 */
export async function fetchDailyTotalsReport({ startDate, endDate, locationId }) {
  const { data, error } = await supabase.rpc("get_reconciliation_daily_totals", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_location_id: normalizeLocationId(locationId),
  });
  if (error) throw error;
  return (
    data ?? {
      rows: [],
      period_summary: {},
      unreconciled_day_count: 0,
    }
  );
}

/** Phase 3 — get_reconciliation_category_totals RPC */
export async function fetchCategoryReport({ startDate, endDate, locationId, rollupMode = "leaf" }) {
  const { data, error } = await supabase.rpc("get_reconciliation_category_totals", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_location_id: normalizeLocationId(locationId),
    p_rollup_mode: rollupMode,
  });
  if (error) throw error;
  return data?.rows ?? [];
}

/** Category detail — products / appointment types within one category */
export async function fetchCategoryItemReport({
  startDate,
  endDate,
  locationId,
  categoryKey,
  includeDescendants = false,
  limit = 50,
  offset = 0,
}) {
  const { data, error } = await supabase.rpc("get_reconciliation_category_item_totals", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_location_id: normalizeLocationId(locationId),
    p_category_key: categoryKey,
    p_include_descendants: includeDescendants,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (
    data ?? {
      rows: [],
      total_count: 0,
      limit,
      offset,
      category_key: categoryKey,
      category_name: "Category",
      summary: { item_count: 0, gross_total: 0, shop_split: 0 },
    }
  );
}

/** Phase 4 — get_reconciliation_artist_totals RPC */
export async function fetchArtistReport({ startDate, endDate, locationId, artistId }) {
  const { data, error } = await supabase.rpc("get_reconciliation_artist_totals", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_location_id: normalizeLocationId(locationId),
    p_artist_id: artistId && artistId !== "all" ? artistId : null,
  });
  if (error) throw error;
  return data?.rows ?? [];
}

/** Phase 5 — get_reconciliation_location_totals RPC */
export async function fetchLocationReport({ startDate, endDate, locationId }) {
  const { data, error } = await supabase.rpc("get_reconciliation_location_totals", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_location_id: normalizeLocationId(locationId),
  });
  if (error) throw error;
  return data?.rows ?? [];
}

/** Phase 6 — get_stripe_payments_report RPC */
export async function fetchStripeDepositsReport({ startDate, endDate, locationId }) {
  const { data, error } = await supabase.rpc("get_stripe_payments_report", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_location_id: normalizeLocationId(locationId),
  });
  if (error) throw error;
  return (
    data ?? {
      rows: [],
      by_purpose: [],
      summary: {},
    }
  );
}

/** Payment-centric reconciliation report — get_payments_report RPC */
export async function fetchPaymentsReport({
  startDate,
  endDate,
  locationId,
  tenderType,
  limit = 50,
  offset = 0,
}) {
  const { data, error } = await supabase.rpc("get_payments_report", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_location_id: normalizeLocationId(locationId),
    p_tender_type: tenderType && tenderType !== "all" ? tenderType : null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (
    data ?? {
      rows: [],
      by_tender: [],
      summary: {},
      total_count: 0,
      limit,
      offset,
    }
  );
}

/** Phase 7 — get_sales_summary_report RPC */
export async function fetchSalesReport({
  startDate,
  endDate,
  locationId,
  artistId,
  limit = 50,
  offset = 0,
}) {
  const { data, error } = await supabase.rpc("get_sales_summary_report", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_location_id: normalizeLocationId(locationId),
    p_artist_id: artistId && artistId !== "all" ? artistId : null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (
    data ?? {
      rows: [],
      total_count: 0,
      limit,
      offset,
    }
  );
}

/** Phase 8 — overlapping availabilities for Counter / Scrub hours */
export async function fetchAvailabilitiesForReport({ startDate, endDate, locationId }) {
  const { data, error } = await supabase.rpc("get_availabilities_for_report", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_location_id: normalizeLocationId(locationId),
  });
  if (error) throw error;
  return data?.rows ?? [];
}

/** Phase 9 — closed reconciliation detail snapshot */
export async function fetchReconciliationDetailSnapshot(reconciliationId) {
  const { data, error } = await supabase.rpc("get_reconciliation_detail_snapshot", {
    p_reconciliation_id: reconciliationId,
  });
  if (error) throw error;
  return data;
}

/**
 * Studio overrides for report tender grouping (reporting_tender_groups).
 * Empty for studios on the default Plastic / Cash / Other grouping.
 */
export async function fetchTenderGroupConfig({ studioId }) {
  const { data, error } = await supabase
    .from("reporting_tender_groups")
    .select("*")
    .eq("studio_id", studioId);
  if (error) throw error;
  return data || [];
}

/** Filtered payments for an open reconciliation day */
export async function fetchPaymentsForReconciliationDay({ studioId, businessDate, locationId }) {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("studio_id", studioId)
    .eq("business_date", businessDate)
    .eq("location_id", locationId)
    .eq("status", "paid");
  if (error) throw error;
  return data || [];
}

/** Sales + line items linked to payments on an open reconciliation day */
export async function fetchSalesForReconciliationDay({ studioId, saleIds }) {
  if (!saleIds.length) return { sales: [], lineItems: [] };
  const { data: sales, error: salesErr } = await supabase
    .from("sales")
    .select("*")
    .eq("studio_id", studioId)
    .in("id", saleIds);
  if (salesErr) throw salesErr;
  const { data: lineItems, error: linesErr } = await supabase
    .from("sale_line_items")
    .select("*")
    .eq("studio_id", studioId)
    .in("sale_id", saleIds);
  if (linesErr) throw linesErr;
  return { sales: sales || [], lineItems: lineItems || [] };
}
