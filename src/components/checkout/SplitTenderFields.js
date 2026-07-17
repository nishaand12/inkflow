import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MAX_SPLIT_TENDERS,
  createTenderRow,
  roundMoney,
  sumTenderAmounts,
  sumTenderTips,
} from "@/utils/splitTender";

/**
 * Method | Amount | Tip rows for checkout. Second row is optional (max 2).
 * Amounts are balance portions (before tip); tip is per tender.
 */
export default function SplitTenderFields({
  rows,
  onChange,
  paymentMethodOptions = [],
  balanceDue = 0,
  disabled = false,
}) {
  const balance = roundMoney(balanceDue);
  const amountSum = sumTenderAmounts(rows);
  const tipSum = sumTenderTips(rows);
  const remaining = roundMoney(balance - amountSum);

  const updateRow = (id, field, value) => {
    onChange((rows || []).map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const addRow = () => {
    if ((rows || []).length >= MAX_SPLIT_TENDERS || disabled) return;
    const nextAmount = remaining > 0 ? String(remaining) : "";
    // When adding a second row, leave the first amount as-is; put remainder on the new row.
    onChange([...(rows || []), createTenderRow({ amount: nextAmount })]);
  };

  const removeRow = (id) => {
    if ((rows || []).length <= 1 || disabled) return;
    const next = (rows || []).filter((r) => r.id !== id);
    // Single remaining row: fill amount to full balance due.
    if (next.length === 1) {
      onChange([{ ...next[0], amount: balance > 0 ? String(balance) : "" }]);
    } else {
      onChange(next);
    }
  };

  const usedMethods = new Set((rows || []).map((r) => r.method).filter(Boolean));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Payment</Label>
        {(rows || []).length < MAX_SPLIT_TENDERS && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-indigo-700"
            disabled={disabled}
            onClick={addRow}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add payment method
          </Button>
        )}
      </div>

      <div className="rounded-md border border-gray-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium text-gray-600">Method</th>
              <th className="px-2 py-1.5 text-right font-medium text-gray-600 w-24">Amount</th>
              <th className="px-2 py-1.5 text-right font-medium text-gray-600 w-20">Tip</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(rows || []).map((row) => {
              const optionsForRow = paymentMethodOptions.filter(
                ({ value }) => value === row.method || !usedMethods.has(value)
              );
              return (
                <tr key={row.id}>
                  <td className="px-2 py-1.5">
                    <Select
                      value={row.method || undefined}
                      onValueChange={(v) => updateRow(row.id, "method", v)}
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Method" />
                      </SelectTrigger>
                      <SelectContent>
                        {optionsForRow.map(({ value, label }) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.amount}
                      disabled={disabled}
                      onChange={(e) => updateRow(row.id, "amount", e.target.value)}
                      placeholder="0.00"
                      className="h-8 text-xs text-right"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.tip}
                      disabled={disabled}
                      onChange={(e) => updateRow(row.id, "tip", e.target.value)}
                      placeholder="0"
                      className="h-8 text-xs text-right"
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    {(rows || []).length > 1 && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => removeRow(row.id)}
                        className="text-gray-400 hover:text-red-500 disabled:opacity-40"
                        aria-label="Remove payment method"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 text-[10px] text-gray-500">
        <span>
          Balance due: <span className="tabular-nums font-medium text-gray-700">${balance.toFixed(2)}</span>
          {remaining !== 0 && (
            <span className={remaining > 0 ? " text-amber-700" : " text-red-600"}>
              {" "}· remaining ${remaining.toFixed(2)}
            </span>
          )}
        </span>
        {tipSum > 0 && (
          <span className="text-green-700">
            Tips: <span className="tabular-nums font-medium">${tipSum.toFixed(2)}</span>
          </span>
        )}
      </div>
      <p className="text-[10px] text-gray-500 leading-snug">
        Amount is the balance portion (after deposit). Tip is optional per method and owed 100% to the artist.
        A second method is optional.
      </p>
    </div>
  );
}
