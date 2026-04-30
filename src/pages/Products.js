import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Package, Plus, Upload, Search, Trash2, Save } from "lucide-react";
import { normalizeUserRole } from "@/utils/roles";

const emptyForm = {
  name: "",
  supplier_name: "",
  supplier_sku: "",
  sku: "",
  barcode: "",
  price: "",
  cost: "",
  stock_quantity: "",
  tax_rate_percent: "13",
  reporting_category_id: "",
  is_active: true,
};

export default function Products() {
  const [searchTerm, setSearchTerm] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [importErrors, setImportErrors] = useState([]);
  const [importSuccess, setImportSuccess] = useState("");
  const [productSaveError, setProductSaveError] = useState("");
  const [user, setUser] = useState(null);
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
    } catch (error) {
      console.error("Error loading user:", error);
    }
  };

  const { data: products = [] } = useQuery({
    queryKey: ["products", user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.Product.filter({ studio_id: user.studio_id });
    },
    enabled: !!user?.studio_id,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["reportingCategories", user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      return base44.entities.ReportingCategory.filter({
        studio_id: user.studio_id,
      });
    },
    enabled: !!user?.studio_id,
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Product.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(["products"]);
      setShowDialog(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Product.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(["products"]);
      setShowDialog(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Product.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(["products"]);
      setShowDeleteDialog(false);
      setDeleteTarget(null);
    },
  });

  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(
      user.user_role || (user.role === "admin" ? "Admin" : "Front_Desk")
    );
  };

  const userRole = getUserRole();
  const isAdmin = userRole === "Admin" || userRole === "Owner";

  const filteredProducts = products.filter((p) => {
    const q = searchTerm.toLowerCase();
    return (
      p.name?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q) ||
      p.barcode?.toLowerCase().includes(q) ||
      p.supplier_name?.toLowerCase().includes(q) ||
      p.supplier_sku?.toLowerCase().includes(q)
    );
  });

  const getCategoryName = (categoryId) => {
    const cat = categories.find((c) => c.id === categoryId);
    return cat?.name || "—";
  };

  const handleNew = () => {
    setSelectedProduct(null);
    setProductSaveError("");
    setForm({ ...emptyForm, studio_id: user?.studio_id });
    setShowDialog(true);
  };

  const handleEdit = (product) => {
    setSelectedProduct(product);
    setProductSaveError("");
    const tr =
      product.tax_rate != null && !Number.isNaN(Number(product.tax_rate))
        ? (Number(product.tax_rate) * 100).toString()
        : "13";
    setForm({
      name: product.name || "",
      supplier_name: product.supplier_name || "",
      supplier_sku: product.supplier_sku || "",
      sku: product.sku || "",
      barcode: product.barcode || "",
      price: product.price ?? "",
      cost: product.cost ?? "",
      stock_quantity:
        product.stock_quantity != null ? String(product.stock_quantity) : "",
      tax_rate_percent: tr,
      reporting_category_id: product.reporting_category_id || "",
      is_active: product.is_active ?? true,
    });
    setShowDialog(true);
  };

  const handleSave = () => {
    let taxPct = parseFloat(form.tax_rate_percent);
    if (form.tax_rate_percent === "" || Number.isNaN(taxPct)) taxPct = 13;
    const tax_rate = Math.min(100, Math.max(0, taxPct)) / 100;

    const payload = {
      name: form.name,
      supplier_name: form.supplier_name?.trim() || null,
      supplier_sku: form.supplier_sku?.trim() || null,
      sku: form.sku || null,
      barcode: form.barcode || null,
      price: form.price !== "" ? parseFloat(form.price) : null,
      cost: form.cost !== "" ? parseFloat(form.cost) : null,
      stock_quantity:
        form.stock_quantity === ""
          ? null
          : Math.max(0, parseInt(form.stock_quantity, 10) || 0),
      tax_rate,
      reporting_category_id: form.reporting_category_id || null,
      is_active: form.is_active,
      studio_id: user?.studio_id,
    };

    const selectedCategory = categories.find((c) => c.id === form.reporting_category_id);
    if (selectedCategory?.category_type === "store_credit" && payload.price != null && payload.price > 1000) {
      setProductSaveError("Gift cards and store credit products cannot exceed $1,000 per unit.");
      return;
    }
    setProductSaveError("");

    if (selectedProduct) {
      updateMutation.mutate({ id: selectedProduct.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDeleteClick = (e, product) => {
    e.stopPropagation();
    setDeleteTarget(product);
    setShowDeleteDialog(true);
  };

  const parseCsv = (text) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    return lines.slice(1).map((line) => {
      const values = line.split(",").map((v) => v.trim());
      const row = {};
      headers.forEach((h, i) => {
        row[h] = values[i] || "";
      });
      return row;
    });
  };

  const handleCsvImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportErrors([]);
    setImportSuccess("");

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const rows = parseCsv(evt.target.result);
      if (rows.length === 0) {
        setImportErrors(["CSV file is empty or has no data rows."]);
        return;
      }

      const errors = [];
      const toCreate = [];

      rows.forEach((row, idx) => {
        const lineNum = idx + 2;
        if (!row.name) {
          errors.push(`Row ${lineNum}: missing product name.`);
          return;
        }

        let matchedCategoryId = null;
        if (row.category_name) {
          const match = categories.find(
            (c) => c.name?.toLowerCase() === row.category_name.toLowerCase()
          );
          if (!match) {
            errors.push(
              `Row ${lineNum}: category "${row.category_name}" not found.`
            );
            return;
          }
          matchedCategoryId = match.id;
        }

        let taxRate = 0.13;
        if (row.tax_rate !== undefined && row.tax_rate !== "") {
          const tr = parseFloat(row.tax_rate);
          if (!Number.isNaN(tr)) taxRate = tr > 1 ? tr / 100 : tr;
        } else if (row.tax_percent !== undefined && row.tax_percent !== "") {
          const tp = parseFloat(row.tax_percent);
          if (!Number.isNaN(tp)) taxRate = tp / 100;
        }

        const stockRaw = row.stock_quantity ?? row.stock ?? "";
        let stock_quantity = null;
        if (String(stockRaw).trim() !== "") {
          const s = parseInt(String(stockRaw), 10);
          if (!Number.isNaN(s)) stock_quantity = Math.max(0, s);
        }

        toCreate.push({
          name: row.name,
          supplier_name: (row.supplier_name || row.supplier || "").trim() || null,
          supplier_sku: (row.supplier_sku || "").trim() || null,
          sku: row.sku || "",
          barcode: row.barcode || "",
          price: row.price ? parseFloat(row.price) : null,
          cost: row.cost ? parseFloat(row.cost) : null,
          stock_quantity,
          tax_rate: taxRate,
          reporting_category_id: matchedCategoryId,
          is_active: true,
          studio_id: user?.studio_id,
        });
      });

      if (errors.length > 0) {
        setImportErrors(errors);
      }

      if (toCreate.length > 0) {
        try {
          for (const product of toCreate) {
            await base44.entities.Product.create(product);
          }
          queryClient.invalidateQueries(["products"]);
          setImportSuccess(`Successfully imported ${toCreate.length} product(s).`);
        } catch (err) {
          setImportErrors((prev) => [...prev, `Import error: ${err.message}`]);
        }
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Access Restricted
              </h2>
              <p className="text-gray-500">
                Only Owners and Admins can manage products.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const isSaving = createMutation.isLoading || updateMutation.isLoading;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Package className="w-8 h-8 text-indigo-600" />
              Products
            </h1>
            <p className="text-gray-500 mt-1">
              SKUs, barcodes, suppliers, tax rates, and optional stock counts
            </p>
          </div>
          <div className="flex gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleCsvImport}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="shadow-sm"
            >
              <Upload className="w-4 h-4 mr-2" />
              Import CSV
            </Button>
            <Button
              onClick={handleNew}
              className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Product
            </Button>
          </div>
        </div>

        {(importErrors.length > 0 || importSuccess) && (
          <Card className="bg-white border-none shadow-md">
            <CardContent className="p-4">
              {importSuccess && (
                <p className="text-green-700 font-medium mb-1">
                  {importSuccess}
                </p>
              )}
              {importErrors.map((err, i) => (
                <p key={i} className="text-red-600 text-sm">
                  {err}
                </p>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 text-gray-500"
                onClick={() => {
                  setImportErrors([]);
                  setImportSuccess("");
                }}
              >
                Dismiss
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="bg-white border-none shadow-md">
          <CardContent className="p-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search name, SKU, barcode, supplier..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-none shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-gray-900">
              All Products
              <span className="text-gray-400 text-sm font-normal ml-2">
                ({filteredProducts.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredProducts.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-gray-500 mb-4">No products found</p>
                <Button
                  onClick={handleNew}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add First Product
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider py-3 px-4">
                        Name
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider py-3 px-4">
                        Supplier
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider py-3 px-4">
                        SKU
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider py-3 px-4">
                        Barcode
                      </th>
                      <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider py-3 px-4">
                        Stock
                      </th>
                      <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider py-3 px-4">
                        Tax
                      </th>
                      <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider py-3 px-4">
                        Price
                      </th>
                      <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider py-3 px-4">
                        Cost
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider py-3 px-4">
                        Category
                      </th>
                      <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wider py-3 px-4">
                        Status
                      </th>
                      <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider py-3 px-4">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((product) => (
                      <tr
                        key={product.id}
                        onClick={() => handleEdit(product)}
                        className="border-b border-gray-50 hover:bg-indigo-50/50 transition-colors cursor-pointer"
                      >
                        <td className="py-3 px-4 font-medium text-gray-900">
                          {product.name}
                        </td>
                        <td className="py-3 px-4 text-gray-600 text-xs max-w-[10rem]">
                          {product.supplier_name || product.supplier_sku ? (
                            <span className="block truncate" title={[product.supplier_name, product.supplier_sku].filter(Boolean).join(" · ")}>
                              {product.supplier_name || "—"}
                              {product.supplier_sku ? (
                                <span className="block font-mono text-gray-500">
                                  {product.supplier_sku}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-3 px-4 text-gray-600 text-sm font-mono">
                          {product.sku || "—"}
                        </td>
                        <td className="py-3 px-4 text-gray-600 text-sm font-mono">
                          {product.barcode || "—"}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-700 text-sm tabular-nums">
                          {product.stock_quantity != null
                            ? product.stock_quantity
                            : "—"}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-700 text-sm tabular-nums">
                          {product.tax_rate != null
                            ? `${(Number(product.tax_rate) * 100).toFixed(2)}%`
                            : "—"}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-900">
                          {product.price != null
                            ? `$${parseFloat(product.price).toFixed(2)}`
                            : "—"}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-500">
                          {product.cost != null
                            ? `$${parseFloat(product.cost).toFixed(2)}`
                            : "—"}
                        </td>
                        <td className="py-3 px-4 text-gray-600 text-sm">
                          {getCategoryName(product.reporting_category_id)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Badge
                            className={
                              product.is_active
                                ? "bg-green-100 text-green-800"
                                : "bg-gray-100 text-gray-800"
                            }
                          >
                            {product.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={(e) => handleDeleteClick(e, product)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showDialog} onOpenChange={(v) => { setShowDialog(v); if (!v) setProductSaveError(""); }}>
        <DialogContent className="sm:max-w-lg bg-white">
          <DialogHeader>
            <DialogTitle>
              {selectedProduct ? "Edit Product" : "Add Product"}
            </DialogTitle>
            <DialogDescription>
              {selectedProduct
                ? "Update the product details below."
                : "Fill in the details for the new product."}
            </DialogDescription>
          </DialogHeader>
          {productSaveError ? (
            <p className="text-sm text-red-600 px-1 -mt-2">{productSaveError}</p>
          ) : null}
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Product Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Tattoo Aftercare Lotion"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="supplier_name">Supplier</Label>
                <Input
                  id="supplier_name"
                  value={form.supplier_name}
                  onChange={(e) =>
                    setForm({ ...form, supplier_name: e.target.value })
                  }
                  placeholder="Vendor name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplier_sku">Supplier SKU / Part #</Label>
                <Input
                  id="supplier_sku"
                  value={form.supplier_sku}
                  onChange={(e) =>
                    setForm({ ...form, supplier_sku: e.target.value })
                  }
                  placeholder="Reorder code"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sku">SKU</Label>
                <Input
                  id="sku"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="e.g. TAL-001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="barcode">Barcode</Label>
                <Input
                  id="barcode"
                  value={form.barcode}
                  onChange={(e) =>
                    setForm({ ...form, barcode: e.target.value })
                  }
                  placeholder="e.g. 012345678901"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="stock_quantity">Stock on hand</Label>
                <Input
                  id="stock_quantity"
                  type="number"
                  min="0"
                  step="1"
                  value={form.stock_quantity}
                  onChange={(e) =>
                    setForm({ ...form, stock_quantity: e.target.value })
                  }
                  placeholder="Blank = not tracked"
                />
                <p className="text-xs text-gray-500">
                  Leave blank to skip inventory. Increase when you receive a
                  shipment; it decreases at checkout.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tax_rate_percent">Tax rate (%)</Label>
                <Input
                  id="tax_rate_percent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.tax_rate_percent}
                  onChange={(e) =>
                    setForm({ ...form, tax_rate_percent: e.target.value })
                  }
                  placeholder="13"
                />
                <p className="text-xs text-gray-500">
                  Use 0 for gift cards, store credit, or other exempt items.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price">Price ($)</Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cost">Cost ($)</Label>
                <Input
                  id="cost"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: e.target.value })}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reporting Category</Label>
              <Select
                value={form.reporting_category_id}
                onValueChange={(val) =>
                  setForm({ ...form, reporting_category_id: val })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label htmlFor="is_active" className="font-medium">
                  Active
                </Label>
                <p className="text-sm text-gray-500">
                  Inactive products won't appear in sales
                </p>
              </div>
              <Switch
                id="is_active"
                checked={form.is_active}
                onCheckedChange={(checked) =>
                  setForm({ ...form, is_active: checked })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.name || isSaving}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? "Saving..." : "Save Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              product &quot;{deleteTarget?.name}&quot; from your inventory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate(deleteTarget?.id)}
              disabled={deleteMutation.isLoading}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteMutation.isLoading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
