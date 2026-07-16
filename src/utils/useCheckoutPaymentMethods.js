import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import {
  CHECKOUT_PAYMENT_METHOD_OPTIONS,
  CHECKOUT_PAYMENT_METHOD_VALUES,
} from "@/utils/checkoutPaymentMethods";

/**
 * The studio's checkout payment methods: the built-in set plus any custom
 * methods configured on Categories → Payment Methods. Custom methods are stored
 * as reporting_tender_groups rows whose tender_type is not a built-in; they are
 * appended after the built-ins, ordered by display_order.
 *
 * Falls back to the built-in list while loading or when studioId is absent, so
 * callers always have a usable list synchronously.
 *
 * @param {string|undefined} studioId
 * @returns {{ options: {value: string, label: string}[], values: string[], customMethods: object[] }}
 */
export function useCheckoutPaymentMethods(studioId) {
  const { data: configRows = [] } = useQuery({
    queryKey: ["tenderGroupConfig", studioId],
    queryFn: () => base44.entities.ReportingTenderGroup.filter({ studio_id: studioId }),
    enabled: !!studioId,
  });

  return useMemo(() => {
    const customMethods = configRows
      .filter((r) => r.tender_type && !CHECKOUT_PAYMENT_METHOD_VALUES.includes(r.tender_type))
      .sort(
        (a, b) =>
          (a.display_order ?? 100) - (b.display_order ?? 100) ||
          String(a.tender_type).localeCompare(String(b.tender_type))
      );
    const options = [
      ...CHECKOUT_PAYMENT_METHOD_OPTIONS,
      ...customMethods.map((r) => ({ value: r.tender_type, label: r.tender_type })),
    ];
    return {
      options,
      values: options.map((o) => o.value),
      customMethods,
    };
  }, [configRows]);
}
