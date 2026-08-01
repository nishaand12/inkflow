import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Stable empty result.
 *
 * `useQuery({...}).data` is undefined while a query is disabled or loading. A
 * `= []` default would mint a fresh array on every render, and callers put
 * this value in effect dependency arrays — AppointmentDialog resets its form
 * from one, so an unstable reference re-ran the reset on every render and
 * wiped the user's selection as they made it.
 */
const EMPTY_CUSTOMERS = [];

/**
 * Customers referenced by the rows a page has already loaded.
 *
 * Pages only need customer records to render names on appointments they are
 * showing. Fetching the studio's whole customer table for that is silently
 * truncated at the API row cap once a studio grows, so names resolve to
 * "Unknown" for anyone past the cap.
 */
export function useCustomersByIds(studioId, ids) {
  // Keyed on the ids themselves rather than the array's identity: callers
  // commonly build a fresh literal each render (`[appointment.customer_id]`),
  // which would otherwise recompute and re-key the query every time.
  const idKey = useMemo(
    () => [...new Set((ids || []).filter(Boolean))].sort().join(","),
    [ids]
  );

  const uniqueIds = useMemo(
    () => (idKey ? idKey.split(",") : EMPTY_CUSTOMERS),
    [idKey]
  );

  const { data } = useQuery({
    queryKey: ["customers", studioId, idKey],
    queryFn: () =>
      base44.entities.Customer.filter({ studio_id: studioId, id: uniqueIds }),
    enabled: !!studioId && uniqueIds.length > 0,
  });

  return data ?? EMPTY_CUSTOMERS;
}
