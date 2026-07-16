import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/utils/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Wallet, Lock, Loader2, RefreshCw, FileText } from "lucide-react";
import { format } from "date-fns";
import { normalizeUserRole } from "@/utils/roles";
import { useCheckoutPaymentMethods } from "@/utils/useCheckoutPaymentMethods";

function money(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

export default function Settlements() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [filterLocation, setFilterLocation] = useState("");
  const [posInputs, setPosInputs] = useState({}); // tender_type -> string

  useEffect(() => {
    (async () => {
      try { setUser(await base44.auth.me()); } catch (e) { console.error(e); }
    })();
  }, []);

  const studioId = user?.studio_id;
  // In-person tender columns the POS batch reports (built-ins + custom methods;
  // Stripe is online, reconciled elsewhere).
  const { values: inPersonTenders } = useCheckoutPaymentMethods(studioId);

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", studioId],
    queryFn: () => base44.entities.Location.filter({ studio_id: studioId }),
    enabled: !!studioId,
  });

  useEffect(() => {
    if (locations.length && !filterLocation) setFilterLocation(locations[0].id);
  }, [locations, filterLocation]);

  const { data: reconciliations = [] } = useQuery({
    queryKey: ["reconciliations", studioId, selectedDate],
    queryFn: () => base44.entities.DailyReconciliation.filter({ studio_id: studioId, business_date: selectedDate }),
    enabled: !!studioId,
  });

  const reconciliation = useMemo(
    () => reconciliations.find((r) => r.location_id === filterLocation) || null,
    [reconciliations, filterLocation]
  );

  const { data: tenderRows = [] } = useQuery({
    queryKey: ["reconciliationTenders", reconciliation?.id],
    queryFn: () => base44.entities.ReconciliationTender.filter({ reconciliation_id: reconciliation.id }),
    enabled: !!reconciliation?.id,
  });

  const getUserRole = () =>
    user ? normalizeUserRole(user.user_role || (user.role === "admin" ? "Admin" : "Front_Desk")) : null;
  const isAdmin = getUserRole() === "Admin" || getUserRole() === "Owner";
  const isClosed = reconciliation?.status === "closed";

  // Merge DB tender rows with the standard in-person tender set for POS entry.
  const tenderView = useMemo(() => {
    const byType = {};
    for (const t of tenderRows) byType[t.tender_type] = t;
    const types = Array.from(new Set([...inPersonTenders, ...tenderRows.map((t) => t.tender_type)]));
    return types.map((type) => {
      const row = byType[type];
      const system = Number(row?.system_amount) || 0;
      const posRaw = posInputs[type];
      const pos = posRaw != null && posRaw !== ""
        ? Number(posRaw)
        : (row?.pos_amount != null ? Number(row.pos_amount) : null);
      return {
        tender_type: type,
        row,
        system_amount: system,
        pos_amount: pos,
        variance: pos != null ? system - pos : null,
      };
    });
  }, [tenderRows, posInputs, inPersonTenders]);

  const posReportedTotal = useMemo(
    () => tenderView.reduce((s, t) => s + (t.pos_amount != null ? t.pos_amount : 0), 0),
    [tenderView]
  );
  const overallVariance = reconciliation ? (Number(reconciliation.in_person_total) || 0) - posReportedTotal : 0;

  const buildMutation = useMutation({
    mutationFn: async () => {
      if (!filterLocation) throw new Error("Select a location.");
      const { error } = await supabase.rpc("compute_daily_reconciliation", {
        p_location_id: filterLocation,
        p_business_date: selectedDate,
      });
      if (error) throw new Error(error.message || "Could not build reconciliation.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reconciliations", studioId, selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["reconciliationTenders"] });
    },
  });

  const savePosMutation = useMutation({
    mutationFn: async ({ close }) => {
      if (!reconciliation) throw new Error("Build the reconciliation first.");
      for (const t of tenderView) {
        if (t.pos_amount == null && !t.row) continue;
        const variance = t.pos_amount != null ? t.system_amount - t.pos_amount : null;
        if (t.row) {
          await base44.entities.ReconciliationTender.update(t.row.id, {
            pos_amount: t.pos_amount,
            variance,
          });
        } else if (t.pos_amount != null) {
          await base44.entities.ReconciliationTender.create({
            studio_id: studioId,
            reconciliation_id: reconciliation.id,
            tender_type: t.tender_type,
            system_amount: 0,
            pos_amount: t.pos_amount,
            variance,
          });
        }
      }
      // Persist POS totals first; closing is a separate RPC so it can also post
      // the day's consolidated artist earnings (Service fees + Tips) atomically.
      await base44.entities.DailyReconciliation.update(reconciliation.id, {
        pos_reported_total: posReportedTotal,
        variance: overallVariance,
      });
      if (close) {
        const { error } = await supabase.rpc("close_daily_reconciliation", {
          p_reconciliation_id: reconciliation.id,
        });
        if (error) throw new Error(error.message || "Could not close the day.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reconciliations", studioId, selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["reconciliationTenders"] });
      queryClient.invalidateQueries({ queryKey: ["artistLedgerEntries"] });
    },
  });

  useEffect(() => { setPosInputs({}); }, [reconciliation?.id]);

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">Only Owners and Admins can access reconciliation.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Daily Reconciliation</h1>
          <p className="text-gray-500 mt-1">Match the day's in-shop payments to the POS batch, by tender.</p>
        </div>

        <Card className="bg-white border border-indigo-100 bg-indigo-50/40 shadow-sm">
          <CardContent className="p-4 text-sm text-gray-700">
            <p className="font-medium text-gray-900 mb-1">How this reconciles to the POS</p>
            <p>
              The system total is every <strong>in-person</strong> payment recorded on this business date — sale balances,
              retail sales, <strong>and deposits taken in-store for future appointments</strong> — broken down by card type.
              Enter the matching totals from your POS batch printout to see per-tender variance. Stripe (online) payments are
              shown separately and reconciled against Stripe payouts, not the POS.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border-none shadow-md">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="space-y-2">
                <Label>Business Date</Label>
                <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={filterLocation} onValueChange={setFilterLocation}>
                  <SelectTrigger><SelectValue placeholder="Location" /></SelectTrigger>
                  <SelectContent>
                    {locations.map((loc) => (<SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => buildMutation.mutate()}
                disabled={buildMutation.isPending || isClosed || !filterLocation}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {buildMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Building...</>
                ) : (
                  <><RefreshCw className="w-4 h-4 mr-2" /> {reconciliation ? "Refresh from payments" : "Build reconciliation"}</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {reconciliation && (
          <Card className="bg-white border-none shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Tender Reconciliation</CardTitle>
              <Badge className={isClosed ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}>
                {isClosed ? "Closed" : "Open"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Tender</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">System (Inkflow)</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">POS batch</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {tenderView.map((t) => (
                      <tr key={t.tender_type} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900 font-medium">{t.tender_type}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">{money(t.system_amount)}</td>
                        <td className="px-4 py-3 text-right">
                          <Input
                            type="number"
                            step="0.01"
                            disabled={isClosed}
                            className="h-8 w-28 text-right ml-auto"
                            value={posInputs[t.tender_type] ?? (t.row?.pos_amount != null ? String(t.row.pos_amount) : "")}
                            onChange={(e) => setPosInputs((prev) => ({ ...prev, [t.tender_type]: e.target.value }))}
                            placeholder="0.00"
                          />
                        </td>
                        <td className={`px-4 py-3 text-sm text-right tabular-nums font-medium ${
                          t.variance == null ? "text-gray-400" : Math.abs(t.variance) < 0.005 ? "text-green-700" : "text-red-600"
                        }`}>
                          {t.variance == null ? "—" : money(t.variance)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 font-semibold">
                      <td className="px-4 py-3 text-sm text-gray-900">In-person total</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">{money(reconciliation.in_person_total)}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">{money(posReportedTotal)}</td>
                      <td className={`px-4 py-3 text-sm text-right tabular-nums ${
                        Math.abs(overallVariance) < 0.005 ? "text-green-700" : "text-red-600"
                      }`}>{money(overallVariance)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div className="rounded-lg bg-indigo-50 p-3">
                  <p className="text-xs text-gray-500">Online (Stripe) — reconciled separately</p>
                  <p className="text-lg font-bold text-indigo-700">{money(reconciliation.online_total)}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">In-person refunds (incl. above)</p>
                  <p className="text-lg font-bold text-gray-900">{money(reconciliation.refunds_in_person)}</p>
                </div>
                <div className="flex items-end justify-end gap-2">
                  {isClosed ? (
                    <Button variant="outline" asChild>
                      <Link to={`/reconciliation/${reconciliation.id}`}>
                        <FileText className="w-4 h-4 mr-2" /> View detail
                      </Link>
                    </Button>
                  ) : (
                    <>
                      <Button variant="outline" disabled={savePosMutation.isPending} onClick={() => savePosMutation.mutate({ close: false })}>
                        Save
                      </Button>
                      <Button className="bg-green-600 hover:bg-green-700" disabled={savePosMutation.isPending} onClick={() => savePosMutation.mutate({ close: true })}>
                        <Lock className="w-4 h-4 mr-2" /> Close day
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {!reconciliation && (
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="text-center py-12">
              <Wallet className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No reconciliation built for this date and location yet.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
