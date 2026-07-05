import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Loader2 } from "lucide-react";
import { supabase } from "@/utils/supabase";
import { normalizeUserRole } from "@/utils/roles";
import {
  CHECKOUT_PAYMENT_METHOD_OPTIONS,
  CHECKOUT_PAYMENT_METHOD_VALUES,
} from "@/utils/checkoutPaymentMethods";
import { buildCheckoutSummaryFromSale } from "@/utils/saleLines";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function formatSaleTime(createdAt) {
  if (!createdAt) return "—";
  try {
    return format(parseISO(createdAt), "h:mm a");
  } catch {
    return "—";
  }
}

export default function SaleDetailDialog({
  open,
  onOpenChange,
  sale,
  lineItems = [],
  payment,
  customer,
  location,
  artist,
  user,
  studioId,
  saleDate,
}) {
  const queryClient = useQueryClient();
  const [editingPaymentMethod, setEditingPaymentMethod] = useState(false);
  const [paymentMethodDraft, setPaymentMethodDraft] = useState("");
  const [paymentMethodError, setPaymentMethodError] = useState(null);
  const [localPayment, setLocalPayment] = useState(payment);

  useEffect(() => {
    setLocalPayment(payment);
  }, [payment]);

  const userRole = useMemo(() => {
    if (!user) return null;
    return normalizeUserRole(user.user_role || (user.role === "admin" ? "Admin" : "Front_Desk"));
  }, [user]);

  const isAdmin = userRole === "Admin" || userRole === "Owner";
  const canEditPayment = Boolean(sale) && (isAdmin || userRole === "Front_Desk");

  const summary = useMemo(() => {
    if (!sale) return null;
    return buildCheckoutSummaryFromSale(sale, lineItems, null);
  }, [sale, lineItems]);

  const currentPaymentMethod = localPayment?.tender_type || "";

  useEffect(() => {
    setEditingPaymentMethod(false);
    setPaymentMethodError(null);
  }, [sale?.id, open]);

  const updatePaymentMethodMutation = useMutation({
    mutationFn: async (newMethod) => {
      if (!sale?.id) throw new Error("No sale selected.");
      const { error } = await supabase
        .from("payments")
        .update({ tender_type: newMethod, channel: "in_person" })
        .eq("sale_id", sale.id)
        .eq("purpose", "retail")
        .eq("status", "paid");
      if (error) throw new Error(error.message || "Could not update the payment ledger.");
      return newMethod;
    },
    onSuccess: (newMethod) => {
      setLocalPayment((prev) => (prev ? { ...prev, tender_type: newMethod } : prev));
      queryClient.invalidateQueries({ queryKey: ["salePayments", studioId] });
      queryClient.invalidateQueries({ queryKey: ["sales", studioId, saleDate] });
      queryClient.invalidateQueries({ queryKey: ["reconciliations"] });
      queryClient.invalidateQueries({ queryKey: ["reconciliationTenders"] });
      setEditingPaymentMethod(false);
    },
    onError: (err) => {
      setPaymentMethodError(err?.message || "Failed to update payment method.");
    },
  });

  const renderPaymentField = () => {
    if (!canEditPayment) {
      return (
        <div>
          <span className="text-emerald-600">Payment:</span>
          <p className="font-medium text-emerald-900">{currentPaymentMethod || "N/A"}</p>
        </div>
      );
    }
    if (!editingPaymentMethod) {
      return (
        <div>
          <span className="text-emerald-600">Payment:</span>
          <div className="flex items-center gap-2">
            <p className="font-medium text-emerald-900">{currentPaymentMethod || "N/A"}</p>
            {localPayment && (
              <button
                type="button"
                onClick={() => {
                  setPaymentMethodError(null);
                  setPaymentMethodDraft(
                    CHECKOUT_PAYMENT_METHOD_VALUES.includes(currentPaymentMethod)
                      ? currentPaymentMethod
                      : ""
                  );
                  setEditingPaymentMethod(true);
                }}
                className="text-xs text-emerald-700 underline hover:text-emerald-900"
              >
                Edit
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="col-span-2">
        <span className="text-emerald-600">Payment:</span>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Select value={paymentMethodDraft} onValueChange={setPaymentMethodDraft}>
            <SelectTrigger className="h-8 text-sm bg-white w-36">
              <SelectValue placeholder="Method" />
            </SelectTrigger>
            <SelectContent>
              {CHECKOUT_PAYMENT_METHOD_OPTIONS.map(({ value, label }) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            className="h-8 bg-emerald-600 hover:bg-emerald-700"
            disabled={!paymentMethodDraft || updatePaymentMethodMutation.isPending}
            onClick={() => {
              setPaymentMethodError(null);
              updatePaymentMethodMutation.mutate(paymentMethodDraft);
            }}
          >
            {updatePaymentMethodMutation.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 text-emerald-800"
            disabled={updatePaymentMethodMutation.isPending}
            onClick={() => {
              setEditingPaymentMethod(false);
              setPaymentMethodError(null);
            }}
          >
            Cancel
          </Button>
        </div>
        {paymentMethodError && <p className="text-xs text-red-600 mt-1">{paymentMethodError}</p>}
        <p className="text-[10px] text-emerald-700 mt-1">
          Updates the payment ledger. Rebuild Daily Reconciliation to refresh tender totals.
        </p>
      </div>
    );
  };

  if (!sale) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sale details</DialogTitle>
          <DialogDescription>
            {formatSaleTime(sale.created_at)}
            {location?.name ? ` · ${location.name}` : ""}
            {customer?.name ? ` · ${customer.name}` : " · Walk-in"}
            {artist?.full_name ? ` · ${artist.full_name}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full" />
            <span className="font-semibold text-emerald-800">Completed sale</span>
          </div>

          {summary ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-emerald-600">
                    {summary.allTaxInclusive ? "Merchandise" : "Charge (net)"}:
                  </span>
                  <p className="font-medium text-emerald-900 tabular-nums">
                    ${summary.allTaxInclusive
                      ? summary.merchandiseTotal.toFixed(2)
                      : summary.netPreTax.toFixed(2)}
                  </p>
                </div>
                {summary.tax > 0 && (
                  <div>
                    <span className="text-emerald-600">
                      {summary.allTaxInclusive ? "Tax (incl.)" : "Tax"}:
                    </span>
                    <p className="font-medium text-emerald-900 tabular-nums">
                      ${summary.tax.toFixed(2)}
                    </p>
                  </div>
                )}
                <div>
                  <span className="text-emerald-600">Tip:</span>
                  <p className="font-medium text-emerald-900 tabular-nums">
                    ${summary.tip.toFixed(2)}
                  </p>
                </div>
                {renderPaymentField()}
              </div>

              <div className="mt-4 pt-4 border-t border-emerald-200">
                <p className="text-sm font-semibold text-emerald-800 mb-3">Line items</p>
                <div className="rounded-lg border border-emerald-200 bg-white/70 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-emerald-100/60">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-emerald-900">Item</th>
                        <th className="px-3 py-2 text-right font-medium text-emerald-900 w-12">Qty</th>
                        <th className="px-3 py-2 text-right font-medium text-emerald-900 w-16">Price</th>
                        <th className="px-3 py-2 text-right font-medium text-emerald-900 w-16">Disc</th>
                        <th className="px-3 py-2 text-right font-medium text-emerald-900 w-16">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-emerald-100">
                      {summary.lines.map((line) => {
                        const lineTotalVal = Number(line.line_total) || 0;
                        const discount = Number(line.discount_amount) || 0;
                        return (
                          <tr key={line.id}>
                            <td className="px-3 py-2">
                              <div className="font-medium text-emerald-950 text-xs">{line.description}</div>
                              {lineTotalVal < 0 && (
                                <span className="text-[10px] text-red-600 font-medium">Negative revenue</span>
                              )}
                              {line.reporting_category_name && (
                                <div className="text-[10px] text-emerald-600">{line.reporting_category_name}</div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-xs tabular-nums text-emerald-900">
                              {line.quantity}
                            </td>
                            <td className="px-3 py-2 text-right text-xs tabular-nums text-emerald-900">
                              ${(Number(line.unit_price) || 0).toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-right text-xs tabular-nums text-emerald-900">
                              {discount > 0 ? `-$${discount.toFixed(2)}` : "$0.00"}
                            </td>
                            <td className="px-3 py-2 text-right text-xs font-medium tabular-nums text-emerald-900">
                              ${lineTotalVal.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 rounded-lg bg-white/70 border border-emerald-200 p-3 space-y-1 text-sm">
                  <div className="flex justify-between text-emerald-800">
                    <span className="text-emerald-600">Subtotal (before discounts):</span>
                    <span className="tabular-nums">${summary.grossBeforeDiscounts.toFixed(2)}</span>
                  </div>
                  {summary.lineDiscountsTotal > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>Line discounts:</span>
                      <span className="tabular-nums">-${summary.lineDiscountsTotal.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-medium text-emerald-900">
                    <span className="text-emerald-600">
                      {summary.allTaxInclusive ? "Merchandise (tax included in prices)" : "Net (pre-tax)"}:
                    </span>
                    <span className="tabular-nums">
                      ${summary.allTaxInclusive
                        ? summary.merchandiseTotal.toFixed(2)
                        : summary.netPreTax.toFixed(2)}
                    </span>
                  </div>
                  {summary.tax > 0 && (
                    <div className="flex justify-between text-emerald-800">
                      <span className="text-emerald-600">
                        {summary.allTaxInclusive ? "Tax (included above)" : "Tax"}:
                      </span>
                      <span className="tabular-nums">${summary.tax.toFixed(2)}</span>
                    </div>
                  )}
                  {summary.tip > 0 && (
                    <div className="flex justify-between text-emerald-800">
                      <span className="text-emerald-600">Tip:</span>
                      <span className="tabular-nums">${summary.tip.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold border-t border-emerald-200 pt-1 mt-1 text-emerald-900">
                    <span>Total{summary.tip > 0 ? " (incl. tip)" : ""}:</span>
                    <span className="tabular-nums">${summary.grandTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-emerald-700 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading sale details…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
