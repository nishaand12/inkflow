import React, { useState, useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Wallet, Lock, Calendar, CreditCard, Tags, Globe } from "lucide-react";
import { normalizeUserRole } from "@/utils/roles";
import {
  CATEGORY_ROLE_REPORTING,
  filterCategoriesByRole,
  getCategoryPathLabel,
} from "@/utils/reportingCategories";

function money(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

/**
 * Read-only breakdown for a single day's reconciliation, sourced from the unified
 * accounting model (sales / sale_line_items / payments / artist_ledger_entries).
 * The cash view (payment method) is keyed on payments.business_date so it always
 * ties out to the reconciliation totals; the revenue views (category / artist /
 * per-sale) cover the sales whose money landed on that business date.
 */
export default function ReconciliationDetail() {
  const { reconciliationId } = useParams();
  const [user, setUser] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setUser(await base44.auth.me());
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const studioId = user?.studio_id;

  const { data: reconciliation, isLoading: loadingRecon } = useQuery({
    queryKey: ["reconciliationDetail", reconciliationId],
    queryFn: async () => {
      const rows = await base44.entities.DailyReconciliation.filter({ id: reconciliationId });
      return rows[0] || null;
    },
    enabled: !!reconciliationId,
  });

  const businessDate = reconciliation?.business_date;
  const locationId = reconciliation?.location_id;

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", studioId],
    queryFn: () => base44.entities.Location.filter({ studio_id: studioId }),
    enabled: !!studioId,
  });

  const { data: artists = [] } = useQuery({
    queryKey: ["artists", studioId],
    queryFn: () => base44.entities.Artist.filter({ studio_id: studioId }),
    enabled: !!studioId,
  });

  const { data: reportingCategories = [] } = useQuery({
    queryKey: ["reportingCategories", studioId],
    queryFn: () => base44.entities.ReportingCategory.filter({ studio_id: studioId }),
    enabled: !!studioId,
  });

  const { data: dayPayments = [], isLoading: loadingPayments } = useQuery({
    queryKey: ["reconDetailPayments", studioId, businessDate, locationId],
    queryFn: async () => {
      const all = await base44.entities.Payment.filter({ studio_id: studioId });
      return all.filter(
        (p) =>
          p.business_date === businessDate &&
          p.location_id === locationId &&
          p.status === "paid"
      );
    },
    enabled: !!studioId && !!businessDate && !!locationId,
  });

  const saleIds = useMemo(
    () => [...new Set(dayPayments.map((p) => p.sale_id).filter(Boolean))],
    [dayPayments]
  );
  const saleIdsKey = useMemo(() => [...saleIds].sort().join(","), [saleIds]);

  const { data: sales = [], isLoading: loadingSales } = useQuery({
    queryKey: ["reconDetailSales", studioId, saleIdsKey],
    queryFn: async () => {
      const all = await base44.entities.Sale.filter({ studio_id: studioId });
      const idSet = new Set(saleIds);
      return all.filter((s) => idSet.has(s.id));
    },
    enabled: !!studioId && saleIds.length > 0,
  });

  const { data: lineItems = [], isLoading: loadingLines } = useQuery({
    queryKey: ["reconDetailLineItems", studioId, saleIdsKey],
    queryFn: async () => {
      const all = await base44.entities.SaleLineItem.filter({ studio_id: studioId });
      const idSet = new Set(saleIds);
      return all.filter((li) => idSet.has(li.sale_id));
    },
    enabled: !!studioId && saleIds.length > 0,
  });

  const getUserRole = () =>
    user ? normalizeUserRole(user.user_role || (user.role === "admin" ? "Admin" : "Front_Desk")) : null;
  const isAdmin = getUserRole() === "Admin" || getUserRole() === "Owner";

  const locationName = locations.find((l) => l.id === locationId)?.name || "—";
  const artistById = useMemo(() => Object.fromEntries(artists.map((a) => [a.id, a])), [artists]);

  const reportingOnly = useMemo(
    () => filterCategoriesByRole(reportingCategories, CATEGORY_ROLE_REPORTING),
    [reportingCategories]
  );

  const lineItemsBySale = useMemo(() => {
    const m = {};
    for (const li of lineItems) (m[li.sale_id] ||= []).push(li);
    return m;
  }, [lineItems]);

  // --- Cash: totals by tender, split by channel (ties to reconciliation) ---
  const tenderBreakdown = useMemo(() => {
    const inPerson = {};
    const online = {};
    for (const p of dayPayments) {
      const bucket = p.channel === "online" ? online : inPerson;
      const key = p.tender_type || "Unspecified";
      bucket[key] = (bucket[key] || 0) + (Number(p.amount) || 0);
    }
    const toRows = (obj) =>
      Object.entries(obj)
        .map(([tender_type, amount]) => ({ tender_type, amount }))
        .sort((a, b) => b.amount - a.amount);
    return { inPerson: toRows(inPerson), online: toRows(online) };
  }, [dayPayments]);

  const futureDepositTotal = useMemo(
    () =>
      dayPayments
        .filter((p) => p.purpose === "deposit" && !p.sale_id)
        .reduce((s, p) => s + (Number(p.amount) || 0), 0),
    [dayPayments]
  );

  // --- Revenue: sales whose cash landed on this business date ---
  const revenueTotals = useMemo(() => {
    return sales.reduce(
      (acc, s) => {
        acc.subtotal += Number(s.subtotal) || 0;
        acc.tax += Number(s.tax_total) || 0;
        acc.discount += Number(s.discount_total) || 0;
        acc.tip += Number(s.tip_total) || 0;
        acc.total += Number(s.total) || 0;
        return acc;
      },
      { subtotal: 0, tax: 0, discount: 0, tip: 0, total: 0 }
    );
  }, [sales]);

  const categoryFor = (li) => {
    if (li.reporting_category_id) {
      return {
        key: `id:${li.reporting_category_id}`,
        label:
          getCategoryPathLabel(reportingOnly, li.reporting_category_id) ||
          li.reporting_category_name ||
          "Uncategorized",
      };
    }
    const label = li.reporting_category_name || "Uncategorized";
    return { key: `name:${label}`, label };
  };

  const totalsByCategory = useMemo(() => {
    const map = {};
    for (const li of lineItems) {
      const { key, label } = categoryFor(li);
      if (!map[key]) map[key] = { label, gross: 0, count: 0 };
      map[key].gross += Number(li.line_total) || 0;
      map[key].count += Number(li.quantity) || 1;
    }
    return Object.values(map).sort((a, b) => b.gross - a.gross);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineItems, reportingOnly]);

  const perSaleRows = useMemo(() => {
    return sales
      .map((s) => {
        const lis = lineItemsBySale[s.id] || [];
        const service = lis
          .filter((li) => li.line_type === "service")
          .reduce((sum, li) => sum + (Number(li.net_amount) || 0), 0);
        const product = lis
          .filter((li) => li.line_type !== "service")
          .reduce((sum, li) => sum + (Number(li.net_amount) || 0), 0);
        const settlementShare = Number(s.artist_share) || 0;
        const tips = Number(s.tip_total) || 0;
        const artistOwed = settlementShare + tips;
        const shopRevenue = service + product - settlementShare;
        return {
          id: s.id,
          sale_date: s.sale_date,
          artist_id: s.artist_id,
          service,
          product,
          tips,
          artistOwed,
          shopRevenue,
        };
      })
      .sort((a, b) => String(a.sale_date).localeCompare(String(b.sale_date)));
  }, [sales, lineItemsBySale]);

  const byArtist = useMemo(() => {
    const map = {};
    for (const row of perSaleRows) {
      const aid = row.artist_id || "unknown";
      if (!map[aid]) {
        map[aid] = { artist_id: aid, service: 0, product: 0, tips: 0, artistOwed: 0, shopRevenue: 0, count: 0 };
      }
      map[aid].service += row.service;
      map[aid].product += row.product;
      map[aid].tips += row.tips;
      map[aid].artistOwed += row.artistOwed;
      map[aid].shopRevenue += row.shopRevenue;
      map[aid].count += 1;
    }
    return Object.values(map).sort((a, b) => b.shopRevenue - a.shopRevenue);
  }, [perSaleRows]);

  const loadingBreakdowns = loadingPayments || loadingSales || loadingLines;

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="p-12 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">Only Owners and Admins can view reconciliation details.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start gap-3">
          <Button variant="outline" size="icon" asChild className="shrink-0 mt-1">
            <Link to="/settlements" aria-label="Back to reconciliation">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2 flex-wrap">
              <Wallet className="w-8 h-8 text-indigo-600" />
              Reconciliation detail
            </h1>
            <p className="text-gray-500 mt-1">
              Cash and revenue breakdown for this business day. Payment-method totals tie directly to
              the day&apos;s reconciliation; category, artist, and per-sale views cover the sales whose
              money landed on this date.
            </p>
          </div>
        </div>

        {loadingRecon || !user ? (
          <Card><CardContent className="py-16 text-center text-gray-500">Loading…</CardContent></Card>
        ) : !reconciliation ? (
          <Card><CardContent className="py-16 text-center text-gray-500">Reconciliation not found.</CardContent></Card>
        ) : (
          <>
            <Card className="bg-white border-none shadow-lg">
              <CardHeader>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <CardTitle className="text-xl flex items-center gap-2 flex-wrap">
                    <Calendar className="w-5 h-5 text-gray-500" />
                    {businessDate}
                    <span className="text-gray-400 font-normal">·</span>
                    <span className="font-normal text-gray-700">{locationName}</span>
                  </CardTitle>
                  <Badge className={reconciliation.status === "closed" ? "bg-green-100 text-green-800 border-green-200" : "bg-amber-100 text-amber-800"}>
                    <Lock className="w-3 h-3 mr-1 inline" />
                    {reconciliation.status === "closed" ? "Closed" : "Open"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Merchandise</p>
                    <p className="text-xl font-bold text-gray-900">{money(revenueTotals.subtotal + revenueTotals.tax)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Tax (incl.)</p>
                    <p className="text-xl font-bold text-gray-900">{money(revenueTotals.tax)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-4 bg-red-50/60">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Discounts</p>
                    <p className="text-xl font-bold text-red-700">{money(revenueTotals.discount)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-4 bg-green-50/80 border-green-100">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Tips</p>
                    <p className="text-xl font-bold text-green-800">{money(revenueTotals.tip)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-4 bg-indigo-50/80 border-indigo-100">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">In-person (system)</p>
                    <p className="text-lg font-semibold text-indigo-900">{money(reconciliation.in_person_total)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">POS reported</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {reconciliation.pos_reported_total != null ? money(reconciliation.pos_reported_total) : "—"}
                    </p>
                  </div>
                  <div className={`rounded-lg border p-4 ${Math.abs(Number(reconciliation.variance) || 0) < 0.005 ? "bg-green-50/80 border-green-100" : "bg-red-50/70 border-red-100"}`}>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Variance</p>
                    <p className={`text-lg font-semibold ${Math.abs(Number(reconciliation.variance) || 0) < 0.005 ? "text-green-800" : "text-red-700"}`}>
                      {reconciliation.variance != null ? money(reconciliation.variance) : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Online (Stripe)</p>
                    <p className="text-lg font-semibold text-gray-900">{money(reconciliation.online_total)}</p>
                  </div>
                </div>
                {futureDepositTotal > 0 && (
                  <p className="text-xs text-gray-500 mt-3">
                    Includes {money(futureDepositTotal)} of deposits taken for future appointments (counted in the
                    day&apos;s cash but not yet recognized as revenue above).
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-white border-none shadow-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-gray-500" />
                    Totals by payment method
                  </CardTitle>
                  <p className="text-sm text-gray-500 font-normal">In-person tenders reconcile to the POS batch.</p>
                </CardHeader>
                <CardContent>
                  {loadingBreakdowns ? (
                    <p className="text-gray-500">Loading breakdown…</p>
                  ) : tenderBreakdown.inPerson.length === 0 ? (
                    <p className="text-gray-500">No in-person payments.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tender</TableHead>
                          <TableHead className="text-right">Collected</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tenderBreakdown.inPerson.map((row) => (
                          <TableRow key={row.tender_type}>
                            <TableCell className="font-medium">{row.tender_type}</TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{money(row.amount)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-gray-50 font-semibold">
                          <TableCell>In-person total</TableCell>
                          <TableCell className="text-right tabular-nums">{money(reconciliation.in_person_total)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  )}
                  {tenderBreakdown.online.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                        <Globe className="w-3.5 h-3.5" /> Online (reconciled against Stripe)
                      </p>
                      <Table>
                        <TableBody>
                          {tenderBreakdown.online.map((row) => (
                            <TableRow key={row.tender_type}>
                              <TableCell className="font-medium">{row.tender_type}</TableCell>
                              <TableCell className="text-right tabular-nums">{money(row.amount)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-white border-none shadow-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Tags className="w-5 h-5 text-gray-500" />
                    Totals by reporting category
                  </CardTitle>
                  <p className="text-sm text-gray-500 font-normal">From checkout line items (tax-inclusive totals).</p>
                </CardHeader>
                <CardContent>
                  {loadingBreakdowns ? (
                    <p className="text-gray-500">Loading breakdown…</p>
                  ) : totalsByCategory.length === 0 ? (
                    <p className="text-gray-500">No reporting category totals.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Reporting category</TableHead>
                          <TableHead className="text-right">Items</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {totalsByCategory.map((row) => (
                          <TableRow key={row.label}>
                            <TableCell className="font-medium">{row.label}</TableCell>
                            <TableCell className="text-right">{row.count}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(row.gross)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="bg-white border-none shadow-lg">
              <CardHeader>
                <CardTitle>Totals by artist</CardTitle>
                <p className="text-sm text-gray-500 font-normal">
                  Product sales are 100% shop revenue; tips are owed 100% to the artist.
                </p>
              </CardHeader>
              <CardContent>
                {loadingBreakdowns ? (
                  <p className="text-gray-500">Loading…</p>
                ) : byArtist.length === 0 ? (
                  <p className="text-gray-500">No sales for this day.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Artist</TableHead>
                          <TableHead className="text-right">Sales</TableHead>
                          <TableHead className="text-right">Service</TableHead>
                          <TableHead className="text-right">Products</TableHead>
                          <TableHead className="text-right">Tips</TableHead>
                          <TableHead className="text-right">Artist owed</TableHead>
                          <TableHead className="text-right">Shop revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {byArtist.map((row) => (
                          <TableRow key={row.artist_id}>
                            <TableCell className="font-medium">
                              {artistById[row.artist_id]?.full_name || row.artist_id || "Unknown"}
                            </TableCell>
                            <TableCell className="text-right">{row.count}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(row.service)}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(row.product)}</TableCell>
                            <TableCell className="text-right tabular-nums text-green-800">{money(row.tips)}</TableCell>
                            <TableCell className="text-right tabular-nums text-green-800">{money(row.artistOwed)}</TableCell>
                            <TableCell className="text-right tabular-nums text-indigo-800">{money(row.shopRevenue)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-white border-none shadow-lg">
              <CardHeader>
                <CardTitle>Per-sale lines</CardTitle>
                <p className="text-sm text-gray-500 font-normal">Each sale whose payment landed on this business day.</p>
              </CardHeader>
              <CardContent>
                {loadingBreakdowns ? (
                  <p className="text-gray-500">Loading…</p>
                ) : perSaleRows.length === 0 ? (
                  <p className="text-gray-500">No sales.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Sale date</TableHead>
                          <TableHead>Artist</TableHead>
                          <TableHead className="text-right">Service</TableHead>
                          <TableHead className="text-right">Products</TableHead>
                          <TableHead className="text-right">Tips</TableHead>
                          <TableHead className="text-right">Artist owed</TableHead>
                          <TableHead className="text-right">Shop revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {perSaleRows.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="font-medium text-gray-900">{row.sale_date}</TableCell>
                            <TableCell>{artistById[row.artist_id]?.full_name || row.artist_id || "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(row.service)}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(row.product)}</TableCell>
                            <TableCell className="text-right tabular-nums text-green-800">{money(row.tips)}</TableCell>
                            <TableCell className="text-right tabular-nums text-green-800">{money(row.artistOwed)}</TableCell>
                            <TableCell className="text-right tabular-nums text-indigo-800">{money(row.shopRevenue)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
