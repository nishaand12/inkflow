import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, TrendingUp, DollarSign, BarChart3, Users } from "lucide-react";
import { format, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { normalizeUserRole } from "@/utils/roles";
import {
  CATEGORY_ROLE_REPORTING,
  filterCategoriesByRole,
  findCategoryById,
  getRootAncestor,
} from "@/utils/reportingCategories";

export default function Reports() {
  const [user, setUser] = useState(null);
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [filterLocation, setFilterLocation] = useState('all');
  const [filterArtist, setFilterArtist] = useState('all');

  useEffect(() => { loadUser(); }, []);

  const loadUser = async () => {
    try { setUser(await base44.auth.me()); } catch (e) { console.error(e); }
  };

  const [categoryRollupMode, setCategoryRollupMode] = useState("leaf");

  const qOpts = (key, fn) => ({
    queryKey: [key, user?.studio_id],
    queryFn: () => fn(),
    enabled: !!user?.studio_id
  });

  const { data: appointments = [] } = useQuery(qOpts('appointments', () => base44.entities.Appointment.filter({ studio_id: user.studio_id })));
  const { data: artists = [] } = useQuery(qOpts('artists', () => base44.entities.Artist.filter({ studio_id: user.studio_id })));
  const { data: locations = [] } = useQuery(qOpts('locations', () => base44.entities.Location.filter({ studio_id: user.studio_id })));
  const { data: appointmentTypes = [] } = useQuery(qOpts('appointmentTypes', () => base44.entities.AppointmentType.filter({ studio_id: user.studio_id })));
  const { data: charges = [] } = useQuery(qOpts('appointmentCharges', () => base44.entities.AppointmentCharge.filter({ studio_id: user.studio_id })));
  const { data: reportingCategories = [] } = useQuery(qOpts('reportingCategories', () => base44.entities.ReportingCategory.filter({ studio_id: user.studio_id })));
  const { data: splitRules = [] } = useQuery(qOpts('artistSplitRules', () => base44.entities.ArtistSplitRule.filter({ studio_id: user.studio_id })));
  const { data: appointmentRefunds = [] } = useQuery(
    qOpts('appointmentRefunds', () => base44.entities.AppointmentRefund.filter({ studio_id: user.studio_id }))
  );
  useQuery(qOpts('settlements', () => base44.entities.DailySettlement.filter({ studio_id: user.studio_id })));

  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(user.user_role || (user.role === 'admin' ? 'Admin' : 'Front_Desk'));
  };
  const isAdmin = getUserRole() === 'Admin' || getUserRole() === 'Owner';

  const filteredAppointments = appointments.filter(apt => {
    const d = apt.appointment_date;
    if (d < startDate || d > endDate) return false;
    if (filterLocation !== 'all' && apt.location_id !== filterLocation) return false;
    if (filterArtist !== 'all' && apt.artist_id !== filterArtist) return false;
    return true;
  });

  const completedAppointments = filteredAppointments.filter(a => a.status === 'completed');

  const revenueByCategory = useMemo(() => {
    const reportingOnly = filterCategoriesByRole(reportingCategories, CATEGORY_ROLE_REPORTING);

    const resolveChargeCategoryKey = (ch) => {
      if (ch.reporting_category_id) {
        if (categoryRollupMode === "root") {
          const root = getRootAncestor(reportingOnly, ch.reporting_category_id);
          const id = root?.id || ch.reporting_category_id;
          const label =
            root?.name ||
            findCategoryById(reportingOnly, ch.reporting_category_id)?.name ||
            ch.reporting_category_name ||
            "Uncategorized";
          return { key: `id:${id}`, label };
        }
        const leaf = findCategoryById(reportingOnly, ch.reporting_category_id);
        const label = leaf?.name || ch.reporting_category_name || "Uncategorized";
        return { key: `id:${ch.reporting_category_id}`, label };
      }
      const nm = ch.reporting_category_name || "Uncategorized";
      return { key: `name:${nm}`, label: nm };
    };

    const resolveFallbackAppointmentCategoryKey = (apt) => {
      const type = appointmentTypes.find((t) => t.id === apt.appointment_type_id);
      if (type?.reporting_category_id) {
        if (categoryRollupMode === "root") {
          const root = getRootAncestor(reportingOnly, type.reporting_category_id);
          const id = root?.id || type.reporting_category_id;
          const label =
            root?.name ||
            findCategoryById(reportingOnly, type.reporting_category_id)?.name ||
            "Uncategorized";
          return { key: `id:${id}`, label };
        }
        const leaf = findCategoryById(reportingOnly, type.reporting_category_id);
        return {
          key: `id:${type.reporting_category_id}`,
          label: leaf?.name || "Uncategorized",
        };
      }
      const legacy = type?.category || "Uncategorized";
      return { key: `legacy:${legacy}`, label: legacy };
    };

    const catMap = {};
    for (const apt of completedAppointments) {
      const aptCharges = charges.filter((c) => c.appointment_id === apt.id);
      if (aptCharges.length > 0) {
        for (const ch of aptCharges) {
          const { key, label } = resolveChargeCategoryKey(ch);
          if (!catMap[key]) catMap[key] = { category: label, revenue: 0, count: 0 };
          catMap[key].revenue += ch.line_total || 0;
          catMap[key].count += ch.quantity || 1;
        }
      } else {
        const { key, label } = resolveFallbackAppointmentCategoryKey(apt);
        if (!catMap[key]) catMap[key] = { category: label, revenue: 0, count: 0 };
        catMap[key].revenue += (apt.charge_amount || 0) + (apt.deposit_amount || 0);
        catMap[key].count += 1;
      }
    }
    return Object.values(catMap).sort((a, b) => b.revenue - a.revenue);
  }, [
    completedAppointments,
    charges,
    appointmentTypes,
    reportingCategories,
    categoryRollupMode,
  ]);

  const dailyTotals = (() => {
    const getPaidDepositAmount = (apt, grossAmount) => {
      if (apt.deposit_status !== "paid") return 0;
      const deposit = Number(apt.deposit_amount) || 0;
      return Math.min(deposit, Math.max(0, Number(grossAmount) || 0));
    };

    const dayMap = {};
    for (const apt of completedAppointments) {
      const d = apt.appointment_date;
      if (!dayMap[d]) dayMap[d] = {
        date: d, gross: 0, tax: 0, discounts: 0, net: 0,
        pos_collected: 0, cash_collected: 0, online_collected: 0, gift_card_sales: 0, gift_card_returns: 0, returns: 0, count: 0
      };

      const aptCharges = charges.filter(c => c.appointment_id === apt.id);
      const chargeSum = aptCharges.reduce((s, c) => s + (c.line_total || 0), 0);
      const charge = Number(apt.charge_amount) || 0;
      const deposit = Number(apt.deposit_amount) || 0;
      const gross = chargeSum > 0 ? chargeSum : (charge > 0 ? charge : deposit);

      dayMap[d].gross += gross;
      dayMap[d].tax += apt.tax_amount || 0;
      dayMap[d].discounts += apt.discount_amount || 0;
      dayMap[d].count += 1;

      const paidDeposit = getPaidDepositAmount(apt, gross);
      const finalCollectedAmount = Math.max(0, gross - paidDeposit);
      dayMap[d].online_collected += paidDeposit;

      if (apt.payment_method === "Stripe") {
        dayMap[d].online_collected += finalCollectedAmount;
      } else if (apt.payment_method === "Cash" || apt.payment_method === "E-Transfer") {
        dayMap[d].cash_collected += finalCollectedAmount;
      } else {
        dayMap[d].pos_collected += finalCollectedAmount;
      }

      for (const ch of aptCharges) {
        const cat = reportingCategories.find(c => c.id === ch.reporting_category_id);
        if (cat?.category_type === 'store_credit') {
          if (ch.line_total >= 0) dayMap[d].gift_card_sales += ch.line_total;
          else dayMap[d].gift_card_returns += Math.abs(ch.line_total);
        }
      }
    }

    for (const ref of appointmentRefunds) {
      const amt = parseFloat(ref.amount) || 0;
      if (amt <= 0) continue;
      const apt = appointments.find(a => a.id === ref.appointment_id);
      if (!apt) continue;
      if (filterLocation !== 'all' && apt.location_id !== filterLocation) continue;
      if (filterArtist !== 'all' && apt.artist_id !== filterArtist) continue;
      let refundDay = '';
      try {
        refundDay = ref.created_at ? format(parseISO(ref.created_at), 'yyyy-MM-dd') : '';
      } catch {
        refundDay = typeof ref.created_at === 'string' ? ref.created_at.slice(0, 10) : '';
      }
      if (!refundDay || refundDay < startDate || refundDay > endDate) continue;

      if (!dayMap[refundDay]) {
        dayMap[refundDay] = {
          date: refundDay, gross: 0, tax: 0, discounts: 0, net: 0,
          pos_collected: 0, cash_collected: 0, online_collected: 0, gift_card_sales: 0, gift_card_returns: 0, returns: 0, count: 0
        };
      }
      dayMap[refundDay].returns += amt;
    }

    return Object.values(dayMap)
      .map(d => ({ ...d, net: d.gross - d.tax - d.discounts }))
      .sort((a, b) => b.date.localeCompare(a.date));
  })();

  const revenueByArtist = completedAppointments.reduce((acc, apt) => {
    const artist = artists.find(a => a.id === apt.artist_id);
    const name = artist?.full_name || 'Unknown';
    if (!acc[name]) acc[name] = { artist: name, deposits: 0, charges: 0, tax: 0, revenue: 0, count: 0 };
    acc[name].deposits += apt.deposit_amount || 0;
    acc[name].charges += apt.charge_amount || 0;
    acc[name].tax += apt.tax_amount || 0;
    acc[name].revenue += (apt.deposit_amount || 0) + (apt.charge_amount || 0);
    acc[name].count++;
    return acc;
  }, {});

  const artistShares = (() => {
    const shares = {};
    for (const apt of completedAppointments) {
      const artist = artists.find(a => a.id === apt.artist_id);
      const name = artist?.full_name || 'Unknown';
      const rule = splitRules.find(r => r.artist_id === apt.artist_id && r.is_active);
      const pct = rule?.split_percent ?? 0;

      const aptCharges = charges.filter(c => c.appointment_id === apt.id);
      let service = 0;
      let product = 0;
      if (aptCharges.length > 0) {
        service = aptCharges
          .filter(c => c.line_type === "service")
          .reduce((s, c) => s + (c.line_total || 0), 0);
        product = aptCharges
          .filter(c => c.line_type === "product")
          .reduce((s, c) => s + (c.line_total || 0), 0);
      } else {
        const charge = Number(apt.charge_amount) || 0;
        const deposit = Number(apt.deposit_amount) || 0;
        service = charge > 0 ? charge : deposit;
      }
      const gross = service + product;
      const artistShare = service * (pct / 100);

      if (!shares[name]) shares[name] = { artist: name, split_percent: pct, gross: 0, artist_share: 0, shop_share: 0 };
      shares[name].gross += gross;
      shares[name].artist_share += artistShare;
      shares[name].shop_share += (service - artistShare) + product;
    }
    return Object.values(shares);
  })();

  const revenueByLocation = completedAppointments.reduce((acc, apt) => {
    const loc = locations.find(l => l.id === apt.location_id);
    const name = loc?.name || 'Unknown';
    if (!acc[name]) acc[name] = { location: name, deposits: 0, charges: 0, tax: 0, revenue: 0, count: 0 };
    acc[name].deposits += apt.deposit_amount || 0;
    acc[name].charges += apt.charge_amount || 0;
    acc[name].tax += apt.tax_amount || 0;
    acc[name].revenue += (apt.deposit_amount || 0) + (apt.charge_amount || 0);
    acc[name].count++;
    return acc;
  }, {});

  const exportToCSV = (data, filename) => {
    if (data.length === 0) return;
    const headers = Object.keys(data[0]);
    const csvContent = [headers.join(','), ...data.map(row => headers.map(h => row[h]).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
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

  const totals = dailyTotals.reduce((acc, d) => ({
    gross: acc.gross + d.gross,
    tax: acc.tax + d.tax,
    discounts: acc.discounts + d.discounts,
    net: acc.net + d.net,
    pos: acc.pos + d.pos_collected,
    cash: acc.cash + d.cash_collected,
    online: acc.online + d.online_collected
  }), { gross: 0, tax: 0, discounts: 0, net: 0, pos: 0, cash: 0, online: 0 });

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 mt-1">Analytics and insights for your business</p>
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
                    {locations.map(loc => (<SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Artist</Label>
                <Select value={filterArtist} onValueChange={setFilterArtist}>
                  <SelectTrigger><SelectValue placeholder="All Artists" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Artists</SelectItem>
                    {artists.map(a => (<SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-white border-none shadow-md">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Gross Revenue</p>
              <p className="text-2xl font-bold text-gray-900">${totals.gross.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card className="bg-white border-none shadow-md">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Net (excl. tax)</p>
              <p className="text-2xl font-bold text-green-700">${totals.net.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card className="bg-white border-none shadow-md">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Terminal Collected</p>
              <p className="text-2xl font-bold text-gray-900">${totals.pos.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card className="bg-white border-none shadow-md">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Online Collected</p>
              <p className="text-2xl font-bold text-indigo-700">${totals.online.toFixed(2)}</p>
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
          </TabsList>

          <TabsContent value="daily">
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Daily Operational Totals</CardTitle>
                <Button variant="outline" onClick={() => exportToCSV(dailyTotals, 'daily_totals')} disabled={dailyTotals.length === 0}>
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
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Apts</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Gross</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Tax</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Discounts</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Net</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Terminal</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Cash</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Online</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">GC Sales</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Returns</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {dailyTotals.map(d => (
                          <tr key={d.date} className="hover:bg-gray-50">
                            <td className="px-3 py-3 text-sm text-gray-900">{d.date}</td>
                            <td className="px-3 py-3 text-sm text-gray-600 text-right">{d.count}</td>
                            <td className="px-3 py-3 text-sm text-gray-900 text-right">${d.gross.toFixed(2)}</td>
                            <td className="px-3 py-3 text-sm text-gray-900 text-right">${d.tax.toFixed(2)}</td>
                            <td className="px-3 py-3 text-sm text-red-600 text-right">${d.discounts.toFixed(2)}</td>
                            <td className="px-3 py-3 text-sm text-gray-900 text-right font-bold">${d.net.toFixed(2)}</td>
                            <td className="px-3 py-3 text-sm text-gray-900 text-right">${d.pos_collected.toFixed(2)}</td>
                            <td className="px-3 py-3 text-sm text-gray-900 text-right">${d.cash_collected.toFixed(2)}</td>
                            <td className="px-3 py-3 text-sm text-gray-900 text-right">${d.online_collected.toFixed(2)}</td>
                            <td className="px-3 py-3 text-sm text-gray-900 text-right">${d.gift_card_sales.toFixed(2)}</td>
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
                        <SelectTrigger className="w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="leaf">Leaf (detail)</SelectItem>
                          <SelectItem value="root">Top-level parent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => exportToCSV(revenueByCategory, "revenue_by_category")}
                      disabled={revenueByCategory.length === 0}
                    >
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
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Revenue</th>
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
                <Button variant="outline" onClick={() => exportToCSV(Object.values(revenueByArtist), 'revenue_by_artist')} disabled={Object.keys(revenueByArtist).length === 0}>
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
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Apts</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Deposits</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Charges</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Tax</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Revenue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {Object.values(revenueByArtist).map((r, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900 font-medium">{r.artist}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 text-right">{r.count}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${r.deposits.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${r.charges.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${r.tax.toFixed(2)}</td>
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

          <TabsContent value="splits">
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Artist / Shop Revenue Split</CardTitle>
                <Button variant="outline" onClick={() => exportToCSV(artistShares, 'artist_splits')} disabled={artistShares.length === 0}>
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
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Split %</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Gross</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Artist Share</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Shop Share</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {artistShares.map((r, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900 font-medium">{r.artist}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 text-right">{r.split_percent}%</td>
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
                <Button variant="outline" onClick={() => exportToCSV(Object.values(revenueByLocation), 'revenue_by_location')} disabled={Object.keys(revenueByLocation).length === 0}>
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
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Apts</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Deposits</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Charges</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Tax</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Revenue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {Object.values(revenueByLocation).map((r, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900 font-medium">{r.location}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 text-right">{r.count}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${r.deposits.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${r.charges.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">${r.tax.toFixed(2)}</td>
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
        </Tabs>
      </div>
    </div>
  );
}
