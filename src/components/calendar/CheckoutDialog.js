import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, Plus, Trash2, ScanBarcode, Package } from "lucide-react";
import { supabase } from "@/utils/supabase";
import {
  CATEGORY_ROLE_REPORTING,
  filterCategoriesByRole,
  getCategoryPathLabel,
  getLeafCategoryOptions,
} from "@/utils/reportingCategories";
import { CHECKOUT_PAYMENT_METHOD_OPTIONS } from "@/utils/checkoutPaymentMethods";
import { formatTimeRange12h } from "@/utils/index";

const LEGACY_PAYMENT_METHOD_MAP = {
  Card: "Other",
  POS: "Other",
  "POS Terminal": "Other",
};

function normalizePaymentMethodForSelect(raw) {
  if (!raw) return "";
  if (raw === "Stripe") return "";
  return LEGACY_PAYMENT_METHOD_MAP[raw] || raw;
}

const DEFAULT_SERVICE_TAX_RATE = 0.13;

function aggregateProductCheckoutQuantities(lineItems) {
  const map = new Map();
  for (const li of lineItems) {
    if (li.line_type === "product" && li.product_id) {
      map.set(li.product_id, (map.get(li.product_id) || 0) + (li.quantity || 0));
    }
  }
  return [...map.entries()].map(([product_id, quantity]) => ({ product_id, quantity }));
}

function getProductTaxRate(product) {
  const r = product?.tax_rate;
  if (r != null && !Number.isNaN(Number(r))) return Number(r);
  return DEFAULT_SERVICE_TAX_RATE;
}

function productPriceIncludesTax(product) {
  return Boolean(product?.price_includes_tax);
}

function lineAmountAfterDiscount(li) {
  return Math.max(0, li.quantity * li.unit_price - (li.discount_amount || 0));
}

function isNegativeRevenueLine(li) {
  return li._revenue_sign === 'negative';
}

function resolveLineTaxRate(li) {
  let rate = li.tax_rate;
  if (rate == null || Number.isNaN(Number(rate))) {
    rate = li.line_type === "service" ? DEFAULT_SERVICE_TAX_RATE : 0;
  }
  return Number(rate);
}

/** Pre-tax net (appointment charge_amount is sum of these). */
function linePreTaxNet(li) {
  const gross = lineAmountAfterDiscount(li);
  const rate = resolveLineTaxRate(li);
  if (rate <= 0) return gross;
  if (li.tax_inclusive) return gross / (1 + rate);
  return gross;
}

function lineTaxAmount(li) {
  const gross = lineAmountAfterDiscount(li);
  const rate = resolveLineTaxRate(li);
  if (rate <= 0) return 0;
  if (li.tax_inclusive) return gross - gross / (1 + rate);
  return gross * rate;
}

function parseMoneyInput(value) {
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

/** Prefer saved charge, then appointment estimate, then type service_cost for piercing-style pricing. */
function initialServiceLineUnitPrice(appointment, aptType) {
  const charge = parseFloat(appointment?.charge_amount);
  if (!Number.isNaN(charge) && charge > 0) return charge;
  const estimate = parseFloat(appointment?.total_estimate);
  if (!Number.isNaN(estimate) && estimate > 0) return estimate;
  const svc = aptType?.service_cost != null ? Number(aptType.service_cost) : NaN;
  if (!Number.isNaN(svc) && svc > 0) return svc;
  return 0;
}

export default function CheckoutDialog({ open, onOpenChange, appointment, artists, locations, appointmentTypes, customers, studio }) {
  const queryClient = useQueryClient();
  const barcodeInputRef = useRef(null);
  const [barcodeBuffer, setBarcodeBuffer] = useState('');

  const [lineItems, setLineItems] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [tipAmount, setTipAmount] = useState('');
  const [checkoutMessage, setCheckoutMessage] = useState(null);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualLine, setManualLine] = useState({ description: '', unit_price: '', quantity: 1, reporting_category_id: '', discount: '' });

  const { data: products = [] } = useQuery({
    queryKey: ['products', studio?.id],
    queryFn: () => base44.entities.Product.filter({ studio_id: studio.id }),
    enabled: open && !!studio?.id
  });

  const { data: reportingCategories = [] } = useQuery({
    queryKey: ['reportingCategories', studio?.id],
    queryFn: () => base44.entities.ReportingCategory.filter({ studio_id: studio.id }),
    enabled: open && !!studio?.id
  });

  const reportingLeaves = useMemo(
    () => getLeafCategoryOptions(reportingCategories, CATEGORY_ROLE_REPORTING),
    [reportingCategories]
  );

  const reportingListForPaths = useMemo(
    () => filterCategoriesByRole(reportingCategories, CATEGORY_ROLE_REPORTING),
    [reportingCategories]
  );

  useEffect(() => {
    if (appointment && open) {
      const initialLines = [];
      const aptType = appointmentTypes?.find(t => t.id === appointment.appointment_type_id);
      if (aptType) {
        const legacyDisc = parseFloat(appointment.discount_amount) || 0;
        initialLines.push({
          _key: 'service-' + Date.now(),
          line_type: 'service',
          description: aptType.name,
          quantity: 1,
          unit_price: initialServiceLineUnitPrice(appointment, aptType),
          discount_amount: legacyDisc > 0 ? legacyDisc : 0,
          reporting_category_id: aptType.reporting_category_id || '',
          reporting_category_name: '',
          product_id: null,
          tax_rate: DEFAULT_SERVICE_TAX_RATE,
          tax_inclusive: Boolean(aptType?.price_includes_tax),
        });
      }
      setLineItems(initialLines);
      setPaymentMethod(normalizePaymentMethodForSelect(appointment.payment_method));
      setTipAmount(appointment.tip_amount ? String(appointment.tip_amount) : '');
      setCheckoutMessage(null);
      setShowManualAdd(false);
      setManualLine({ description: '', unit_price: '', quantity: 1, reporting_category_id: '', discount: '' });
    }
  }, [appointment, open, appointmentTypes]);

  useEffect(() => {
    if (open && barcodeInputRef.current) {
      const t = setTimeout(() => barcodeInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  const resolveReportingCategoryName = (catId) => {
    if (!catId) return '';
    return getCategoryPathLabel(reportingListForPaths, catId) || reportingCategories.find(c => c.id === catId)?.name || '';
  };

  const handleBarcodeKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && barcodeBuffer.trim()) {
      const code = barcodeBuffer.trim();
      setBarcodeBuffer('');

      const product = products.find(
        p => p.is_active && (p.barcode === code || p.sku === code)
      );

      if (product) {
        const existingIdx = lineItems.findIndex(
          li => li.product_id === product.id && li.line_type === 'product'
        );
        const revSign = reportingCategories.find(c => c.id === product.reporting_category_id)?.revenue_sign || 'positive';

        if (existingIdx >= 0) {
          const updated = [...lineItems];
          updated[existingIdx] = {
            ...updated[existingIdx],
            quantity: updated[existingIdx].quantity + 1,
            tax_rate: getProductTaxRate(product),
            tax_inclusive: productPriceIncludesTax(product),
          };
          setLineItems(updated);
        } else {
          const isVariablePrice = product.price == null || product.price === 0;
          setLineItems(prev => [...prev, {
            _key: 'prod-' + Date.now(),
            line_type: 'product',
            description: product.name,
            quantity: 1,
            unit_price: isVariablePrice ? '' : product.price,
            discount_amount: 0,
            reporting_category_id: product.reporting_category_id || '',
            reporting_category_name: '',
            product_id: product.id,
            tax_rate: revSign === 'negative' ? 0 : getProductTaxRate(product),
            tax_inclusive: productPriceIncludesTax(product),
            _revenue_sign: revSign,
          }]);
        }
      } else {
        setCheckoutMessage({ type: 'error', text: `Product not found: "${code}"` });
        setTimeout(() => setCheckoutMessage(null), 3000);
      }
    }
  }, [barcodeBuffer, products, lineItems, reportingCategories]);

  const getRevenueSign = (categoryId) => {
    if (!categoryId) return 'positive';
    const cat = reportingCategories.find(c => c.id === categoryId);
    return cat?.revenue_sign || 'positive';
  };

  const addManualLine = () => {
    if (!manualLine.description || !manualLine.unit_price) return;
    const qty = parseInt(manualLine.quantity) || 1;
    const unit = parseFloat(manualLine.unit_price) || 0;
    const gross = qty * unit;
    const disc = Math.max(0, parseFloat(manualLine.discount) || 0);
    const revSign = getRevenueSign(manualLine.reporting_category_id);
    setLineItems(prev => [...prev, {
      _key: 'manual-' + Date.now(),
      line_type: 'adjustment',
      description: manualLine.description,
      quantity: qty,
      unit_price: unit,
      discount_amount: Math.min(disc, gross),
      reporting_category_id: manualLine.reporting_category_id || '',
      reporting_category_name: '',
      product_id: null,
      tax_rate: revSign === 'negative' ? 0 : 0,
      tax_inclusive: false,
      _revenue_sign: revSign,
    }]);
    setManualLine({ description: '', unit_price: '', quantity: 1, reporting_category_id: '', discount: '' });
    setShowManualAdd(false);
  };

  const addProductFromList = (product) => {
    const existingIdx = lineItems.findIndex(
      li => li.product_id === product.id && li.line_type === 'product'
    );
    const revSign = getRevenueSign(product.reporting_category_id);
    if (existingIdx >= 0) {
      const updated = [...lineItems];
      updated[existingIdx] = {
        ...updated[existingIdx],
        quantity: updated[existingIdx].quantity + 1,
        tax_rate: getProductTaxRate(product),
        tax_inclusive: productPriceIncludesTax(product),
      };
      setLineItems(updated);
    } else {
      const isVariablePrice = product.price == null || product.price === 0;
      setLineItems(prev => [...prev, {
        _key: 'prod-' + Date.now(),
        line_type: 'product',
        description: product.name,
        quantity: 1,
        unit_price: isVariablePrice ? '' : product.price,
        discount_amount: 0,
        reporting_category_id: product.reporting_category_id || '',
        reporting_category_name: '',
        product_id: product.id,
        tax_rate: revSign === 'negative' ? 0 : getProductTaxRate(product),
        tax_inclusive: productPriceIncludesTax(product),
        _revenue_sign: revSign,
      }]);
    }
  };

  const removeLine = (key) => {
    setLineItems(prev => prev.filter(li => li._key !== key));
  };

  const updateLineField = (key, field, value) => {
    setLineItems(prev => prev.map(li => li._key === key ? { ...li, [field]: value } : li));
  };

  const getStockValidationError = () => {
    const totals = aggregateProductCheckoutQuantities(lineItems);
    for (const { product_id, quantity } of totals) {
      const p = products.find((x) => x.id === product_id);
      if (!p || p.stock_quantity == null) continue;
      if (quantity > p.stock_quantity) {
        return `Not enough stock for "${p.name}" (${p.stock_quantity} on hand, ${quantity} in cart).`;
      }
    }
    return null;
  };

  const lineSubtotal = lineItems.reduce((sum, li) => sum + linePreTaxNet(li), 0);

  const grossBeforeLineDiscounts = lineItems.reduce(
    (sum, li) => sum + li.quantity * li.unit_price,
    0
  );

  const computedTax = lineItems.reduce((sum, li) => sum + lineTaxAmount(li), 0);

  const depositOnFile = appointment?.deposit_amount || 0;
  /** Only reduce balance when deposit was actually collected (walk-ins often have no paid deposit). */
  const depositCredited =
    appointment?.deposit_status === "paid" ? depositOnFile : 0;
  const lineDiscountsTotal = lineItems.reduce((sum, li) => sum + (li.discount_amount || 0), 0);
  const grandTotal = lineSubtotal + computedTax;
  const tipTotal = parseMoneyInput(tipAmount);
  const amountDueBeforeTip = Math.max(0, grandTotal - depositCredited);
  const amountDue = amountDueBeforeTip + tipTotal;

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const stockErr = getStockValidationError();
      if (stockErr) throw new Error(stockErr);

      const hasOnlyNegativeLines = lineItems.every(li => isNegativeRevenueLine(li));
      if (hasOnlyNegativeLines && lineItems.length > 0) {
        throw new Error('Cannot check out with only negative-revenue items.');
      }
      if (lineSubtotal + computedTax + tipTotal <= 0 && !lineItems.some(li => isNegativeRevenueLine(li))) {
        throw new Error('Total must be greater than zero.');
      }

      const taxTotal = lineItems.reduce((sum, li) => sum + lineTaxAmount(li), 0);

      const chargePromises = lineItems.map(li => {
        const rawTotal = (li.quantity * li.unit_price) - (li.discount_amount || 0);
        const lineTotal = isNegativeRevenueLine(li) ? -Math.abs(rawTotal) : rawTotal;
        return base44.entities.AppointmentCharge.create({
          studio_id: studio.id,
          appointment_id: appointment.id,
          line_type: li.line_type,
          reporting_category_id: li.reporting_category_id || null,
          reporting_category_name: resolveReportingCategoryName(li.reporting_category_id),
          product_id: li.product_id || null,
          description: li.description,
          quantity: li.quantity,
          unit_price: li.unit_price,
          discount_amount: li.discount_amount || 0,
          line_total: lineTotal
        });
      });
      await Promise.all(chargePromises);

      const stockLines = aggregateProductCheckoutQuantities(
        lineItems.filter(li => !isNegativeRevenueLine(li))
      );
      if (stockLines.length > 0) {
        const { error: rpcErr } = await supabase.rpc('apply_product_checkout_stock', {
          p_lines: stockLines,
        });
        if (rpcErr) throw new Error(rpcErr.message || 'Could not update inventory.');
      }

      await base44.entities.Appointment.update(appointment.id, {
        status: 'completed',
        charge_amount: lineSubtotal,
        tax_amount: taxTotal,
        tip_amount: tipTotal,
        discount_amount: lineItems.reduce((s, li) => s + (li.discount_amount || 0), 0),
        payment_method: paymentMethod || null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['appointmentCharges'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      if (studio?.id) {
        queryClient.invalidateQueries({ queryKey: ['products', studio.id] });
      }
      onOpenChange(false);
    },
    onError: (err) => {
      setCheckoutMessage({ type: 'error', text: err.message || 'Checkout failed.' });
    },
  });

  const handleManualCheckout = (e) => {
    e.preventDefault();
    checkoutMutation.mutate();
  };

  if (!appointment) return null;

  const artist = artists?.find(a => a.id === appointment.artist_id);
  const appointmentType = appointmentTypes?.find(t => t.id === appointment.appointment_type_id);
  const customer = customers?.find(c => c.id === appointment.customer_id);
  const clientName = customer?.name || appointment.client_name || 'Unknown';
  const activeProducts = products.filter(p => p.is_active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-white max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl font-bold flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            Check Out Appointment
          </DialogTitle>
          <DialogDescription className="text-sm">
            Apply per-line discounts (before tax), then complete payment. A paid deposit reduces the balance; unpaid deposits do not.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 sm:space-y-5">
          <div className="bg-gray-50 rounded-lg p-3 sm:p-4 space-y-2">
            <h3 className="font-semibold text-gray-900 text-sm mb-2">Appointment Summary</h3>
            <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm">
              <div>
                <span className="text-gray-500">Client:</span>
                <p className="font-medium truncate">{clientName}</p>
              </div>
              <div>
                <span className="text-gray-500">Artist:</span>
                <p className="font-medium truncate">{artist?.full_name || 'Unknown'}</p>
              </div>
              <div>
                <span className="text-gray-500">Date:</span>
                <p className="font-medium">{appointment.appointment_date}</p>
              </div>
              <div>
                <span className="text-gray-500">Time:</span>
                <p className="font-medium">
                  {appointment.is_all_day
                    ? "All day"
                    : formatTimeRange12h(appointment.start_time, appointment.end_time)}
                </p>
              </div>
              <div>
                <span className="text-gray-500">Service:</span>
                <p className="font-medium truncate">{appointmentType?.name || 'No Type'}</p>
              </div>
              <div>
                <span className="text-gray-500">Deposit:</span>
                <div className="flex items-center gap-1 flex-wrap">
                  <p className="font-medium">${depositOnFile.toFixed(2)}</p>
                  {appointment.deposit_status === 'paid' && (
                    <span className="text-[10px] bg-green-100 text-green-800 px-1 rounded">Paid</span>
                  )}
                  {depositOnFile > 0 && appointment.deposit_status !== 'paid' && (
                    <span className="text-[10px] text-amber-800 bg-amber-50 px-1 rounded">Not credited</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">Line Items</h3>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowManualAdd(!showManualAdd)}>
                  <Plus className="w-3 h-3 mr-1" /> Add Item
                </Button>
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
            </div>

            {showManualAdd && (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-4 gap-2">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Description</Label>
                    <Input
                      value={manualLine.description}
                      onChange={(e) => setManualLine({ ...manualLine, description: e.target.value })}
                      placeholder="Item description"
                      className="text-sm h-8"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Price</Label>
                    <Input
                      type="number" min="0" step="0.01"
                      value={manualLine.unit_price}
                      onChange={(e) => setManualLine({ ...manualLine, unit_price: e.target.value })}
                      placeholder="0.00"
                      className="text-sm h-8"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Disc ($)</Label>
                    <Input
                      type="number" min="0" step="0.01"
                      value={manualLine.discount}
                      onChange={(e) => setManualLine({ ...manualLine, discount: e.target.value })}
                      placeholder="0"
                      className="text-sm h-8"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Qty</Label>
                    <Input
                      type="number" min="1"
                      value={manualLine.quantity}
                      onChange={(e) => setManualLine({ ...manualLine, quantity: e.target.value })}
                      className="text-sm h-8"
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Category</Label>
                    <Select
                      value={manualLine.reporting_category_id || '__none__'}
                      onValueChange={(v) => setManualLine({ ...manualLine, reporting_category_id: v === '__none__' ? '' : v })}
                    >
                      <SelectTrigger className="text-sm h-8"><SelectValue placeholder="Category" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {reportingLeaves.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {getCategoryPathLabel(reportingListForPaths, c.id)}
                          </SelectItem>
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
                <div className="grid grid-cols-2 gap-1 mt-2 max-h-32 overflow-y-auto">
                  {activeProducts.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addProductFromList(p)}
                      className="text-left p-2 rounded hover:bg-indigo-50 transition-colors text-xs border border-gray-100"
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="text-gray-500 ml-1">{p.price ? `$${p.price}` : '$—'}</span>
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
                  {lineItems.map(li => {
                    const lineAfterDisc = lineAmountAfterDiscount(li);
                    const rate = resolveLineTaxRate(li);
                    return (
                      <tr key={li._key}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900 text-xs">{li.description}</div>
                          {isNegativeRevenueLine(li) && (
                            <span className="text-[10px] text-red-600 font-medium">Negative revenue</span>
                          )}
                          {li.tax_inclusive && rate > 0 && (
                            <span className="text-[10px] text-amber-700">Price includes tax</span>
                          )}
                          {!li.tax_inclusive && rate > 0 && li.line_type !== "adjustment" && (
                            <span className="text-[10px] text-gray-500">Tax added at total</span>
                          )}
                          {li.reporting_category_id && (
                            <span className="text-[10px] text-gray-400">
                              {resolveReportingCategoryName(li.reporting_category_id)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number" min="1"
                            value={li.quantity}
                            onChange={(e) => updateLineField(li._key, 'quantity', parseInt(e.target.value) || 1)}
                            className="text-xs h-7 w-14 text-right"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number" min="0" step="0.01"
                            value={li.unit_price}
                            onChange={(e) => updateLineField(li._key, 'unit_price', parseFloat(e.target.value) || 0)}
                            className="text-xs h-7 w-20 text-right"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number" min="0" step="0.01"
                            value={li.discount_amount || ''}
                            onChange={(e) => {
                              const gross = li.quantity * li.unit_price;
                              const d = Math.max(0, parseFloat(e.target.value) || 0);
                              updateLineField(li._key, 'discount_amount', Math.min(d, gross));
                            }}
                            placeholder="0"
                            className="text-xs h-7 w-[4.5rem] text-right"
                          />
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-medium">${lineAfterDisc.toFixed(2)}</td>
                        <td className="px-1 py-2">
                          <button type="button" onClick={() => removeLine(li._key)} className="text-gray-400 hover:text-red-500">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {lineItems.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-gray-400 text-xs">
                        No line items. Add a service or product above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Tax</Label>
              <div className="text-sm font-medium tabular-nums border rounded-md px-2 py-1.5 bg-gray-50">
                ${computedTax.toFixed(2)}
              </div>
              <p className="text-[10px] text-gray-500 leading-snug">
                Per line after that line&apos;s discount. Service lines use {DEFAULT_SERVICE_TAX_RATE * 100}% unless exempt;
                products use their own rate. <strong>Tax-inclusive</strong> lines include tax in the price (tax shown is extracted);
                <strong> tax-exclusive</strong> adds tax on top. Manual items use 0% tax.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tip</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={tipAmount}
                onChange={(e) => setTipAmount(e.target.value)}
                placeholder="0.00"
                className="text-sm"
              />
              <p className="text-[10px] text-gray-500 leading-snug">
                Tips are not taxed or split with the studio; they are owed 100% to the assigned artist.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="text-sm"><SelectValue placeholder="Method" /></SelectTrigger>
                <SelectContent>
                  {CHECKOUT_PAYMENT_METHOD_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal (before discounts):</span><span>${grossBeforeLineDiscounts.toFixed(2)}</span></div>
            {lineDiscountsTotal > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Line discounts:</span>
                <span>-${lineDiscountsTotal.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-medium text-gray-800"><span>Net (pre-tax):</span><span>${lineSubtotal.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Tax:</span><span>${computedTax.toFixed(2)}</span></div>
            {tipTotal > 0 && (
              <div className="flex justify-between text-green-700">
                <span>Tip to artist:</span>
                <span>${tipTotal.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold border-t border-gray-200 pt-1 mt-1"><span>Total before tip:</span><span>${grandTotal.toFixed(2)}</span></div>
            {depositCredited > 0 && (
              <div className="flex justify-between text-green-700"><span>Paid deposit applied:</span><span>-${depositCredited.toFixed(2)}</span></div>
            )}
            <div className="flex justify-between font-bold text-lg border-t border-gray-300 pt-1 mt-1">
              <span>Amount Due:</span><span>${amountDue.toFixed(2)}</span>
            </div>
          </div>

          {checkoutMessage && (
            <div className={`rounded-lg p-3 text-sm ${
              checkoutMessage.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              <p>{checkoutMessage.text}</p>
            </div>
          )}

          <div className="flex flex-col gap-2 pt-4 border-t border-gray-100">
            <Button
              type="button"
              className="bg-green-600 hover:bg-green-700 w-full"
              disabled={checkoutMutation.isPending}
              onClick={handleManualCheckout}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              {checkoutMutation.isPending ? 'Processing...' : 'Manual Checkout'}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="w-full">
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
