import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Customers referenced by the rows a page has already loaded.
 *
 * Pages only need customer records to render names on appointments they are
 * showing. Fetching the studio's whole customer table for that is silently
 * truncated at the API row cap once a studio grows, so names resolve to
 * "Unknown" for anyone past the cap.
 */
export function useCustomersByIds(studioId, ids) {
  const uniqueIds = useMemo(() => {
    const set = new Set((ids || []).filter(Boolean));
    return [...set].sort();
  }, [ids]);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers", studioId, uniqueIds],
    queryFn: () =>
      base44.entities.Customer.filter({ studio_id: studioId, id: uniqueIds }),
    enabled: !!studioId && uniqueIds.length > 0,
  });

  return customers;
}
