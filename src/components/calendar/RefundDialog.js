import React, { useMemo, useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Undo2 } from "lucide-react";

export default function RefundDialog({ open, onOpenChange, appointment, studio }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [notes, setNotes] = useState("");

  const saleTotal = useMemo(() => {
    const c = parseFloat(appointment?.charge_amount) || 0;
    const t = parseFloat(appointment?.tax_amount) || 0;
    return c + t;
  }, [appointment]);

  const { data: refunds = [] } = useQuery({
    queryKey: ["appointmentRefunds", appointment?.id],
    queryFn: async () => {
      if (!appointment?.id) return [];
      return base44.entities.AppointmentRefund.filter({
        appointment_id: appointment.id,
      });
    },
    enabled: open && !!appointment?.id,
  });

  const refundedSoFar = refunds.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const maxRefund = Math.max(0, round2(saleTotal - refundedSoFar));

  const refundMutation = useMutation({
    mutationFn: async (payload) => base44.entities.AppointmentRefund.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointmentRefunds"] });
      if (appointment?.id) {
        queryClient.invalidateQueries({ queryKey: ["appointmentRefunds", appointment.id] });
      }
      onOpenChange(false);
      setAmount("");
      setNotes("");
      setRefundMethod("cash");
    },
  });

  useEffect(() => {
    if (!open || !appointment) return;
    setNotes("");
    setRefundMethod("cash");
  }, [open, appointment?.id]);

  useEffect(() => {
    if (!open || !appointment) return;
    setAmount(maxRefund > 0 ? String(maxRefund) : "");
  }, [open, appointment?.id, maxRefund]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    if (amt > maxRefund + 1e-6) return;

    refundMutation.mutate({
      studio_id: studio.id,
      appointment_id: appointment.id,
      amount: round2(amt),
      refund_method: refundMethod,
      notes: notes.trim() || null,
    });
  };

  if (!appointment || !studio) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="w-5 h-5 text-amber-600" />
            Record refund
          </DialogTitle>
          <DialogDescription>
            Linked to this appointment (sale total ${saleTotal.toFixed(2)}; already refunded $
            {refundedSoFar.toFixed(2)}). Does not adjust inventory — restock products manually if
            needed.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="refund_amount">Amount ($)</Label>
            <Input
              id="refund_amount"
              type="number"
              min="0.01"
              step="0.01"
              max={maxRefund}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            <p className="text-xs text-gray-500">Maximum ${maxRefund.toFixed(2)}</p>
          </div>
          <div className="space-y-1">
            <Label>Method</Label>
            <Select value={refundMethod} onValueChange={setRefundMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="card">Card reversal</SelectItem>
                <SelectItem value="store_credit">Store credit</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="refund_notes">Notes (optional)</Label>
            <Textarea
              id="refund_notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Reason, authorization #, etc."
              className="resize-none"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-amber-600 hover:bg-amber-700"
              disabled={
                refundMutation.isPending ||
                maxRefund <= 0 ||
                !parseFloat(amount) ||
                parseFloat(amount) > maxRefund
              }
            >
              {refundMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Save refund"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
