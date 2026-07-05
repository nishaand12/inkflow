import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/utils/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, Plus, Trash2, ScanBarcode, Package, CheckCircle, Receipt } from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  CATEGORY_ROLE_REPORTING,
  filterCategoriesByRole,
  getCategoryPathLabel,
  getLeafCategoryOptions,
} from "@/utils/reportingCategories";
import { CHECKOUT_PAYMENT_METHOD_OPTIONS } from "@/utils/checkoutPaymentMethods";
import {
  DEFAULT_SERVICE_TAX_RATE,
  computeSaleTotals,
  buildFinalizeLines,
  saleServiceProductNet,
  lineTotal,
  lineTaxRate,
  lineSign,
} from "@/utils/saleLines";
import {
  resolveRevenueSplitRule,
  isAppointmentTypeSplitEnabled,
  computeAppointmentShares,
} from "@/utils/revenueSplits";
import SaleDetailDialog from "../components/sales/SaleDetailDialog";

function getProductTaxRate(product) {
  const r = product?.tax_rate;
  if (r != null && !Number.isNaN(Number(r))) return Number(r);
  return DEFAULT_SERVICE_TAX_RATE;
}

function money(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function formatSaleTime(createdAt) {
  if (!createdAt) return "—";
  try {
    return format(parseISO(createdAt), "h:mm a");
  } catch {
    return "—";
  }
}

function summarizeLineItems(lineItems) {
  if (!lineItems.length) return "—";
  const parts = lineItems.map((li) => {
    const qty = Number(li.quantity) || 1;
    const label = li.description || "Item";
    return qty > 1 ? `${label} ×${qty}` : label;
  });
  const joined = parts.join(", ");
  return joined.length > 80 ? `${joined.slice(0, 77)}…` : joined;
}

export default function Sales() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const barcodeInputRef = useRef(null);
  const [barcodeBuffer, setBarcodeBuffer] = useState("");

  const [locationId, setLocationId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [artistId, setArtistId] = useState("");
  const [lineItems, setLineItems] = useState([]);
  const [tipAmount, setTipAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [message, setMessage] = useState(null);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualLine, setManualLine] = useState({ description: "", unit_price: "", quantity: 1, reporting_category_id: "", discount: "" });
  const [selectedSaleRow, setSelectedSaleRow] = useState(null);

  useEffect(() => {
    (async () => {
      try { setUser(await base44.auth.me()); } catch (e) { console.error(e); }
    })();
  }, []);

  const studioId = user?.studio_id;
  const today = format(new Date(), "yyyy-MM-dd");
  const qOpts = (key, fn) => ({ queryKey: [key, studioId], queryFn: () => fn(), enabled: !!studioId });

  const { data: locations = [] } = useQuery(qOpts("locations", () => base44.entities.Location.filter({ studio_id: studioId })));
  const { data: products = [] } = useQuery(qOpts("products", () => base44.entities.Product.filter({ studio_id: studioId })));
  const { data: customers = [] } = useQuery(qOpts("customers", () => base44.entities.Customer.filter({ studio_id: studioId })));
  const { data: artists = [] } = useQuery(qOpts("artists", () => base44.entities.Artist.filter({ studio_id: studioId })));
  const { data: splitRules = [] } = useQuery(qOpts("artistSplitRules", () => base44.entities.ArtistSplitRule.filter({ studio_id: studioId })));
  const { data: reportingCategories = [] } = useQuery(qOpts("reportingCategories", () => base44.entities.ReportingCategory.filter({ studio_id: studioId })));

  const { data: todaySales = [], isLoading: loadingTodaySales } = useQuery({
    queryKey: ["sales", studioId, today],
    queryFn: async () => {
      const rows = await base44.entities.Sale.filter({ studio_id: studioId, sale_date: today }, "-created_at");
      return rows.filter((s) => !s.appointment_id && s.status === "completed");
    },
    enabled: !!studioId,
    refetchInterval: 30000,
  });

  const todaySaleIdsKey = useMemo(
    () => todaySales.map((s) => s.id).sort().join(","),
    [todaySales]
  );

  const { data: todayLineItems = [] } = useQuery({
    queryKey: ["saleLineItems", studioId, todaySaleIdsKey],
    queryFn: async () => {
      const all = await base44.entities.SaleLineItem.filter({ studio_id: studioId });
      const idSet = new Set(todaySales.map((s) => s.id));
      return all.filter((li) => idSet.has(li.sale_id));
    },
    enabled: !!studioId && todaySales.length > 0,
  });

  const { data: todayPayments = [] } = useQuery({
    queryKey: ["salePayments", studioId, todaySaleIdsKey],
    queryFn: async () => {
      const all = await base44.entities.Payment.filter({ studio_id: studioId });
      const idSet = new Set(todaySales.map((s) => s.id));
      return all.filter((p) => idSet.has(p.sale_id) && p.status === "paid");
    },
    enabled: !!studioId && todaySales.length > 0,
  });

  const lineItemsBySale = useMemo(() => {
    const map = {};
    for (const li of todayLineItems) (map[li.sale_id] ||= []).push(li);
    return map;
  }, [todayLineItems]);

  const paymentBySale = useMemo(() => {
    const map = {};
    for (const p of todayPayments) {
      if (!p.sale_id || map[p.sale_id]) continue;
      map[p.sale_id] = p;
    }
    return map;
  }, [todayPayments]);

  const todaySalesRows = useMemo(
    () =>
      todaySales.map((sale) => ({
        sale,
        lineItems: lineItemsBySale[sale.id] || [],
        payment: paymentBySale[sale.id] || null,
      })),
    [todaySales, lineItemsBySale, paymentBySale]
  );

  const todaySalesTotal = useMemo(
    () => todaySales.reduce((sum, s) => sum + (Number(s.total) || 0), 0),
    [todaySales]
  );

  useEffect(() => {
    if (locations.length && !locationId) setLocationId(locations[0].id);
  }, [locations, locationId]);

  const reportingLeaves = useMemo(
    () => getLeafCategoryOptions(reportingCategories, CATEGORY_ROLE_REPORTING),
    [reportingCategories]
  );
  const reportingListForPaths = useMemo(
    () => filterCategoriesByRole(reportingCategories, CATEGORY_ROLE_REPORTING),
    [reportingCategories]
  );

  const resolveReportingCategoryName = useCallback((catId) => {
    if (!catId) return "";
    return getCategoryPathLabel(reportingListForPaths, catId) || reportingCategories.find((c) => c.id === catId)?.name || "";
  }, [reportingListForPaths, reportingCategories]);

  const getRevenueSign = useCallback((categoryId) => {
    if (!categoryId) return "positive";
    return reportingCategories.find((c) => c.id === categoryId)?.revenue_sign || "positive";
  }, [reportingCategories]);

  const addProduct = (product) => {
    const revSign = getRevenueSign(product.reporting_category_id);
    const idx = lineItems.findIndex((li) => li.product_id === product.id && li.line_type === "product");
    if (idx >= 0) {
      const updated = [...lineItems];
      updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
      setLineItems(updated);
      return;
    }
    const isVariablePrice = product.price == null || product.price === 0;
    setLineItems((prev) => [...prev, {
      _key: "prod-" + Date.now(),
      line_type: "product",
      description: product.name,
      quantity: 1,
      unit_price: isVariablePrice ? "" : product.price,
      discount_amount: 0,
      reporting_category_id: product.reporting_category_id || "",
      reporting_category_name: "",
      product_id: product.id,
      tax_rate: revSign === "negative" ? 0 : getProductTaxRate(product),
      tax_inclusive: Boolean(product?.price_includes_tax),
      revenue_sign: revSign,
    }]);
  };

  const handleBarcodeKeyDown = useCallback((e) => {
    if (e.key !== "Enter" || !barcodeBuffer.trim()) return;
    const code = barcodeBuffer.trim();
    setBarcodeBuffer("");
    const product = products.find((p) => p.is_active && (p.barcode === code || p.sku === code));
    if (product) addProduct(product);
    else {
      setMessage({ type: "error", text: `Product not found: "${code}"` });
      setTimeout(() => setMessage(null), 3000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barcodeBuffer, products, lineItems]);

  const addManualLine = () => {
    if (!manualLine.description || !manualLine.unit_price) return;
    const qty = parseInt(manualLine.quantity) || 1;
    const unit = parseFloat(manualLine.unit_price) || 0;
    const gross = qty * unit;
    const disc = Math.max(0, parseFloat(manualLine.discount) || 0);
    const revSign = getRevenueSign(manualLine.reporting_category_id);
    setLineItems((prev) => [...prev, {
      _key: "manual-" + Date.now(),
      line_type: "adjustment",
      description: manualLine.description,
      quantity: qty,
      unit_price: unit,
      discount_amount: Math.min(disc, gross),
      reporting_category_id: manualLine.reporting_category_id || "",
      reporting_category_name: "",
      product_id: null,
      tax_rate: 0,
      tax_inclusive: false,
      revenue_sign: revSign,
    }]);
    setManualLine({ description: "", unit_price: "", quantity: 1, reporting_category_id: "", discount: "" });
    setShowManualAdd(false);
  };

  const removeLine = (key) => setLineItems((prev) => prev.filter((li) => li._key !== key));
  const updateLineField = (key, field, value) =>
    setLineItems((prev) => prev.map((li) => (li._key === key ? { ...li, [field]: value } : li)));

  const totals = useMemo(() => computeSaleTotals(lineItems, tipAmount), [lineItems, tipAmount]);

  const saleMutation = useMutation({
    mutationFn: async () => {
      if (!locationId) throw new Error("Select a location.");
      if (lineItems.length === 0) throw new Error("Add at least one item.");
      const hasPositive = lineItems.some((li) => lineSign(li) > 0);
      if (!hasPositive) throw new Error("Cannot check out with only negative-revenue items.");
      if (totals.totalWithTip <= 0) throw new Error("Total must be greater than zero.");

      // Stock validation for product lines.
      for (const li of lineItems) {
        if (li.line_type === "product" && li.product_id) {
          const p = products.find((x) => x.id === li.product_id);
          if (p && p.stock_quantity != null && li.quantity > p.stock_quantity) {
            throw new Error(`Not enough stock for "${p.name}" (${p.stock_quantity} on hand).`);
          }
        }
      }

      let artistShare = 0;
      if (artistId) {
        const artist = artists.find((a) => a.id === artistId);
        const splitResolution = resolveRevenueSplitRule(splitRules, {
          appointmentTypeId: null,
          artistId,
          appointmentTypeSplitEnabled: isAppointmentTypeSplitEnabled(artist),
        });
        const { service, product } = saleServiceProductNet(lineItems);
        artistShare = computeAppointmentShares(splitResolution, { service, product }, totals.taxTotal).artistShare;
      }

      const { data, error } = await supabase.rpc("finalize_sale", {
        p_sale: {
          location_id: locationId,
          artist_id: artistId || null,
          customer_id: customerId || null,
          appointment_id: null,
          tip_total: totals.tipTotal,
          artist_share: artistShare,
        },
        p_lines: buildFinalizeLines(lineItems, resolveReportingCategoryName),
        p_payment: { tender_type: paymentMethod, channel: "in_person", amount: totals.totalWithTip },
      });
      if (error) throw new Error(error.message || "Sale failed.");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products", studioId] });
      queryClient.invalidateQueries({ queryKey: ["sales", studioId, today] });
      setLineItems([]);
      setTipAmount("");
      setCustomerId("");
      setArtistId("");
      setMessage({ type: "success", text: "Sale recorded." });
      setTimeout(() => setMessage(null), 3000);
    },
    onError: (err) => setMessage({ type: "error", text: err.message || "Sale failed." }),
  });

  const activeProducts = products.filter((p) => p.is_active);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <ShoppingCart className="w-8 h-8 text-indigo-600" /> New Sale
          </h1>
          <p className="text-gray-500 mt-1">Ring up a walk-in retail sale or gift card — no appointment required.</p>
        </div>

        <Card className="bg-white border-none shadow-md">
          <CardContent className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Location</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger><SelectValue placeholder="Location" /></SelectTrigger>
                  <SelectContent>
                    {locations.map((loc) => (<SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Customer (optional)</Label>
                <Select value={customerId || "__none__"} onValueChange={(v) => setCustomerId(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Walk-in" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Walk-in</SelectItem>
                    {customers.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Attribute to artist (optional)</Label>
                <Select value={artistId || "__none__"} onValueChange={(v) => setArtistId(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None (100% shop)</SelectItem>
                    {artists.map((a) => (<SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
              <ScanBarcode className="w-4 h-4 text-gray-400" />
              <Input
                ref={barcodeInputRef}
                value={barcodeBuffer}
                onChange={(e) => setBarcodeBuffer(e.target.value)}
                onKeyDown={handleBarcodeKeyDown}
                placeholder="Scan barcode or type SKU and press Enter"
                className="border-0 bg-transparent text-sm h-8 focus-visible:ring-0"
              />
              <Button type="button" variant="outline" size="sm" onClick={() => setShowManualAdd(!showManualAdd)}>
                <Plus className="w-3 h-3 mr-1" /> Manual item
              </Button>
            </div>

            {showManualAdd && (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-4 gap-2">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Description</Label>
                    <Input value={manualLine.description} onChange={(e) => setManualLine({ ...manualLine, description: e.target.value })} className="text-sm h-8" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Price</Label>
                    <Input type="number" min="0" step="0.01" value={manualLine.unit_price} onChange={(e) => setManualLine({ ...manualLine, unit_price: e.target.value })} className="text-sm h-8" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Disc ($)</Label>
                    <Input type="number" min="0" step="0.01" value={manualLine.discount} onChange={(e) => setManualLine({ ...manualLine, discount: e.target.value })} className="text-sm h-8" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Qty</Label>
                    <Input type="number" min="1" value={manualLine.quantity} onChange={(e) => setManualLine({ ...manualLine, quantity: e.target.value })} className="text-sm h-8" />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Category</Label>
                    <Select value={manualLine.reporting_category_id || "__none__"} onValueChange={(v) => setManualLine({ ...manualLine, reporting_category_id: v === "__none__" ? "" : v })}>
                      <SelectTrigger className="text-sm h-8"><SelectValue placeholder="Category" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {reportingLeaves.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{getCategoryPathLabel(reportingListForPaths, c.id)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button type="button" size="sm" onClick={addManualLine} className="bg-indigo-600 hover:bg-indigo-700">
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </div>
            )}

            {activeProducts.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-indigo-600 font-medium flex items-center gap-1">
                  <Package className="w-3 h-3" /> Quick add product
                </summary>
                <div className="grid grid-cols-2 gap-1 mt-2 max-h-40 overflow-y-auto">
                  {activeProducts.map((p) => (
                    <button key={p.id} type="button" onClick={() => addProduct(p)} className="text-left p-2 rounded hover:bg-indigo-50 text-xs border border-gray-100">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-gray-500 ml-1">{p.price ? `$${p.price}` : "$—"}</span>
                    </button>
                  ))}
                </div>
              </details>
            )}

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-700">Item</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700 w-16">Qty</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700 w-20">Price</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700 w-[4.5rem]">Disc</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700 w-20">Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lineItems.map((li) => {
                    const rate = lineTaxRate(li);
                    return (
                      <tr key={li._key}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900 text-xs">{li.description}</div>
                          {lineSign(li) < 0 && <span className="text-[10px] text-red-600 font-medium">Negative revenue</span>}
                          {li.tax_inclusive && rate > 0 && <span className="text-[10px] text-amber-700">Price includes tax</span>}
                        </td>
                        <td className="px-3 py-2">
                          <Input type="number" min="1" value={li.quantity} onChange={(e) => updateLineField(li._key, "quantity", parseInt(e.target.value) || 1)} className="text-xs h-7 w-14 text-right" />
                        </td>
                        <td className="px-3 py-2">
                          <Input type="number" min="0" step="0.01" value={li.unit_price} onChange={(e) => updateLineField(li._key, "unit_price", parseFloat(e.target.value) || 0)} className="text-xs h-7 w-20 text-right" />
                        </td>
                        <td className="px-3 py-2">
                          <Input type="number" min="0" step="0.01" value={li.discount_amount || ""} onChange={(e) => {
                            const gross = li.quantity * li.unit_price;
                            const d = Math.max(0, parseFloat(e.target.value) || 0);
                            updateLineField(li._key, "discount_amount", Math.min(d, gross));
                          }} placeholder="0" className="text-xs h-7 w-[4.5rem] text-right" />
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-medium">${lineTotal(li).toFixed(2)}</td>
                        <td className="px-1 py-2">
                          <button type="button" onClick={() => removeLine(li._key)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    );
                  })}
                  {lineItems.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400 text-xs">No items yet. Scan or quick-add above.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tip</Label>
                <Input type="number" min="0" step="0.01" value={tipAmount} onChange={(e) => setTipAmount(e.target.value)} placeholder="0.00" className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="Method" /></SelectTrigger>
                  <SelectContent>
                    {CHECKOUT_PAYMENT_METHOD_OPTIONS.map(({ value, label }) => (<SelectItem key={value} value={value}>{label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
              <div className="flex justify-between font-medium text-gray-800"><span>Net (pre-tax):</span><span>${totals.subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Tax:</span><span>${totals.taxTotal.toFixed(2)}</span></div>
              {totals.tipTotal > 0 && <div className="flex justify-between text-green-700"><span>Tip:</span><span>${totals.tipTotal.toFixed(2)}</span></div>}
              <div className="flex justify-between font-bold text-lg border-t border-gray-300 pt-1 mt-1"><span>Amount Due:</span><span>${totals.totalWithTip.toFixed(2)}</span></div>
            </div>

            {message && (
              <div className={`rounded-lg p-3 text-sm ${message.type === "success" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
                <p>{message.text}</p>
              </div>
            )}

            <Button type="button" className="bg-green-600 hover:bg-green-700 w-full" disabled={saleMutation.isPending} onClick={() => saleMutation.mutate()}>
              <CheckCircle className="w-4 h-4 mr-2" />
              {saleMutation.isPending ? "Processing..." : "Complete Sale"}
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-white border-none shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Receipt className="w-5 h-5 text-indigo-600" />
              Today&apos;s Sales
            </CardTitle>
            <p className="text-sm text-gray-500 font-normal">
              {todaySales.length > 0
                ? `${todaySales.length} transaction${todaySales.length === 1 ? "" : "s"} · ${money(todaySalesTotal)} total`
                : "Standalone retail transactions completed today, most recent first."}
            </p>
          </CardHeader>
          <CardContent>
            {loadingTodaySales ? (
              <p className="text-sm text-gray-500 py-4 text-center">Loading today&apos;s sales…</p>
            ) : todaySalesRows.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No sales recorded yet today.</p>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-700 w-20">Time</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Items</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700 hidden sm:table-cell">Customer</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700 hidden md:table-cell">Payment</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-700 w-24">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {todaySalesRows.map(({ sale, lineItems: items, payment }) => {
                      const customer = customers.find((c) => c.id === sale.customer_id);
                      const location = locations.find((l) => l.id === sale.location_id);
                      const artist = artists.find((a) => a.id === sale.artist_id);
                      return (
                        <tr
                          key={sale.id}
                          className="hover:bg-gray-50/80 cursor-pointer"
                          onClick={() => setSelectedSaleRow({ sale, lineItems: items, payment })}
                        >
                          <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap tabular-nums">
                            {formatSaleTime(sale.created_at)}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-xs font-medium text-gray-900">{summarizeLineItems(items)}</div>
                            <div className="text-[10px] text-gray-500 mt-0.5">
                              {[location?.name, artist?.full_name].filter(Boolean).join(" · ") || "Walk-in sale"}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-600 hidden sm:table-cell">
                            {customer?.name || "Walk-in"}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-600 hidden md:table-cell">
                            {payment?.tender_type || "—"}
                            {Number(sale.tip_total) > 0 && (
                              <span className="text-green-700 ml-1">+{money(sale.tip_total)} tip</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold text-gray-900 tabular-nums">
                            {money(sale.total)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <SaleDetailDialog
          open={!!selectedSaleRow}
          onOpenChange={(isOpen) => { if (!isOpen) setSelectedSaleRow(null); }}
          sale={selectedSaleRow?.sale}
          lineItems={selectedSaleRow?.lineItems || []}
          payment={selectedSaleRow?.payment}
          customer={customers.find((c) => c.id === selectedSaleRow?.sale?.customer_id)}
          location={locations.find((l) => l.id === selectedSaleRow?.sale?.location_id)}
          artist={artists.find((a) => a.id === selectedSaleRow?.sale?.artist_id)}
          user={user}
          studioId={studioId}
          saleDate={today}
        />
      </div>
    </div>
  );
}
