import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import {
  computeUnreconciledDays,
  fetchArtistReport,
  fetchAvailabilitiesForReport,
  fetchCategoryItemReport,
  fetchCategoryReport,
  fetchDailyTotalsReport,
  fetchLocationReport,
  fetchPaymentsReport,
  fetchReportContext,
  fetchSalesReport,
  fetchStripeDepositsReport,
} from "@/api/reports";
import { useCheckoutPaymentMethods } from "@/utils/useCheckoutPaymentMethods";
import SaleDetailDialog from "@/components/sales/SaleDetailDialog";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Download, DollarSign, Clock, AlertTriangle, BarChart3, Users, TrendingUp, Globe, ShoppingBag, ChevronLeft, ChevronRight, CreditCard, ArrowLeft } from "lucide-react";
import { format, parseISO } from "date-fns";
import { normalizeUserRole } from "@/utils/roles";
import { DEFAULT_TENDER_GROUP_DEFS } from "@/utils/reportTenderGroups";
import {
  buildCategoryOrderIndex,
  sortRowsByCategoryOrder,
} from "@/utils/reportingCategories";
import { getArtistTypeLabel, isSupportStaffArtistType } from "@/utils/artistTypes";
import { sumExplicitAvailableHoursInRange } from "@/utils/explicitAvailabilityHours";
import {
  toReportsArtistId,
  useWorkspaceFilters,
  useWorkspaceUrlSync,
} from "@/hooks/useWorkspaceFilters";
import { nextDateRange } from "@/lib/dateRange";

const REPORTS_URL_PARAMS = {
  start: "startDate",
  end: "endDate",
  location: "locationId",
  artist: "artistId",
  tab: "reportsTab",
  category: "reportsCategoryKey",
  categoryScope: "reportsCategoryScope",
};

const CATEGORY_DETAIL_PAGE_SIZE = 25;

function money(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function tenderGroupAmounts(groups) {
  return Object.fromEntries((groups ?? []).map((g) => [g.key, Number(g.amount) || 0]));
}

function dailyTotalsRowsToCsv(rows, locationById, includeLocation, groupDefs) {
  return rows.map((row) => {
    const groupAmounts = tenderGroupAmounts(row.tender_groups);
    return {
      date: row.business_date,
      ...(includeLocation
        ? { location: locationById[row.location_id]?.name || row.location_id }
        : {}),
      sale_count: row.sale_count,
      gross_sales: row.gross_sales,
      tattoo_split: row.tattoo_split,
      piercing_split: row.piercing_split,
      product_sales: row.product_other,
      refunds: -(Number(row.refunds_in_person) || 0),
      shop_revenue: row.shop_total,
      ...Object.fromEntries(groupDefs.map((def) => [def.key, groupAmounts[def.key] ?? 0])),
    };
  });
}

function exportToCSV(data, filename) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(","),
    ...data.map((row) => headers.map((h) => JSON.stringify(row[h] ?? "")).join(",")),
  ].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}_${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
}

const SALES_PAGE_SIZE = 25;
const PAYMENTS_PAGE_SIZE = 50;

function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy h:mm a");
  } catch {
    return iso;
  }
}

function summarizeLineItems(lineItems) {
  if (!lineItems?.length) return "—";
  const parts = lineItems.map((li) => {
    const qty = Number(li.quantity) || 1;
    const label = li.description || "Item";
    return qty > 1 ? `${label} ×${qty}` : label;
  });
  const joined = parts.join(", ");
  return joined.length > 80 ? `${joined.slice(0, 77)}…` : joined;
}

export default function Reports() {
  const { filters, setFilters } = useWorkspaceFilters();
  useWorkspaceUrlSync(REPORTS_URL_PARAMS);

  const startDate = filters.startDate;
  const endDate = filters.endDate;
  const filterLocation = filters.locationId;
  const filterArtist = toReportsArtistId(filters.artistId);
  const activeTab = filters.reportsTab;
  const categoryDetailKey = filters.reportsCategoryKey || "";
  const categoryDetailScope = filters.reportsCategoryScope || "leaf";

  const [user, setUser] = useState(null);
  const [categoryRollupMode, setCategoryRollupMode] = useState("leaf");
  const [categoryDetailPage, setCategoryDetailPage] = useState(0);
  const [salesPage, setSalesPage] = useState(0);
  const [selectedSaleRow, setSelectedSaleRow] = useState(null);
  const [filterTender, setFilterTender] = useState("all");
  const [paymentsPage, setPaymentsPage] = useState(0);

  const setStartDate = (value) => setFilters(nextDateRange("start", value, startDate, endDate));
  const setEndDate = (value) => setFilters(nextDateRange("end", value, startDate, endDate));
  const setFilterLocation = (value) => setFilters({ locationId: value });
  const setFilterArtist = (value) => setFilters({ artistId: value });
  const setActiveTab = (value) => {
    if (value === "category") {
      setFilters({
        reportsTab: value,
        reportsCategoryKey: "",
        reportsCategoryScope: "leaf",
      });
      return;
    }
    setFilters({ reportsTab: value });
  };

  const openCategoryDetail = (row) => {
    if (!row?.category_key) return;
    const includeTree =
      categoryRollupMode === "root" && String(row.category_key).startsWith("id:");
    setCategoryDetailPage(0);
    setFilters({
      reportsTab: "category-detail",
      reportsCategoryKey: row.category_key,
      reportsCategoryScope: includeTree ? "tree" : "leaf",
    });
  };

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
  const dateRangeValid = !!startDate && !!endDate && startDate <= endDate;

  // Payments filter: in-person tenders (built-ins + custom) plus online
  // (Stripe) payments, stored with tender_type = "Stripe".
  const { options: checkoutMethodOptions } = useCheckoutPaymentMethods(studioId);
  const paymentTenderOptions = useMemo(
    () => [...checkoutMethodOptions, { value: "Stripe", label: "Stripe (online)" }],
    [checkoutMethodOptions]
  );

  const { data: artists = [] } = useQuery({
    queryKey: ["artists", studioId],
    queryFn: () => base44.entities.Artist.filter({ studio_id: studioId }),
    enabled: !!studioId,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", studioId],
    queryFn: () => base44.entities.Location.filter({ studio_id: studioId }),
    enabled: !!studioId,
  });

  useEffect(() => {
    setSalesPage(0);
  }, [startDate, endDate, filterLocation, filterArtist]);

  useEffect(() => {
    setCategoryDetailPage(0);
  }, [startDate, endDate, filterLocation, categoryDetailKey, categoryDetailScope]);

  useEffect(() => {
    setPaymentsPage(0);
  }, [startDate, endDate, filterLocation, filterTender]);

  const { data: availabilities = [], isLoading: loadingAvailabilities } = useQuery({
    queryKey: ["reportAvailabilities", startDate, endDate, filterLocation],
    queryFn: () =>
      fetchAvailabilitiesForReport({
        startDate,
        endDate,
        locationId: filterLocation,
      }),
    enabled: !!studioId && dateRangeValid && activeTab === "support_staff_hours",
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers", studioId],
    queryFn: () => base44.entities.Customer.filter({ studio_id: studioId }),
    enabled: !!studioId && (activeTab === "sales" || activeTab === "payments" || activeTab === "stripe"),
  });

  const { data: reportContext } = useQuery({
    queryKey: ["reportContext", studioId, startDate, endDate, filterLocation],
    queryFn: () =>
      fetchReportContext({
        studioId,
        startDate,
        endDate,
        locationId: filterLocation,
      }),
    enabled: !!studioId && dateRangeValid,
  });

  const {
    data: dailyTotalsReport,
    isLoading: loadingDailyTotals,
  } = useQuery({
    queryKey: ["dailyTotalsReport", startDate, endDate, filterLocation],
    queryFn: () =>
      fetchDailyTotalsReport({
        startDate,
        endDate,
        locationId: filterLocation,
      }),
    enabled: !!studioId && dateRangeValid,
  });

  const { data: rawCategoryRows = [], isLoading: loadingCategory } = useQuery({
    queryKey: ["categoryReport", startDate, endDate, filterLocation, categoryRollupMode],
    queryFn: () =>
      fetchCategoryReport({
        startDate,
        endDate,
        locationId: filterLocation,
        rollupMode: categoryRollupMode,
      }),
    enabled: !!studioId && dateRangeValid && activeTab === "category",
  });

  const { data: categoryItemReport, isLoading: loadingCategoryDetail } = useQuery({
    queryKey: [
      "categoryItemReport",
      startDate,
      endDate,
      filterLocation,
      categoryDetailKey,
      categoryDetailScope,
      categoryDetailPage,
    ],
    queryFn: () =>
      fetchCategoryItemReport({
        startDate,
        endDate,
        locationId: filterLocation,
        categoryKey: categoryDetailKey,
        includeDescendants: categoryDetailScope === "tree",
        limit: CATEGORY_DETAIL_PAGE_SIZE,
        offset: categoryDetailPage * CATEGORY_DETAIL_PAGE_SIZE,
      }),
    enabled:
      !!studioId &&
      dateRangeValid &&
      activeTab === "category-detail" &&
      !!categoryDetailKey,
  });

  const { data: reportingCategoriesList = [] } = useQuery({
    queryKey: ["reportingCategories", studioId],
    queryFn: () => base44.entities.ReportingCategory.filter({ studio_id: studioId }),
    enabled: !!studioId && (activeTab === "category" || activeTab === "category-detail"),
  });

  // Rows follow the display order configured on the Categories page; rows for
  // deleted/legacy categories go last, alphabetically.
  const categoryRows = useMemo(() => {
    const orderIndex = buildCategoryOrderIndex(reportingCategoriesList);
    return sortRowsByCategoryOrder(
      rawCategoryRows,
      orderIndex,
      (r) => (r.category_key?.startsWith("id:") ? r.category_key.slice(3) : null),
      (r) => r.category_name
    );
  }, [rawCategoryRows, reportingCategoriesList]);

  const { data: artistRows = [], isLoading: loadingArtist } = useQuery({
    queryKey: ["artistReport", startDate, endDate, filterLocation, filterArtist],
    queryFn: () =>
      fetchArtistReport({
        startDate,
        endDate,
        locationId: filterLocation,
        artistId: filterArtist,
      }),
    enabled: !!studioId && dateRangeValid && activeTab === "artist",
  });

  const { data: locationRows = [], isLoading: loadingLocation } = useQuery({
    queryKey: ["locationReport", startDate, endDate, filterLocation],
    queryFn: () =>
      fetchLocationReport({
        startDate,
        endDate,
        locationId: filterLocation,
      }),
    enabled: !!studioId && dateRangeValid && activeTab === "location" && locations.length > 1,
  });

  const { data: stripeReport, isLoading: loadingStripe } = useQuery({
    queryKey: ["stripeReport", startDate, endDate, filterLocation],
    queryFn: () =>
      fetchStripeDepositsReport({
        startDate,
        endDate,
        locationId: filterLocation,
      }),
    enabled: !!studioId && dateRangeValid && activeTab === "stripe",
  });

  const { data: salesReport, isLoading: loadingSales } = useQuery({
    queryKey: ["salesReport", startDate, endDate, filterLocation, filterArtist, salesPage],
    queryFn: () =>
      fetchSalesReport({
        startDate,
        endDate,
        locationId: filterLocation,
        artistId: filterArtist,
        limit: SALES_PAGE_SIZE,
        offset: salesPage * SALES_PAGE_SIZE,
      }),
    enabled: !!studioId && dateRangeValid && activeTab === "sales",
  });

  const { data: paymentsReport, isLoading: loadingPayments } = useQuery({
    queryKey: ["paymentsReport", startDate, endDate, filterLocation, filterTender, paymentsPage],
    queryFn: () =>
      fetchPaymentsReport({
        startDate,
        endDate,
        locationId: filterLocation,
        tenderType: filterTender,
        limit: PAYMENTS_PAGE_SIZE,
        offset: paymentsPage * PAYMENTS_PAGE_SIZE,
      }),
    enabled: !!studioId && dateRangeValid && activeTab === "payments",
  });

  const dailyRows = dailyTotalsReport?.rows ?? [];
  const periodSummary = dailyTotalsReport?.period_summary ?? {};
  const unreconciledDayCount = dailyTotalsReport?.unreconciled_day_count ?? 0;

  // One money column per tender group (default: Plastic / Cash / Other), as
  // configured per studio via reporting_tender_groups.
  const tenderGroupDefs = useMemo(() => {
    const defs = dailyTotalsReport?.tender_group_defs;
    return defs?.length ? defs : DEFAULT_TENDER_GROUP_DEFS;
  }, [dailyTotalsReport]);

  const periodTenderGroups = useMemo(
    () => tenderGroupAmounts(dailyTotalsReport?.period_summary?.tender_groups),
    [dailyTotalsReport]
  );

  const locationById = useMemo(
    () => Object.fromEntries(locations.map((l) => [l.id, l])),
    [locations]
  );

  const artistById = useMemo(
    () => Object.fromEntries(artists.map((a) => [a.id, a])),
    [artists]
  );

  // Counter / scrub staff are excluded from the artist filter and the By Artist report.
  const reportArtists = useMemo(
    () => artists.filter((a) => !isSupportStaffArtistType(a.artist_type)),
    [artists]
  );

  const supportStaffIds = useMemo(
    () =>
      new Set(
        artists.filter((a) => isSupportStaffArtistType(a.artist_type)).map((a) => a.id)
      ),
    [artists]
  );

  const visibleArtistRows = useMemo(
    () => artistRows.filter((row) => !supportStaffIds.has(row.artist_id)),
    [artistRows, supportStaffIds]
  );

  const unreconciledDays = useMemo(
    () =>
      computeUnreconciledDays({
        startDate,
        endDate,
        locationIds: locations.map((l) => l.id),
        reconciliations: reportContext?.reconciliations ?? [],
        locationId: filterLocation,
      }),
    [startDate, endDate, locations, reportContext, filterLocation]
  );

  const closedDayCount = periodSummary.closed_day_count ?? 0;

  const stripeRows = stripeReport?.rows ?? [];
  const stripeSummary = stripeReport?.summary ?? {};
  const stripeByPurpose = stripeReport?.by_purpose ?? [];
  const salesRows = salesReport?.rows ?? [];
  const salesTotalCount = salesReport?.total_count ?? 0;
  const salesTotalPages = Math.max(1, Math.ceil(salesTotalCount / SALES_PAGE_SIZE));

  const categoryItemRows = categoryItemReport?.rows ?? [];
  const categoryItemTotalCount = categoryItemReport?.total_count ?? 0;
  const categoryItemTotalPages = Math.max(
    1,
    Math.ceil(categoryItemTotalCount / CATEGORY_DETAIL_PAGE_SIZE)
  );
  const categoryItemSummary = categoryItemReport?.summary ?? {
    item_count: 0,
    gross_total: 0,
    shop_split: 0,
  };
  const categoryDetailName = categoryItemReport?.category_name || "Category";

  const paymentRows = paymentsReport?.rows ?? [];
  const paymentsByTender = paymentsReport?.by_tender ?? [];
  const paymentsSummary = paymentsReport?.summary ?? {};
  const paymentsTotalCount = paymentsReport?.total_count ?? 0;
  const paymentsTotalPages = Math.max(1, Math.ceil(paymentsTotalCount / PAYMENTS_PAGE_SIZE));

  const customerById = useMemo(
    () => Object.fromEntries(customers.map((c) => [c.id, c])),
    [customers]
  );

  const supportStaffAvailabilityHours = useMemo(() => {
    const supportArtists = artists.filter((a) => isSupportStaffArtistType(a.artist_type));
    const rows = supportArtists.map((artist) => {
      const artistRows = availabilities.filter((v) => v.artist_id === artist.id);
      const hours = sumExplicitAvailableHoursInRange(artistRows, {
        rangeStartStr: startDate,
        rangeEndStr: endDate,
        filterLocationId: filterLocation,
      });
      return { artist: artist.full_name, role: getArtistTypeLabel(artist.artist_type), hours };
    });
    rows.sort((a, b) => b.hours - a.hours || String(a.artist).localeCompare(String(b.artist)));
    return { rows, totalHours: rows.reduce((s, r) => s + r.hours, 0) };
  }, [artists, availabilities, startDate, endDate, filterLocation]);

  const showArtistFilter = activeTab === "artist" || activeTab === "sales";
  const showMultiLocationTab = locations.length > 1;

  useEffect(() => {
    if (activeTab === "location" && !showMultiLocationTab) {
      setFilters({ reportsTab: "daily" });
    }
  }, [activeTab, showMultiLocationTab, setFilters]);

  const getUserRole = () =>
    user ? normalizeUserRole(user.user_role || (user.role === "admin" ? "Admin" : "Front_Desk")) : null;
  const isAdmin = getUserRole() === "Admin" || getUserRole() === "Owner";

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 mt-1">
            Reconciliation-backed revenue summaries and real-time operational reports
          </p>
        </div>

        <Card className="bg-white border-none shadow-md">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={filterLocation} onValueChange={setFilterLocation}>
                  <SelectTrigger><SelectValue placeholder="All Locations" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Locations</SelectItem>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {showArtistFilter && (
                <div className="space-y-2">
                  <Label>Artist</Label>
                  <Select value={filterArtist} onValueChange={setFilterArtist}>
                    <SelectTrigger><SelectValue placeholder="All Artists" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Artists</SelectItem>
                      {reportArtists.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {!dateRangeValid && (
              <p className="text-sm text-red-600 mt-3">End date must be on or after start date.</p>
            )}
          </CardContent>
        </Card>

        {unreconciledDayCount > 0 && dateRangeValid && (
          <Accordion type="single" collapsible className="rounded-lg border border-amber-200 bg-amber-50">
            <AccordionItem value="unreconciled" className="border-none">
              <AccordionTrigger className="px-3 py-2 hover:no-underline [&[data-state=open]>svg]:rotate-180">
                <span className="flex items-center gap-2 text-sm text-amber-950 font-normal">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
                  {unreconciledDayCount} day{unreconciledDayCount === 1 ? "" : "s"} in this range{" "}
                  {unreconciledDayCount === 1 ? "has" : "have"} not been reconciled and{" "}
                  {unreconciledDayCount === 1 ? "is" : "are"} excluded from reconciliation-backed reports.
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3">
                <ul className="space-y-0.5 text-xs text-amber-900 list-none pl-6">
                  {unreconciledDays.slice(0, 12).map((row) => (
                    <li key={`${row.business_date}|${row.location_id}`}>
                      {row.business_date}
                      {showMultiLocationTab && (
                        <> · {locationById[row.location_id]?.name || "Unknown location"}</>
                      )}
                      {row.status === "open" ? " (open)" : " (not started)"}
                    </li>
                  ))}
                  {unreconciledDays.length > 12 && (
                    <li className="text-amber-800">…and {unreconciledDays.length - 12} more</li>
                  )}
                </ul>
                <p className="mt-2 pl-6 text-xs text-amber-900">
                  <Link to="/reconciliation" className="font-medium underline underline-offset-2">
                    Close days in Daily Reconciliation
                  </Link>{" "}
                  to include them in these reports.
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-white border-none shadow-md">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Closed days in range</p>
              <p className="text-2xl font-bold text-gray-900">{closedDayCount}</p>
            </CardContent>
          </Card>
          <Card className="bg-white border-none shadow-md">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Gross sales (reconciled)</p>
              <p className="text-2xl font-bold text-gray-900">{money(periodSummary.gross_sales)}</p>
            </CardContent>
          </Card>
          <Card className="bg-white border-none shadow-md">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Shop revenue (reconciled)</p>
              <p className="text-2xl font-bold text-indigo-700">{money(periodSummary.shop_total)}</p>
            </CardContent>
          </Card>
          <Card className="bg-white border-none shadow-md">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Tips (reconciled)</p>
              <p className="text-2xl font-bold text-indigo-700">{money(periodSummary.tip_total)}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs
          value={activeTab === "category-detail" ? "category" : activeTab}
          onValueChange={setActiveTab}
          className="space-y-6"
        >
          <TabsList className="bg-white border border-gray-200 flex flex-wrap h-auto gap-1 p-1">
            <TabsTrigger value="daily">Daily Totals</TabsTrigger>
            <TabsTrigger value="category" onClick={() => setActiveTab("category")}>
              By Category
            </TabsTrigger>
            <TabsTrigger value="artist">By Artist</TabsTrigger>
            {showMultiLocationTab && <TabsTrigger value="location">By Location</TabsTrigger>}
            <TabsTrigger value="support_staff_hours">Counter / Scrub Hours</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="stripe">Stripe Deposits</TabsTrigger>
            <TabsTrigger value="sales">Sales</TabsTrigger>
          </TabsList>

          <TabsContent value="daily">
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Daily Totals</CardTitle>
                  <p className="text-sm text-gray-500 font-normal mt-1">
                    One row per closed reconciliation day. All revenue columns include tax.
                    Gross sales = everything collected (service + tax + product, excluding tips).
                    Split columns show the shop&apos;s take net of discounts and artist splits;
                    Shop revenue = tattoo + piercing + product − refunds. The payment columns
                    break down the money collected in person that day by tender group
                    (Plastic = card terminal tenders). Stripe (online) payments are excluded —
                    see the Stripe Deposits tab.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() =>
                    exportToCSV(
                      dailyTotalsRowsToCsv(dailyRows, locationById, showMultiLocationTab, tenderGroupDefs),
                      "daily_totals"
                    )
                  }
                  disabled={dailyRows.length === 0}
                >
                  <Download className="w-4 h-4 mr-2" /> Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                {loadingDailyTotals ? (
                  <p className="text-center py-12 text-gray-500">Loading…</p>
                ) : dailyRows.length === 0 ? (
                  <div className="text-center py-12">
                    <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No closed reconciliations in this range.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Date</th>
                          {showMultiLocationTab && (
                            <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Location</th>
                          )}
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900"># Sales</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Gross sales</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Tattoo split</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Piercing split</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Product sales</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Refunds</th>
                          <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Shop revenue</th>
                          {tenderGroupDefs.map((def) => (
                            <th key={def.key} className="px-3 py-3 text-right text-sm font-semibold text-gray-900">
                              {def.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {dailyRows.map((row) => {
                          const refunds = Number(row.refunds_in_person) || 0;
                          const groupAmounts = tenderGroupAmounts(row.tender_groups);
                          return (
                            <tr key={row.reconciliation_id} className="hover:bg-gray-50">
                              <td className="px-3 py-3 text-sm">
                                <Link
                                  to={`/reconciliation/${row.reconciliation_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-indigo-700 font-medium hover:underline"
                                >
                                  {row.business_date}
                                </Link>
                              </td>
                              {showMultiLocationTab && (
                                <td className="px-3 py-3 text-sm text-gray-600">
                                  {locationById[row.location_id]?.name || "—"}
                                </td>
                              )}
                              <td className="px-3 py-3 text-sm text-gray-600 text-right">{row.sale_count}</td>
                              <td className="px-3 py-3 text-sm text-gray-900 text-right font-medium tabular-nums">
                                {money(row.gross_sales)}
                              </td>
                              <td className="px-3 py-3 text-sm text-gray-900 text-right tabular-nums">
                                {money(row.tattoo_split)}
                              </td>
                              <td className="px-3 py-3 text-sm text-gray-900 text-right tabular-nums">
                                {money(row.piercing_split)}
                              </td>
                              <td className="px-3 py-3 text-sm text-gray-900 text-right tabular-nums">
                                {money(row.product_other)}
                              </td>
                              <td className="px-3 py-3 text-sm text-amber-800 text-right tabular-nums">
                                {refunds > 0 ? `-${money(refunds)}` : money(0)}
                              </td>
                              <td className="px-3 py-3 text-sm text-indigo-800 text-right font-semibold tabular-nums">
                                {money(row.shop_total)}
                              </td>
                              {tenderGroupDefs.map((def) => (
                                <td key={def.key} className="px-3 py-3 text-sm text-gray-900 text-right tabular-nums">
                                  {money(groupAmounts[def.key])}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                        <tr>
                          <td className="px-3 py-3 text-sm font-semibold text-gray-900">Period total</td>
                          {showMultiLocationTab && <td className="px-3 py-3" />}
                          <td className="px-3 py-3 text-sm font-semibold text-gray-900 text-right">
                            {periodSummary.sale_count ?? 0}
                          </td>
                          <td className="px-3 py-3 text-sm font-semibold text-gray-900 text-right tabular-nums">
                            {money(periodSummary.gross_sales)}
                          </td>
                          <td className="px-3 py-3 text-sm font-semibold text-gray-900 text-right tabular-nums">
                            {money(periodSummary.tattoo_split)}
                          </td>
                          <td className="px-3 py-3 text-sm font-semibold text-gray-900 text-right tabular-nums">
                            {money(periodSummary.piercing_split)}
                          </td>
                          <td className="px-3 py-3 text-sm font-semibold text-gray-900 text-right tabular-nums">
                            {money(periodSummary.product_other)}
                          </td>
                          <td className="px-3 py-3 text-sm font-semibold text-amber-800 text-right tabular-nums">
                            {(Number(periodSummary.refunds_in_person) || 0) > 0
                              ? `-${money(periodSummary.refunds_in_person)}`
                              : money(0)}
                          </td>
                          <td className="px-3 py-3 text-sm font-semibold text-indigo-800 text-right tabular-nums">
                            {money(periodSummary.shop_total)}
                          </td>
                          {tenderGroupDefs.map((def) => (
                            <td key={def.key} className="px-3 py-3 text-sm font-semibold text-gray-900 text-right tabular-nums">
                              {money(periodTenderGroups[def.key])}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="category">
            {activeTab === "category-detail" ? (
              <Card className="bg-white border-none shadow-lg">
                <CardHeader>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="px-0 text-indigo-700 hover:text-indigo-900"
                        onClick={() => setActiveTab("category")}
                      >
                        <ArrowLeft className="w-4 h-4 mr-1" />
                        Back to By Category
                      </Button>
                      <CardTitle>{categoryDetailName}</CardTitle>
                      <p className="text-sm text-gray-500 font-normal">
                        Products and appointment types sold in this category on closed
                        reconciliation days. Amounts include tax. Sorted alphabetically.
                        {categoryDetailScope === "tree"
                          ? " Includes all descendant categories."
                          : ""}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="shrink-0"
                      onClick={async () => {
                        const exportData = await fetchCategoryItemReport({
                          startDate,
                          endDate,
                          locationId: filterLocation,
                          categoryKey: categoryDetailKey,
                          includeDescendants: categoryDetailScope === "tree",
                          limit: 500,
                          offset: 0,
                        });
                        exportToCSV(
                          (exportData.rows ?? []).map((row) => ({
                            item: row.item_name,
                            barcode: row.item_barcode || "",
                            count: row.item_count,
                            gross_incl_tax: row.gross_total,
                            shop_split: row.shop_split,
                          })),
                          "category_detail"
                        );
                      }}
                      disabled={categoryItemTotalCount === 0}
                    >
                      <Download className="w-4 h-4 mr-2" /> Export CSV
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {!categoryDetailKey ? (
                    <p className="text-center py-12 text-gray-500">
                      Select a category from By Category to view detail.
                    </p>
                  ) : loadingCategoryDetail ? (
                    <p className="text-center py-12 text-gray-500">Loading…</p>
                  ) : categoryItemRows.length === 0 ? (
                    <div className="text-center py-12">
                      <BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500">
                        No items sold in this category for closed days in this range.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Item</th>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Barcode</th>
                              <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Count</th>
                              <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Gross (incl. tax)</th>
                              <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Shop split</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {categoryItemRows.map((row) => (
                              <tr key={row.item_key} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm text-gray-900 font-medium">
                                  {row.item_name}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                                  {row.item_barcode || "—"}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600 text-right tabular-nums">
                                  {row.item_count}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-900 text-right font-bold tabular-nums">
                                  {money(row.gross_total)}
                                </td>
                                <td className="px-4 py-3 text-sm text-indigo-800 text-right font-semibold tabular-nums">
                                  {money(row.shop_split)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                            <tr>
                              <td className="px-4 py-3 text-sm font-semibold text-gray-900" colSpan={2}>
                                Total
                              </td>
                              <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right tabular-nums">
                                {categoryItemSummary.item_count}
                              </td>
                              <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right tabular-nums">
                                {money(categoryItemSummary.gross_total)}
                              </td>
                              <td className="px-4 py-3 text-sm font-semibold text-indigo-800 text-right tabular-nums">
                                {money(categoryItemSummary.shop_split)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      {categoryItemTotalCount > CATEGORY_DETAIL_PAGE_SIZE && (
                        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                          <p className="text-sm text-gray-500">
                            Showing {categoryDetailPage * CATEGORY_DETAIL_PAGE_SIZE + 1}–
                            {Math.min(
                              (categoryDetailPage + 1) * CATEGORY_DETAIL_PAGE_SIZE,
                              categoryItemTotalCount
                            )}{" "}
                            of {categoryItemTotalCount}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={categoryDetailPage === 0}
                              onClick={() => setCategoryDetailPage((p) => p - 1)}
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={categoryDetailPage >= categoryItemTotalPages - 1}
                              onClick={() => setCategoryDetailPage((p) => p + 1)}
                            >
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-white border-none shadow-lg">
                <CardHeader>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <CardTitle>Revenue by Category</CardTitle>
                      <p className="text-sm text-gray-500 font-normal mt-1">
                        Sum of closed reconciliation snapshots. All amounts include tax; Shop split
                        is the shop&apos;s share after artist splits. Rows follow the display order
                        set on the Categories page. Click a category to see products and services.
                      </p>
                    </div>
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
                      <Button
                        variant="outline"
                        onClick={() =>
                          exportToCSV(
                            categoryRows.map((r) => ({
                              category: r.category_name,
                              items: r.item_count,
                              gross_incl_tax: r.gross_total,
                              shop_split: r.shop_split,
                            })),
                            "revenue_by_category"
                          )
                        }
                        disabled={categoryRows.length === 0}
                      >
                        <Download className="w-4 h-4 mr-2" /> Export CSV
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {loadingCategory ? (
                    <p className="text-center py-12 text-gray-500">Loading…</p>
                  ) : categoryRows.length === 0 ? (
                    <div className="text-center py-12">
                      <BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500">No category totals for closed days in this range.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Category</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Items Sold</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Gross (incl. tax)</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Shop split</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {categoryRows.map((row) => (
                            <tr
                              key={row.category_key}
                              className="hover:bg-indigo-50 cursor-pointer"
                              onClick={() => openCategoryDetail(row)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  openCategoryDetail(row);
                                }
                              }}
                              tabIndex={0}
                              role="button"
                              aria-label={`View detail for ${row.category_name}`}
                            >
                              <td className="px-4 py-3 text-sm text-indigo-700 font-medium underline-offset-2 hover:underline">
                                {row.category_name}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600 text-right tabular-nums">{row.item_count}</td>
                              <td className="px-4 py-3 text-sm text-gray-900 text-right font-bold tabular-nums">
                                {money(row.gross_total)}
                              </td>
                              <td className="px-4 py-3 text-sm text-indigo-800 text-right font-semibold tabular-nums">
                                {money(row.shop_split)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                          <tr>
                            <td className="px-4 py-3 text-sm font-semibold text-gray-900">Total</td>
                            <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right tabular-nums">
                              {categoryRows.reduce((s, r) => s + (Number(r.item_count) || 0), 0)}
                            </td>
                            <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right tabular-nums">
                              {money(categoryRows.reduce((s, r) => s + (Number(r.gross_total) || 0), 0))}
                            </td>
                            <td className="px-4 py-3 text-sm font-semibold text-indigo-800 text-right tabular-nums">
                              {money(categoryRows.reduce((s, r) => s + (Number(r.shop_split) || 0), 0))}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="artist">
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>By Artist</CardTitle>
                  <p className="text-sm text-gray-500 font-normal mt-1">
                    From closed reconciliation snapshots. All amounts include tax; Artist owed =
                    artist share + tips.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={() =>
                    exportToCSV(
                      visibleArtistRows.map((row) => ({
                        artist: artistById[row.artist_id]?.full_name || row.artist_id || "Unassigned",
                        sale_count: row.sale_count,
                        service_incl_tax: row.service_incl_tax,
                        products_incl_tax: row.product_incl_tax,
                        tips: row.tip_total,
                        artist_share: row.artist_share,
                        shop_revenue: row.shop_revenue,
                        artist_owed: row.artist_owed,
                      })),
                      "revenue_by_artist"
                    )
                  }
                  disabled={visibleArtistRows.length === 0}
                >
                  <Download className="w-4 h-4 mr-2" /> Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                {loadingArtist ? (
                  <p className="text-center py-12 text-gray-500">Loading…</p>
                ) : visibleArtistRows.length === 0 ? (
                  <div className="text-center py-12">
                    <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No artist totals for closed days in this range.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Artist</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900"># Sales</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Service (incl. tax)</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Products (incl. tax)</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Tips</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Artist share</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Shop revenue</th>
                          <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Artist owed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {visibleArtistRows.map((row) => (
                          <tr key={row.artist_id || "unknown"} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900 font-medium">
                              {artistById[row.artist_id]?.full_name || "Unassigned"}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 text-right tabular-nums">{row.sale_count}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">
                              {money(row.service_incl_tax ?? row.service_total)}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">
                              {money(row.product_incl_tax ?? row.product_total)}
                            </td>
                            <td className="px-4 py-3 text-sm text-green-800 text-right tabular-nums">{money(row.tip_total)}</td>
                            <td className="px-4 py-3 text-sm text-green-800 text-right tabular-nums">{money(row.artist_share)}</td>
                            <td className="px-4 py-3 text-sm text-indigo-800 text-right tabular-nums">{money(row.shop_revenue)}</td>
                            <td className="px-4 py-3 text-sm text-green-800 text-right font-semibold tabular-nums">
                              {money(row.artist_owed)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {showMultiLocationTab && (
            <TabsContent value="location">
              <Card className="bg-white border-none shadow-lg">
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle>By Location</CardTitle>
                    <p className="text-sm text-gray-500 font-normal mt-1">
                      Closed reconciliation snapshots grouped by location.
                      {filterLocation !== "all" && " Showing the selected location only."}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="shrink-0"
                    onClick={() =>
                      exportToCSV(
                        locationRows.map((row) => ({
                          location: locationById[row.location_id]?.name || row.location_id,
                          closed_days: row.closed_day_count,
                          sale_count: row.sale_count,
                          sales: row.merchandise_total,
                          tax: row.tax_total,
                          discounts: row.discount_total,
                          tips: row.tip_total,
                          in_person: row.in_person_total,
                          online: row.online_total,
                          refunds: row.refunds_total,
                        })),
                        "revenue_by_location"
                      )
                    }
                    disabled={locationRows.length === 0}
                  >
                    <Download className="w-4 h-4 mr-2" /> Export CSV
                  </Button>
                </CardHeader>
                <CardContent>
                  {loadingLocation ? (
                    <p className="text-center py-12 text-gray-500">Loading…</p>
                  ) : locationRows.length === 0 ? (
                    <div className="text-center py-12">
                      <TrendingUp className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500">No location totals for closed days in this range.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Location</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Closed days</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900"># Sales</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Sales</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Tax</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Discounts</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Tips</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">In-person</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Online</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900">Refunds</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {locationRows.map((row) => (
                            <tr key={row.location_id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm text-gray-900 font-medium">
                                {locationById[row.location_id]?.name || "Unknown"}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600 text-right tabular-nums">{row.closed_day_count}</td>
                              <td className="px-4 py-3 text-sm text-gray-600 text-right tabular-nums">{row.sale_count}</td>
                              <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">{money(row.merchandise_total)}</td>
                              <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">{money(row.tax_total)}</td>
                              <td className="px-4 py-3 text-sm text-red-600 text-right tabular-nums">{money(row.discount_total)}</td>
                              <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">{money(row.tip_total)}</td>
                              <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">{money(row.in_person_total)}</td>
                              <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">{money(row.online_total)}</td>
                              <td className="px-4 py-3 text-sm text-amber-800 text-right tabular-nums">{money(row.refunds_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

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
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={() => exportToCSV(supportStaffAvailabilityHours.rows, "counter_scrub_explicit_hours")}
                  disabled={supportStaffAvailabilityHours.rows.length === 0}
                >
                  <Download className="w-4 h-4 mr-2" /> Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                {loadingAvailabilities ? (
                  <p className="text-center py-12 text-gray-500">Loading…</p>
                ) : supportStaffAvailabilityHours.rows.length === 0 ? (
                  <div className="text-center py-12">
                    <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No Counter or Scrub profiles with explicit availability in range.</p>
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
                            <td className="px-4 py-3 text-sm text-gray-900 text-right font-semibold tabular-nums">
                              {r.hours.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-gray-50 font-semibold">
                          <td colSpan={2} className="px-4 py-3 text-sm text-gray-900">Total</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">
                            {supportStaffAvailabilityHours.totalHours.toFixed(2)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments">
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-indigo-600" />
                    Payments
                  </CardTitle>
                  <p className="text-sm text-gray-500 font-normal mt-1 max-w-xl">
                    Payments captured by business date (the day the money moved). Match the
                    per-tender totals against your cash drawer and card terminal.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm whitespace-nowrap">Method</Label>
                    <Select value={filterTender} onValueChange={setFilterTender}>
                      <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Methods" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Methods</SelectItem>
                        {paymentTenderOptions.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="outline"
                    className="shrink-0"
                    onClick={async () => {
                      const exportData = await fetchPaymentsReport({
                        startDate,
                        endDate,
                        locationId: filterLocation,
                        tenderType: filterTender,
                        limit: 500,
                        offset: 0,
                      });
                      exportToCSV(
                        (exportData.rows ?? []).map((row) => ({
                          business_date: row.business_date,
                          occurred_at: row.occurred_at || row.paid_at,
                          method: row.tender_type || "",
                          channel: row.channel || "",
                          purpose: row.purpose || "",
                          amount: row.amount,
                          location: locationById[row.location_id]?.name || "",
                          sale_id: row.sale_id || "",
                          customer_name: customerById[row.customer_id]?.name || "",
                          customer_id: row.customer_id || "",
                        })),
                        "payments_reconciliation"
                      );
                    }}
                    disabled={paymentsTotalCount === 0}
                  >
                    <Download className="w-4 h-4 mr-2" /> Export CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {loadingPayments ? (
                  <p className="text-center py-12 text-gray-500">Loading…</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                        <p className="text-xs text-gray-500">Net collected</p>
                        <p className="text-xl font-bold text-gray-900">{money(paymentsSummary.net_collected)}</p>
                      </div>
                      <div className="rounded-lg border border-gray-100 p-4 bg-red-50/60">
                        <p className="text-xs text-gray-500">Refunds</p>
                        <p className="text-xl font-bold text-red-700">{money(paymentsSummary.refund_total)}</p>
                      </div>
                      <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                        <p className="text-xs text-gray-500">Payments</p>
                        <p className="text-xl font-bold text-gray-900">{paymentsSummary.payment_count ?? 0}</p>
                      </div>
                    </div>
                    {paymentsByTender.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {paymentsByTender.map((row) => (
                          <span
                            key={row.tender_type}
                            className="inline-flex items-center rounded-full bg-indigo-50 text-indigo-900 px-3 py-1 text-xs font-medium"
                          >
                            {row.tender_type}: {money(row.net_total)} ({row.payment_count})
                          </span>
                        ))}
                      </div>
                    )}
                    {paymentRows.length === 0 ? (
                      <div className="text-center py-12">
                        <CreditCard className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-500">No payments captured in this range.</p>
                      </div>
                    ) : (
                      <>
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Business date</th>
                                <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Time</th>
                                <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Customer</th>
                                <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Method</th>
                                <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Channel</th>
                                <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Purpose</th>
                                <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Amount</th>
                                <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Sale</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {paymentRows.map((row) => (
                                <tr key={row.id} className="hover:bg-gray-50">
                                  <td className="px-3 py-3 text-sm text-gray-900">{row.business_date}</td>
                                  <td className="px-3 py-3 text-sm text-gray-600">{formatDateTime(row.occurred_at || row.paid_at)}</td>
                                  <td className="px-3 py-3 text-sm text-gray-900">{customerById[row.customer_id]?.name || "—"}</td>
                                  <td className="px-3 py-3 text-sm text-gray-900 font-medium">{row.tender_type || "—"}</td>
                                  <td className="px-3 py-3 text-sm text-gray-600 capitalize">
                                    {row.channel ? row.channel.replace("_", "-") : "—"}
                                  </td>
                                  <td className="px-3 py-3 text-sm text-gray-600 capitalize">{row.purpose || "—"}</td>
                                  <td className="px-3 py-3 text-sm text-gray-900 text-right tabular-nums font-medium">{money(row.amount)}</td>
                                  <td className="px-3 py-3 text-sm text-gray-500 font-mono text-xs">{row.sale_id ? row.sale_id.slice(0, 8) : "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {paymentsTotalCount > PAYMENTS_PAGE_SIZE && (
                          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                            <p className="text-sm text-gray-500">
                              Showing {paymentsPage * PAYMENTS_PAGE_SIZE + 1}–
                              {Math.min((paymentsPage + 1) * PAYMENTS_PAGE_SIZE, paymentsTotalCount)} of {paymentsTotalCount}
                            </p>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={paymentsPage === 0}
                                onClick={() => setPaymentsPage((p) => p - 1)}
                              >
                                <ChevronLeft className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={paymentsPage >= paymentsTotalPages - 1}
                                onClick={() => setPaymentsPage((p) => p + 1)}
                              >
                                <ChevronRight className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="stripe">
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="w-5 h-5 text-indigo-600" />
                    Stripe Deposits
                  </CardTitle>
                  <p className="text-sm text-gray-500 font-normal mt-1">
                    Stripe activity by cash date; not tied to POS reconciliation.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={() =>
                    exportToCSV(
                      stripeRows.map((row) => ({
                        business_date: row.business_date,
                        occurred_at: row.occurred_at,
                        paid_at: row.paid_at,
                        amount: row.amount,
                        purpose: row.purpose,
                        appointment_id: row.appointment_id,
                        customer_name: customerById[row.customer_id]?.name || "",
                        customer_id: row.customer_id,
                        sale_id: row.sale_id,
                        stripe_payment_intent_id: row.stripe_payment_intent_id,
                      })),
                      "stripe_deposits"
                    )
                  }
                  disabled={stripeRows.length === 0}
                >
                  <Download className="w-4 h-4 mr-2" /> Export CSV
                </Button>
              </CardHeader>
              <CardContent className="space-y-6">
                {loadingStripe ? (
                  <p className="text-center py-12 text-gray-500">Loading…</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                        <p className="text-xs text-gray-500">Net collected</p>
                        <p className="text-xl font-bold text-gray-900">{money(stripeSummary.net_collected)}</p>
                      </div>
                      <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                        <p className="text-xs text-gray-500">Gross (excl. refunds)</p>
                        <p className="text-xl font-bold text-gray-900">{money(stripeSummary.gross_collected)}</p>
                      </div>
                      <div className="rounded-lg border border-gray-100 p-4 bg-red-50/60">
                        <p className="text-xs text-gray-500">Refunds</p>
                        <p className="text-xl font-bold text-red-700">{money(stripeSummary.refund_total)}</p>
                      </div>
                      <div className="rounded-lg border border-gray-100 p-4 bg-gray-50/80">
                        <p className="text-xs text-gray-500">Payments</p>
                        <p className="text-xl font-bold text-gray-900">{stripeSummary.payment_count ?? 0}</p>
                      </div>
                    </div>
                    {stripeByPurpose.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {stripeByPurpose.map((row) => (
                          <span
                            key={row.purpose}
                            className="inline-flex items-center rounded-full bg-indigo-50 text-indigo-900 px-3 py-1 text-xs font-medium"
                          >
                            {row.purpose}: {money(row.total)} ({row.payment_count})
                          </span>
                        ))}
                      </div>
                    )}
                    {stripeRows.length === 0 ? (
                      <div className="text-center py-12">
                        <Globe className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-500">No Stripe payments in this range.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Cash date</th>
                              <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Occurred</th>
                              <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Customer</th>
                              <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Purpose</th>
                              <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Amount</th>
                              <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Sale</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {stripeRows.map((row) => (
                              <tr key={row.id} className="hover:bg-gray-50">
                                <td className="px-3 py-3 text-sm text-gray-900">{row.business_date}</td>
                                <td className="px-3 py-3 text-sm text-gray-600">{formatDateTime(row.occurred_at || row.paid_at)}</td>
                                <td className="px-3 py-3 text-sm text-gray-900">{customerById[row.customer_id]?.name || "—"}</td>
                                <td className="px-3 py-3 text-sm text-gray-600 capitalize">{row.purpose || "—"}</td>
                                <td className="px-3 py-3 text-sm text-gray-900 text-right tabular-nums font-medium">{money(row.amount)}</td>
                                <td className="px-3 py-3 text-sm text-gray-500 font-mono text-xs">{row.sale_id ? row.sale_id.slice(0, 8) : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sales">
            <Card className="bg-white border-none shadow-lg">
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <ShoppingBag className="w-5 h-5 text-indigo-600" />
                    Sales
                  </CardTitle>
                  <p className="text-sm text-gray-500 font-normal mt-1">
                    Completed sales in the selected period (all types), sorted by most recent first.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={async () => {
                    const exportData = await fetchSalesReport({
                      startDate,
                      endDate,
                      locationId: filterLocation,
                      artistId: filterArtist,
                      limit: 500,
                      offset: 0,
                    });
                    exportToCSV(
                      (exportData.rows ?? []).map((row) => ({
                        timestamp: row.created_at,
                        sale_date: row.sale_date,
                        artist: artistById[row.artist_id]?.full_name || "",
                        location: locationById[row.location_id]?.name || "",
                        items: summarizeLineItems(row.lines),
                        subtotal: row.subtotal,
                        tax: row.tax_total,
                        tips: row.tip_total,
                        total: row.total,
                      })),
                      "sales_summary"
                    );
                  }}
                  disabled={salesTotalCount === 0}
                >
                  <Download className="w-4 h-4 mr-2" /> Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                {loadingSales ? (
                  <p className="text-center py-12 text-gray-500">Loading…</p>
                ) : salesRows.length === 0 ? (
                  <div className="text-center py-12">
                    <ShoppingBag className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No completed sales in this range.</p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">When</th>
                            <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Artist</th>
                            {showMultiLocationTab && (
                              <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Location</th>
                            )}
                            <th className="px-3 py-3 text-left text-sm font-semibold text-gray-900">Items</th>
                            <th className="px-3 py-3 text-right text-sm font-semibold text-gray-900">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {salesRows.map((row) => (
                            <tr
                              key={row.id}
                              className="hover:bg-gray-50 cursor-pointer"
                              onClick={() => setSelectedSaleRow(row)}
                            >
                              <td className="px-3 py-3 text-sm text-gray-900">{formatDateTime(row.created_at)}</td>
                              <td className="px-3 py-3 text-sm text-gray-600">
                                {artistById[row.artist_id]?.full_name || "Unassigned"}
                              </td>
                              {showMultiLocationTab && (
                                <td className="px-3 py-3 text-sm text-gray-600">
                                  {locationById[row.location_id]?.name || "—"}
                                </td>
                              )}
                              <td className="px-3 py-3 text-sm text-gray-600 max-w-xs truncate">
                                {summarizeLineItems(row.lines)}
                              </td>
                              <td className="px-3 py-3 text-sm text-gray-900 text-right tabular-nums font-semibold">
                                {money(row.total)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {salesTotalCount > SALES_PAGE_SIZE && (
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                        <p className="text-sm text-gray-500">
                          Showing {salesPage * SALES_PAGE_SIZE + 1}–
                          {Math.min((salesPage + 1) * SALES_PAGE_SIZE, salesTotalCount)} of {salesTotalCount}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={salesPage === 0}
                            onClick={() => setSalesPage((p) => p - 1)}
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={salesPage >= salesTotalPages - 1}
                            onClick={() => setSalesPage((p) => p + 1)}
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <SaleDetailDialog
          open={!!selectedSaleRow}
          onOpenChange={(open) => { if (!open) setSelectedSaleRow(null); }}
          sale={selectedSaleRow ? {
            id: selectedSaleRow.id,
            subtotal: selectedSaleRow.subtotal,
            tax_total: selectedSaleRow.tax_total,
            tip_total: selectedSaleRow.tip_total,
            discount_total: 0,
            total: selectedSaleRow.total,
            created_at: selectedSaleRow.created_at,
          } : null}
          lineItems={selectedSaleRow?.lines ?? []}
          payments={[]}
          customer={selectedSaleRow?.customer_id ? customerById[selectedSaleRow.customer_id] : null}
          location={selectedSaleRow?.location_id ? locationById[selectedSaleRow.location_id] : null}
          artist={selectedSaleRow?.artist_id ? artistById[selectedSaleRow.artist_id] : null}
          user={user}
          studioId={studioId}
          saleDate={selectedSaleRow?.sale_date}
        />
      </div>
    </div>
  );
}
