import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, TrendingUp, DollarSign, BarChart3, Users, Clock } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { normalizeUserRole } from "@/utils/roles";
import { getArtistTypeLabel, isSupportStaffArtistType } from "@/utils/artistTypes";
import { sumExplicitAvailableHoursInRange } from "@/utils/explicitAvailabilityHours";
import {
  resolveRevenueSplitRule,
  isAppointmentTypeSplitEnabled,
  computeAppointmentShares,
} from "@/utils/revenueSplits";
import {
  CATEGORY_ROLE_REPORTING,
  filterCategoriesByRole,
  findCategoryById,
  getRootAncestor,
} from "@/utils/reportingCategories";

export default function Reports() {
  const [user, setUser] = useState(null);
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterArtist, setFilterArtist] = useState("all");
  const [categoryRollupMode, setCategoryRollupMode] = useState("leaf");

  useEffect(() => {
    (async () => {
      try { setUser(await base44.auth.me()); } catch (e) { console.error(e); }
    })();
  }, []);

  const qOpts = (key, fn) => ({
    queryKey: [key, user?.studio_id],
    queryFn: () => fn(),
    enabled: !!user?.studio_id,
  });

  const { data: sales = [] } = useQuery(qOpts("sales", () => base44.entities.Sale.filter({ studio_id: user.studio_id })));
  const { data: saleLineItems = [] } = useQuery(qOpts("saleLineItems", () => base44.entities.SaleLineItem.filter({ studio_id: user.studio_id })));
  const { data: payments = [] } = useQuery(qOpts("payments", () => base44.entities.Payment.filter({ studio_id: user.studio_id })));
  const { data: artists = [] } = useQuery(qOpts("artists", () => base44.entities.Artist.filter({ studio_id: user.studio_id })));
  const { data: locations = [] } = useQuery(qOpts("locations", () => base44.entities.Location.filter({ studio_id: user.studio_id })));
  const { data: reportingCategories = [] } = useQuery(qOpts("reportingCategories", () => base44.entities.ReportingCategory.filter({ studio_id: user.studio_id })));
  const { data: splitRules = [] } = useQuery(qOpts("artistSplitRules", () => base44.entities.ArtistSplitRule.filter({ studio_id: user.studio_id })));
  const { data: availabilities = [] } = useQuery(qOpts("availabilities", () => base44.entities.Availability.filter({ studio_id: user.studio_id })));

  const getUserRole = () =>
    user ? normalizeUserRole(user.user_role || (user.role === "admin" ? "Admin" : "Front_Desk")) : null;
  const isAdmin = getUserRole() === "Admin" || getUserRole() === "Owner";

  const saleById = useMemo(() => {
    const m = {};
    for (const s of sales) m[s.id] = s;
    return m;
  }, [sales]);

  const lineItemsBySale = useMemo(() => {
    const m = {};
    for (const li of saleLineItems) (m[li.sale_id] ||= []).push(li);
    return m;
  }, [saleLineItems]);

  const filteredSales = useMemo(() =>
    sales.filter((s) => {
      if (s.status !== "completed") return false;
      const d = s.sale_date;
      if (!d || d < startDate || d > endDate) return false;
      if (filterLocation !== "all" && s.location_id !== filterLocation) return false;
      if (filterArtist !== "all" && s.artist_id !== filterArtist) return false;
      return true;
    }),
    [sales, startDate, endDate, filterLocation, filterArtist]
  );

  const isGiftCardLine = useMemo(() => {
    const catById = {};
    for (const c of reportingCategories) catById[c.id] = c;
    return (li) => {
      if (li.line_type === "gift_card") return true;
      const cat = catById[li.reporting_category_id];
      return cat?.category_type === "store_credit" || cat?.revenue_sign === "negative";
    };
  }, [reportingCategories]);

  const revenueByCategory = useMemo(() => {
    const reportingOnly = filterCategoriesByRole(reportingCategories, CATEGORY_ROLE_REPORTING);
    const resolveKey = (li) => {
      if (li.reporting_category_id) {
        if (categoryRollupMode === "root") {
          const root = getRootAncestor(reportingOnly, li.reporting_category_id);
          const id = root?.id || li.reporting_category_id;
          const label = root?.name || findCategoryById(reportingOnly, li.reporting_category_id)?.name || li.reporting_category_name || "Uncategorized";
          return { key: `id:${id}`, label };
        }
        const leaf = findCategoryById(reportingOnly, li.reporting_category_id);
        return { key: `id:${li.reporting_category_id}`, label: leaf?.name || li.reporting_category_name || "Uncategorized" };
      }
      const nm = li.reporting_category_name || "Uncategorized";
      return { key: `name:${nm}`, label: nm };
    };

    const catMap = {};
    for (const s of filteredSales) {
      for (const li of lineItemsBySale[s.id] || []) {
        const { key, label } = resolveKey(li);
        if (!catMap[key]) catMap[key] = { category: label, revenue: 0, count: 0 };
        catMap[key].revenue += Number(li.net_amount) || 0;
        catMap[key].count += Number(li.quantity) || 0;
      }
    }
    return Object.values(catMap).sort((a, b) => b.revenue - a.revenue);
  }, [filteredSales, lineItemsBySale, reportingCategories, categoryRollupMode]);

  const dailyTotals = useMemo(() => {
    const dayMap = {};
    const ensure = (d) => (dayMap[d] ||= {
      date: d, gross: 0, tax: 0, discounts: 0, net: 0,
      tips: 0, gift_card_sales: 0, gift_card_returns: 0, returns: 0, count: 0,
    });

    for (const s of filteredSales) {
      const d = ensure(s.sale_date);
      d.net += Number(s.subtotal) || 0;
      d.tax += Number(s.tax_total) || 0;
      d.discounts += Number(s.discount_total) || 0;
      d.tips += Number(s.tip_total) || 0;
      d.gross += (Number(s.subtotal) || 0) + (Number(s.tax_total) || 0);
      d.count += 1;
      for (const li of lineItemsBySale[s.id] || []) {
        if (isGiftCardLine(li)) {
          const lt = Number(li.line_total) || 0;
          if (lt >= 0) d.gift_card_sales += lt;
          else d.gift_card_returns += Math.abs(lt);
        }
      }
    }

    for (const p of payments) {
      if (p.purpose !== "refund" || p.status !== "paid") continue;
      const d = p.business_date;
      if (!d || d < startDate || d > endDate) continue;
      if (filterLocation !== "all" && p.location_id !== filterLocation) continue;
      if (filterArtist !== "all") {
        const sale = p.sale_id ? saleById[p.sale_id] : null;
        if (!sale || sale.artist_id !== filterArtist) continue;
      }
      ensure(d).returns += Math.abs(Number(p.amount) || 0);
    }

    return Object.values(dayMap).sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredSales, lineItemsBySale, isGiftCardLine, payments, saleById, startDate, endDate, filterLocation, filterArtist]);

  const revenueByArtist = useMemo(() => {
    const acc = {};
    for (const s of filteredSales) {
      const name = artists.find((a) => a.id === s.artist_id)?.full_name || "Unassigned";
      if (!acc[name]) acc[name] = { artist: name, count: 0, net: 0, tax: 0, tips: 0, total: 0 };
      acc[name].count += 1;
      acc[name].net += Number(s.subtotal) || 0;
      acc[name].tax += Number(s.tax_total) || 0;
      acc[name].tips += Number(s.tip_total) || 0;
      acc[name].total += Number(s.total) || 0;
    }
    return acc;
  }, [filteredSales, artists]);

  const revenueByLocation = useMemo(() => {
    const acc = {};
    for (const s of filteredSales) {
      const name = locations.find((l) => l.id === s.location_id)?.name || "Unknown";
      if (!acc[name]) acc[name] = { location: name, count: 0, net: 0, tax: 0, tips: 0, total: 0 };
      acc[name].count += 1;
      acc[name].net += Number(s.subtotal) || 0;
      acc[name].tax += Number(s.tax_total) || 0;
      acc[name].tips += Number(s.tip_total) || 0;
      acc[name].total += Number(s.total) || 0;
    }
    return acc;
  }, [filteredSales, locations]);

  const artistShares = useMemo(() => {
    const shares = {};
    for (const s of filteredSales) {
      const artist = artists.find((a) => a.id === s.artist_id);
      const name = artist?.full_name || "Unassigned";
      const splitResolution = resolveRevenueSplitRule(splitRules, {
        appointmentTypeId: null,
        artistId: s.artist_id,
        appointmentTypeSplitEnabled: isAppointmentTypeSplitEnabled(artist),
      });
      let service = 0;
      let product = 0;
      for (const li of lineItemsBySale[s.id] || []) {
        const net = Number(li.net_amount) || 0;
        if (li.line_type === "service") service += net;
        else product += net;
      }
      service = Math.max(0, service);
      product = Math.max(0, product);
      const gross = service + product;
      const { artistShare, shopShare } = computeAppointmentShares(splitResolution, { service, product }, Number(s.tax_total) || 0);

      if (!shares[name]) {
        shares[name] = { artist: name, split_display: splitResolution.displayLabel, split_labels: [splitResolution.displayLabel], gross: 0, artist_share: 0, shop_share: 0 };
      }
      if (!shares[name].split_labels.includes(splitResolution.displayLabel)) shares[name].split_labels.push(splitResolution.displayLabel);
      shares[name].gross += gross;
      shares[name].artist_share += artistShare;
      shares[name].shop_share += shopShare;
    }
    return Object.values(shares).map((row) => {
      const sortedLabels = row.split_labels.slice().sort((a, b) => a.localeCompare(b));
      return { ...row, split_display: sortedLabels.length === 1 ? sortedLabels[0] : "Varies", split_labels: sortedLabels.join(", ") };
    });
  }, [filteredSales, artists, splitRules, lineItemsBySale]);

  const supportStaffAvailabilityHours = useMemo(() => {
    const supportArtists = artists.filter(
      (a) => isSupportStaffArtistType(a.artist_type) && (filterArtist === "all" || a.id === filterArtist)
    );
    const rows = supportArtists.map((artist) => {
      const artistRows = availabilities.filter((v) => v.artist_id === artist.id);
      const hours = sumExplicitAvailableHoursInRange(artistRows, {
        rangeStartStr: startDate, rangeEndStr: endDate, filterLocationId: filterLocation,
      });
      return { artist: artist.full_name, role: getArtistTypeLabel(artist.artist_type), hours };
    });
    rows.sort((a, b) => b.hours - a.hours || String(a.artist).localeCompare(String(b.artist)));
    return { rows, totalHours: rows.reduce((s, r) => s + r.hours, 0) };
  }, [artists, availabilities, startDate, endDate, filterLocation, filterArtist]);

  const exportToCSV = (data, filename) => {
    if (data.length === 0) return;
    const headers = Object.keys(data[0]);
    const csvContent = [headers.join(","), ...data.map((row) => headers.map((h) => row[h]).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}_${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">Only Admins can access reports.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const totals = dailyTotals.reduce(
    (acc, d) => ({
      gross: acc.gross + d.gross,
      net: acc.net + d.net,
      tax: acc.tax + d.tax,
      tips: acc.tips + d.tips,
    }),
    { gross: 0, net: 0, tax: 0, tips: 0 }
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 mt-1">Revenue analytics from the unified sales ledger</p>
        </div>

        <Card className="bg-white border-none shadow-md">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={filterLocation} onValueChange={setFilterLocation}>
                  <SelectTrigger><SelectValue placeholder="All Locations" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Locations</SelectItem>
                    {locations.map((loc) => (<SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Artist</Label>
                <Select value={filterArtist} onValueChange={setFilterArtist}>
                  <SelectTrigger><SelectValue placeholder="All Artists" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Artists</SelectItem>
                    {artists.map((a) => (<SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-white border-none shadow-md">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Gross Revenue (incl. tax)</p>
              <p className="text-2xl font-bold text-gray-900">${totals.gross.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card className="bg-white border-none shadow-md">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Net (pre-tax)</p>
              <p className="text-2xl font-bold text-green-700">${totals.net.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card className="bg-white border-none shadow-md">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Tax Collected</p>
              <p className="text-2xl font-bold text-gray-900">${totals.tax.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card className="bg-white border-none shadow-md">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Tips</p>
              <p className="text-2xl font-bold text-indigo-700">${totals.tips.toFixed(2)}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="daily" className="space-y-6">
          <TabsList className="bg-white border border-gray-200">
            <TabsTrigger value="daily">Daily Totals</TabsTrigger>
            <TabsTrigger value="category">By Category</TabsTrigger>
            <TabsTrigger value="artist">By Artist</TabsTrigger>
            <TabsTrigger value="splits">Artist Splits</TabsTrigger>
            <TabsTrigger value="location">By Location</TabsTrigger>
            <TabsTrigger value="support_staff_hours">Counter / scrub hours</TabsTrigger>
          </TabsList>

          <TabsContent value="daily">
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Daily Revenue Totals</CardTitle>
                <Button variant="outline" onClick={() => exportToCSV(dailyTotals, "daily_totals")} disabled={dailyTotals.length === 0}>
                  <Download className="w-4 h-4 mr-2" /> Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                {dailyTotals.length === 0 ? (
                  <div className="text-center py-12"><DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">No data in selected range</p></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Date</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Sales</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Gross</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Tax</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Discounts</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Net</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Tips</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">GC Sales</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">GC Returns</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Refunds</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {dailyTotals.map((d) => (
                          <tr key={d.date} className="hover:bg-gray-50">
                            <td className="px-3 py-3 text-sm text-gray-900">{d.date}</td>
                            <td className="px-3 py-3 text-sm text-gray-600 text-right">{d.count}</td>
                            <td className="px-3 py-3 text-sm text-gray-900 text-right">${d.gross.toFixed(2)}</td>
                            <td className="px-3 py-3 text-sm text-gray-900 text-right">${d.tax.toFixed(2)}</td>
                            <td className="px-3 py-3 text-sm text-red-600 text-right">${d.discounts.toFixed(2)}</td>
                            <td className="px-3 py-3 text-sm text-gray-900 text-right font-bold">${d.net.toFixed(2)}</td>
                            <td className="px-3 py-3 text-sm text-gray-900 text-right">${d.tips.toFixed(2)}</td>
                            <td className="px-3 py-3 text-sm text-gray-900 text-right">${d.gift_card_sales.toFixed(2)}</td>
                            <td className="px-3 py-3 text-sm text-red-600 text-right">${d.gift_card_returns.toFixed(2)}</td>
                            <td className="px-3 py-3 text-sm text-amber-800 text-right">${(d.returns || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="category">
            <Card className="bg-white border-none shadow-lg">
              <CardHeader>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <CardTitle>Revenue by Category</CardTitle>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm whitespace-nowrap">Roll up by</Label>
                      <Select value={categoryRollupMode} onValueChange={setCategoryRollupMode}>
                        <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="leaf">Leaf (detail)</SelectItem>
                          <SelectItem value="root">Top-level parent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button variant="outline" onClick={() => exportToCSV(revenueByCategory, "revenue_by_category")} disabled={revenueByCategory.length === 0}>
                      <Download className="w-4 h-4 mr-2" /> Export CSV
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {revenueByCategory.length === 0 ? (
                  <div className="text-center py-12"><BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">No data</p></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Category</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Items Sold</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Revenue (net)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {revenueByCategory.map((r, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900 font-medium">{r.category}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 text-right">{r.count}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right font-bold">${r.revenue.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="artist">
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Revenue by Artist</CardTitle>
                <Button variant="outline" onClick={() => exportToCSV(Object.values(revenueByArtist), "revenue_by_artist")} disabled={Object.keys(revenueByArtist).length === 0}>
                  <Download className="w-4 h-4 mr-2" /> Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                {Object.keys(revenueByArtist).length === 0 ? (
                  <div className="text-center py-12"><TrendingUp className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">No data</p></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Artist</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Sales</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Net</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Tax</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Tips</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {Object.values(revenueByArtist).map((r, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900 font-medium">{r.artist}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 text-right">{r.count}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${r.net.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${r.tax.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${r.tips.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right font-bold">${r.total.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="splits">
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Artist / Shop Revenue Split</CardTitle>
                <Button variant="outline" onClick={() => exportToCSV(artistShares, "artist_splits")} disabled={artistShares.length === 0}>
                  <Download className="w-4 h-4 mr-2" /> Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                {artistShares.length === 0 ? (
                  <div className="text-center py-12"><Users className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">No data</p></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Artist</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Split Rule</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Gross</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Artist Share</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Shop Share</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {artistShares.map((r, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900 font-medium">{r.artist}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 text-right">{r.split_display}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${r.gross.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-green-700 text-right font-bold">${r.artist_share.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-indigo-700 text-right font-bold">${r.shop_share.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="location">
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Revenue by Location</CardTitle>
                <Button variant="outline" onClick={() => exportToCSV(Object.values(revenueByLocation), "revenue_by_location")} disabled={Object.keys(revenueByLocation).length === 0}>
                  <Download className="w-4 h-4 mr-2" /> Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                {Object.keys(revenueByLocation).length === 0 ? (
                  <div className="text-center py-12"><TrendingUp className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">No data</p></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Location</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Sales</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Net</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Tax</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Tips</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {Object.values(revenueByLocation).map((r, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900 font-medium">{r.location}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 text-right">{r.count}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${r.net.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${r.tax.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${r.tips.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right font-bold">${r.total.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="support_staff_hours">
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-indigo-600" />
                    Counter &amp; scrub — explicit availability hours
                  </CardTitle>
                  <p className="text-sm text-muted-foreground font-normal mt-1 max-w-xl">
                    Totals come from calendar availability entries only (per-day date ranges under My
                    Availability). Recurring weekly schedules are excluded.
                  </p>
                </div>
                <Button variant="outline" className="shrink-0" onClick={() => exportToCSV(supportStaffAvailabilityHours.rows, "counter_scrub_explicit_hours")} disabled={supportStaffAvailabilityHours.rows.length === 0}>
                  <Download className="w-4 h-4 mr-2" /> Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                {supportStaffAvailabilityHours.rows.length === 0 ? (
                  <div className="text-center py-12">
                    <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No Counter or Scrub profiles in scope, or none match the Artist filter.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Staff</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Type</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Hours (explicit avail.)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {supportStaffAvailabilityHours.rows.map((r, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900 font-medium">{r.artist}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{r.role}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right font-semibold tabular-nums">{r.hours.toFixed(2)}</td>
                          </tr>
                        ))}
                        <tr className="bg-gray-50 font-semibold">
                          <td colSpan={2} className="px-4 py-3 text-sm text-gray-900">Total</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">{supportStaffAvailabilityHours.totalHours.toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
