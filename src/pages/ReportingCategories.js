import React, { useState, useEffect, useMemo } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Tags, Plus, Trash2, Save, GripVertical, CreditCard } from "lucide-react";
import { normalizeUserRole } from "@/utils/roles";
import {
  CATEGORY_ROLE_REPORTING,
  CATEGORY_ROLE_APPOINTMENT_KIND,
  flattenCategoryTree,
  filterCategoriesByRole,
  getCategoryPathLabel,
} from "@/utils/reportingCategories";
import { CHECKOUT_PAYMENT_METHOD_VALUES } from "@/utils/checkoutPaymentMethods";
import {
  DEFAULT_TENDER_GROUP_DEFS,
  resolveTenderGroup,
  resolveTenderDisplayOrder,
} from "@/utils/reportTenderGroups";

const PAYMENT_METHODS_TAB = "payment_methods";

const CUSTOM_GROUP_VALUE = "__custom__";

function customGroupKey(label) {
  return (
    String(label || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "custom"
  );
}

const categoryTypeLabels = {
  service: "Service",
  item: "Item",
  store_credit: "Store Credit",
};

const categoryTypeBadgeStyles = {
  service: "bg-blue-100 text-blue-800 border-blue-200",
  item: "bg-amber-100 text-amber-800 border-amber-200",
  store_credit: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

const revenueSignLabels = {
  positive: "Normal (positive)",
  negative: "Negative revenue",
};

function collectDescendantIds(categories, rootId) {
  const byParent = new Map();
  for (const c of categories) {
    const p = c.parent_id || "";
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(c);
  }
  const out = new Set();
  const stack = [...(byParent.get(rootId) || [])];
  while (stack.length) {
    const n = stack.pop();
    out.add(n.id);
    for (const ch of byParent.get(n.id) || []) stack.push(ch);
  }
  return out;
}

function buildParentSelectOptions(categories, role, excludeCategoryId) {
  const roleCats = filterCategoriesByRole(categories, role);
  const exclude = new Set();
  if (excludeCategoryId) {
    exclude.add(excludeCategoryId);
    for (const id of collectDescendantIds(roleCats, excludeCategoryId)) exclude.add(id);
  }
  return roleCats
    .filter((c) => !exclude.has(c.id))
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || (a.name || "").localeCompare(b.name || ""));
}

export default function ReportingCategories() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [roleTab, setRoleTab] = useState(CATEGORY_ROLE_REPORTING);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    category_type: "service",
    category_role: CATEGORY_ROLE_REPORTING,
    parent_id: "",
    clinical_profile: "",
    display_order: 0,
    is_active: true,
  });

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

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["reportingCategories", user?.studio_id],
    queryFn: async () => {
      if (!user?.studio_id) return [];
      const data = await base44.entities.ReportingCategory.filter({
        studio_id: user.studio_id,
      });
      return [...data].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
    },
    enabled: !!user?.studio_id,
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ReportingCategory.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reportingCategories"] });
      closeDialog();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ReportingCategory.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reportingCategories"] });
      closeDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ReportingCategory.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reportingCategories"] });
      setDeleteDialogOpen(false);
      setSelectedCategory(null);
    },
  });

  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(user.user_role || (user.role === "admin" ? "Admin" : "Front_Desk"));
  };
  const userRole = getUserRole();
  const isAdmin = userRole === "Admin" || userRole === "Owner";

  const defaultFormForRole = (r) => ({
    name: "",
    category_type: r === CATEGORY_ROLE_REPORTING ? "service" : "service",
    category_role: r,
    parent_id: "",
    clinical_profile: "",
    revenue_sign: "positive",
    display_order: 0,
    is_active: true,
  });

  const openNewDialog = () => {
    setSelectedCategory(null);
    const siblings = filterCategoriesByRole(categories, roleTab);
    const nextOrder =
      siblings.length > 0 ? Math.max(...siblings.map((c) => c.display_order ?? 0)) + 1 : 0;
    setFormData({
      ...defaultFormForRole(roleTab),
      category_role: roleTab,
      display_order: nextOrder,
    });
    setDialogOpen(true);
  };

  const openEditDialog = (category) => {
    setSelectedCategory(category);
    const cr = category.category_role || CATEGORY_ROLE_REPORTING;
    setFormData({
      name: category.name || "",
      category_type: category.category_type || "service",
      category_role: cr,
      parent_id: category.parent_id || "",
      clinical_profile: category.clinical_profile || "",
      revenue_sign: category.revenue_sign || "positive",
      display_order: category.display_order ?? 0,
      is_active: category.is_active !== false,
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setSelectedCategory(null);
    setFormData(defaultFormForRole(roleTab));
  };

  const handleSave = () => {
    if (!formData.name.trim()) return;

    const payload = {
      name: formData.name.trim(),
      category_type: formData.category_type,
      category_role: formData.category_role,
      display_order: formData.display_order,
      is_active: formData.is_active,
      parent_id: formData.parent_id || null,
      revenue_sign:
        formData.category_role === CATEGORY_ROLE_REPORTING
          ? formData.revenue_sign || "positive"
          : "positive",
      clinical_profile:
        formData.category_role === CATEGORY_ROLE_APPOINTMENT_KIND && formData.clinical_profile
          ? formData.clinical_profile
          : null,
    };

    if (selectedCategory) {
      updateMutation.mutate({ id: selectedCategory.id, data: payload });
    } else {
      createMutation.mutate({ ...payload, studio_id: user.studio_id });
    }
  };

  const handleDeleteClick = (e, category) => {
    e.stopPropagation();
    setSelectedCategory(category);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (selectedCategory) {
      deleteMutation.mutate(selectedCategory.id);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const parentOptions = useMemo(
    () => buildParentSelectOptions(categories, formData.category_role, selectedCategory?.id),
    [categories, formData.category_role, selectedCategory?.id]
  );

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border-none shadow-lg">
            <CardContent className="p-12 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
              <p className="text-gray-500">
                Only Owners and Admins can manage reporting categories.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex items-center gap-3">
            <Tags className="w-8 h-8 text-indigo-600" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Categories &amp; Payment Methods</h1>
              <p className="text-gray-500 mt-1">
                Reporting categories for revenue and products; booking hierarchy for appointment
                types, public booking, and calendars; payment method grouping and ordering for
                reports. Display order here controls the By Category report and reconciliation
                detail pages.
              </p>
            </div>
          </div>
        </div>

        <Tabs value={roleTab} onValueChange={setRoleTab} className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <TabsList className="bg-white border border-gray-200">
              <TabsTrigger value={CATEGORY_ROLE_REPORTING}>Reporting Categories</TabsTrigger>
              <TabsTrigger value={CATEGORY_ROLE_APPOINTMENT_KIND}>Booking Hierarchy</TabsTrigger>
              <TabsTrigger value={PAYMENT_METHODS_TAB}>Payment Methods</TabsTrigger>
            </TabsList>
            {roleTab !== PAYMENT_METHODS_TAB && (
              <Button
                onClick={openNewDialog}
                className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 shrink-0"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add {roleTab === CATEGORY_ROLE_REPORTING ? "category" : "booking category"}
              </Button>
            )}
          </div>

          <TabsContent value={CATEGORY_ROLE_REPORTING} className="mt-0">
            <CategoryTable
              isLoading={isLoading}
              treeRows={flattenCategoryTree(categories, CATEGORY_ROLE_REPORTING)}
              count={filterCategoriesByRole(categories, CATEGORY_ROLE_REPORTING).length}
              emptyLabel="No reporting categories configured"
              onAdd={openNewDialog}
              onRowClick={openEditDialog}
              onDelete={handleDeleteClick}
              categoryTypeLabels={categoryTypeLabels}
              categoryTypeBadgeStyles={categoryTypeBadgeStyles}
              showTypeColumn
            />
          </TabsContent>

          <TabsContent value={CATEGORY_ROLE_APPOINTMENT_KIND} className="mt-0">
            <CategoryTable
              isLoading={isLoading}
              treeRows={flattenCategoryTree(categories, CATEGORY_ROLE_APPOINTMENT_KIND)}
              count={filterCategoriesByRole(categories, CATEGORY_ROLE_APPOINTMENT_KIND).length}
              emptyLabel="No booking hierarchy yet — add a parent group, then sub-categories"
              onAdd={openNewDialog}
              onRowClick={openEditDialog}
              onDelete={handleDeleteClick}
              categoryTypeLabels={categoryTypeLabels}
              categoryTypeBadgeStyles={categoryTypeBadgeStyles}
              showTypeColumn={false}
            />
          </TabsContent>

          <TabsContent value={PAYMENT_METHODS_TAB} className="mt-0">
            <PaymentMethodsCard studioId={user?.studio_id} />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>
              {selectedCategory ? "Edit category" : "Add category"}
            </DialogTitle>
            <DialogDescription>
              {formData.category_role === CATEGORY_ROLE_APPOINTMENT_KIND
                ? "The booking hierarchy appears when creating appointment types and on the public booking page. Use sub-categories for detail (e.g. Body work › Consultation)."
                : "Reporting categories classify revenue, checkout lines, and products."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={
                  formData.category_role === CATEGORY_ROLE_APPOINTMENT_KIND
                    ? "e.g. Consultation block"
                    : "e.g. Retail products"
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="parent_id">Parent (optional)</Label>
              <Select
                value={formData.parent_id || "__root__"}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    parent_id: value === "__root__" ? "" : value,
                  })
                }
              >
                <SelectTrigger id="parent_id">
                  <SelectValue placeholder="Top level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">Top level</SelectItem>
                  {parentOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {getCategoryPathLabel(
                        filterCategoriesByRole(categories, formData.category_role),
                        p.id
                      ) || p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Choose a parent to create a sub-category. Revenue can be rolled up to parents in
                reports.
              </p>
            </div>
            {formData.category_role === CATEGORY_ROLE_REPORTING && (
              <div className="space-y-2">
                <Label htmlFor="category_type">Category type</Label>
                <Select
                  value={formData.category_type}
                  onValueChange={(value) =>
                    setFormData({ ...formData, category_type: value })
                  }
                >
                  <SelectTrigger id="category_type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="service">Service</SelectItem>
                    <SelectItem value="item">Item</SelectItem>
                    <SelectItem value="store_credit">Store Credit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {formData.category_role === CATEGORY_ROLE_REPORTING && (
              <div className="space-y-2">
                <Label htmlFor="revenue_sign">Revenue sign</Label>
                <Select
                  value={formData.revenue_sign || "positive"}
                  onValueChange={(value) =>
                    setFormData({ ...formData, revenue_sign: value })
                  }
                >
                  <SelectTrigger id="revenue_sign">
                    <SelectValue placeholder="Select sign" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="positive">{revenueSignLabels.positive}</SelectItem>
                    <SelectItem value="negative">{revenueSignLabels.negative}</SelectItem>
                  </SelectContent>
                </Select>
                {formData.revenue_sign === "negative" && (
                  <p className="text-xs text-amber-700">
                    Staff will enter positive amounts. The system automatically stores
                    line totals as negative revenue (e.g. gift card returns, discount coupons).
                  </p>
                )}
              </div>
            )}
            {formData.category_role === CATEGORY_ROLE_APPOINTMENT_KIND && (
              <div className="space-y-2">
                <Label htmlFor="clinical_profile">Clinical fields (optional)</Label>
                <Select
                  value={formData.clinical_profile || "__none__"}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      clinical_profile: value === "__none__" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger id="clinical_profile">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    <SelectItem value="tattoo">Tattoo (ink / cartridge lots)</SelectItem>
                    <SelectItem value="piercing">Piercing (needle / jewellery lots)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">
                  Applies to this node and descendants when editing appointments.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="display_order">Display order</Label>
              <Input
                id="display_order"
                type="number"
                value={formData.display_order}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    display_order: parseInt(e.target.value, 10) || 0,
                  })
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="is_active">Active</Label>
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_active: checked })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!formData.name.trim() || isSaving}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{selectedCategory?.name}&quot;? Child categories
              become top-level. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PaymentMethodsCard({ studioId }) {
  const queryClient = useQueryClient();

  const { data: configRows = [], isLoading } = useQuery({
    queryKey: ["tenderGroupConfig", studioId],
    queryFn: () => base44.entities.ReportingTenderGroup.filter({ studio_id: studioId }),
    enabled: !!studioId,
  });

  // Standard checkout methods first, then any extra configured tenders.
  const methodTypes = useMemo(() => {
    const extras = configRows
      .map((r) => r.tender_type)
      .filter((t) => !CHECKOUT_PAYMENT_METHOD_VALUES.includes(t))
      .sort();
    return [...CHECKOUT_PAYMENT_METHOD_VALUES, ...extras];
  }, [configRows]);

  // Effective settings per method (saved config, else built-in defaults).
  const baseline = useMemo(() => {
    const m = {};
    for (const t of methodTypes) {
      const group = resolveTenderGroup(t, configRows);
      const builtIn = DEFAULT_TENDER_GROUP_DEFS.some((d) => d.key === group.key);
      m[t] = {
        groupChoice: builtIn ? group.key : CUSTOM_GROUP_VALUE,
        customLabel: builtIn ? "" : group.label,
        displayOrder: resolveTenderDisplayOrder(t, configRows),
      };
    }
    return m;
  }, [methodTypes, configRows]);

  const [edits, setEdits] = useState(null);
  const rows = edits ?? baseline;

  const setRow = (tender, patch) =>
    setEdits((prev) => {
      const base = prev ?? baseline;
      return { ...base, [tender]: { ...base[tender], ...patch } };
    });

  const hasInvalidCustom = methodTypes.some(
    (t) => rows[t]?.groupChoice === CUSTOM_GROUP_VALUE && !String(rows[t]?.customLabel || "").trim()
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const byTender = Object.fromEntries(configRows.map((r) => [r.tender_type, r]));
      for (const tender of methodTypes) {
        const row = rows[tender];
        const isCustom = row.groupChoice === CUSTOM_GROUP_VALUE;
        const def = DEFAULT_TENDER_GROUP_DEFS.find((d) => d.key === row.groupChoice);
        const payload = {
          group_key: isCustom ? customGroupKey(row.customLabel) : row.groupChoice,
          group_label: isCustom ? row.customLabel.trim() : def.label,
          sort_order: isCustom ? 50 : def.sort,
          display_order: Number(row.displayOrder) || 0,
        };
        const existing = byTender[tender];
        if (existing) {
          await base44.entities.ReportingTenderGroup.update(existing.id, payload);
        } else {
          await base44.entities.ReportingTenderGroup.create({
            studio_id: studioId,
            tender_type: tender,
            ...payload,
          });
        }
      }
    },
    onSuccess: () => {
      setEdits(null);
      queryClient.invalidateQueries({ queryKey: ["tenderGroupConfig"] });
    },
  });

  const saveError = saveMutation.error;

  // Custom methods (not built-in) can be added and removed here; built-ins can
  // only be regrouped/reordered.
  const isBuiltIn = (tender) => CHECKOUT_PAYMENT_METHOD_VALUES.includes(tender);

  const [addOpen, setAddOpen] = useState(false);
  const [newMethodName, setNewMethodName] = useState("");
  const [methodToDelete, setMethodToDelete] = useState(null);

  const trimmedNewName = newMethodName.trim();
  const duplicateName = methodTypes.some(
    (t) => t.toLowerCase() === trimmedNewName.toLowerCase()
  );
  const stripeReserved = trimmedNewName.toLowerCase() === "stripe";
  const canAdd = !!trimmedNewName && !duplicateName && !stripeReserved;

  const addMutation = useMutation({
    mutationFn: async () => {
      const nextOrder =
        Math.max(0, ...methodTypes.map((t) => resolveTenderDisplayOrder(t, configRows))) + 10;
      await base44.entities.ReportingTenderGroup.create({
        studio_id: studioId,
        tender_type: trimmedNewName,
        group_key: "other",
        group_label: "Other",
        sort_order: 30,
        display_order: nextOrder,
      });
    },
    onSuccess: () => {
      setAddOpen(false);
      setNewMethodName("");
      queryClient.invalidateQueries({ queryKey: ["tenderGroupConfig"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (tender) => {
      const existing = configRows.find((r) => r.tender_type === tender);
      if (existing) await base44.entities.ReportingTenderGroup.delete(existing.id);
    },
    onSuccess: () => {
      setMethodToDelete(null);
      setEdits(null);
      queryClient.invalidateQueries({ queryKey: ["tenderGroupConfig"] });
    },
  });

  return (
    <Card className="bg-white border-none shadow-lg">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-xl flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-indigo-600" />
            Payment methods
          </CardTitle>
          <p className="text-sm text-gray-500 font-normal mt-1 max-w-2xl">
            Custom methods you add are selectable at checkout alongside the built-in ones.
            Report column controls which Daily Totals column each method rolls into
            (Plastic / Cash / Other, or a custom column). Display order controls where the
            method appears in payment-method lists on the reconciliation detail page.
            Stripe (online) is not listed — it is reported only under Stripe Deposits.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add method
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!edits || hasInvalidCustom || saveMutation.isPending}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-12 text-center text-gray-500">Loading payment methods...</div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_180px_1fr_110px_40px] gap-4 px-4 py-2 text-sm font-medium text-gray-500 border-b border-gray-100">
              <div>Method</div>
              <div>Report column</div>
              <div>Custom column name</div>
              <div className="text-center">Display order</div>
              <div />
            </div>
            {methodTypes.map((tender) => {
              const row = rows[tender] || {};
              const isCustom = row.groupChoice === CUSTOM_GROUP_VALUE;
              const custom = !isBuiltIn(tender);
              return (
                <div
                  key={tender}
                  className="grid grid-cols-[1fr_180px_1fr_110px_40px] gap-4 items-center px-4 py-3 rounded-lg border border-gray-100"
                >
                  <div className="font-medium text-gray-900 flex items-center gap-2">
                    {tender}
                    {custom && (
                      <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 border text-xs">
                        Custom
                      </Badge>
                    )}
                  </div>
                  <Select
                    value={row.groupChoice}
                    onValueChange={(value) => setRow(tender, { groupChoice: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DEFAULT_TENDER_GROUP_DEFS.map((d) => (
                        <SelectItem key={d.key} value={d.key}>
                          {d.label}
                        </SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_GROUP_VALUE}>Custom…</SelectItem>
                    </SelectContent>
                  </Select>
                  {isCustom ? (
                    <Input
                      value={row.customLabel}
                      placeholder="e.g. Gift cards"
                      onChange={(e) => setRow(tender, { customLabel: e.target.value })}
                    />
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
                  )}
                  <Input
                    type="number"
                    className="text-center"
                    value={row.displayOrder}
                    onChange={(e) => setRow(tender, { displayOrder: e.target.value })}
                  />
                  <div className="flex justify-center">
                    {custom && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-gray-400 hover:text-red-600 hover:bg-red-50"
                        onClick={() => setMethodToDelete(tender)}
                        aria-label={`Delete ${tender}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {hasInvalidCustom && (
              <p className="text-xs text-amber-700 px-4">
                Custom report columns need a name before saving.
              </p>
            )}
            {saveError && (
              <p className="text-xs text-red-600 px-4">
                Could not save payment method settings: {saveError.message}
              </p>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>Add payment method</DialogTitle>
            <DialogDescription>
              Adds a method staff can pick at checkout. You can set its report column and
              display order in the table after adding.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="new_method_name">Method name</Label>
            <Input
              id="new_method_name"
              value={newMethodName}
              placeholder="e.g. Gift card, Cheque"
              onChange={(e) => setNewMethodName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canAdd) addMutation.mutate();
              }}
            />
            {duplicateName && (
              <p className="text-xs text-amber-700">A method with this name already exists.</p>
            )}
            {stripeReserved && (
              <p className="text-xs text-amber-700">
                &quot;Stripe&quot; is reserved for online payments.
              </p>
            )}
            {addMutation.error && (
              <p className="text-xs text-red-600">
                Could not add method: {addMutation.error.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={!canAdd || addMutation.isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              {addMutation.isPending ? "Adding..." : "Add method"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!methodToDelete} onOpenChange={(open) => !open && setMethodToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete payment method</AlertDialogTitle>
            <AlertDialogDescription>
              Remove &quot;{methodToDelete}&quot; as a checkout option? Past payments already
              recorded with this method keep their history and continue to appear in reports.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setMethodToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate(methodToDelete)}
              className="bg-red-600 hover:bg-red-700"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function CategoryTable({
  isLoading,
  treeRows,
  count,
  emptyLabel,
  onAdd,
  onRowClick,
  onDelete,
  categoryTypeLabels,
  categoryTypeBadgeStyles,
  showTypeColumn,
}) {
  return (
    <Card className="bg-white border-none shadow-lg">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          Categories
          <span className="text-sm font-normal text-gray-500">({count})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-12 text-center text-gray-500">Loading categories...</div>
        ) : count === 0 ? (
          <div className="py-12 text-center">
            <p className="text-gray-500 mb-4">{emptyLabel}</p>
            <Button onClick={onAdd} className="bg-indigo-600 hover:bg-indigo-700">
              <Plus className="w-4 h-4 mr-2" />
              Add first category
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div
              className={`grid gap-4 px-4 py-2 text-sm font-medium text-gray-500 border-b border-gray-100 ${
                showTypeColumn
                  ? "grid-cols-[auto_1fr_auto_auto_auto_auto]"
                  : "grid-cols-[auto_1fr_auto_auto_auto]"
              }`}
            >
              <div className="w-6" />
              <div>Name</div>
              {showTypeColumn && <div className="w-28 text-center">Type</div>}
              <div className="w-20 text-center">Order</div>
              <div className="w-20 text-center">Status</div>
              <div className="w-10" />
            </div>
            {treeRows.map(({ node: category, depth }) => (
              <div
                key={category.id}
                role="button"
                tabIndex={0}
                data-testid="category-row"
                onClick={() => onRowClick(category)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(category);
                  }
                }}
                className={`grid gap-4 items-center px-4 py-3 rounded-lg border border-gray-100 hover:border-indigo-200 hover:shadow-md transition-all duration-200 cursor-pointer group ${
                  showTypeColumn
                    ? "grid-cols-[auto_1fr_auto_auto_auto_auto]"
                    : "grid-cols-[auto_1fr_auto_auto_auto]"
                }`}
              >
                <GripVertical className="w-4 h-4 text-gray-300 group-hover:text-gray-400" />
                <div
                  className="font-medium text-gray-900 min-w-0"
                  style={{ paddingLeft: depth * 16 }}
                >
                  {category.name}
                  {category.clinical_profile && (
                    <span className="text-xs font-normal text-gray-500 ml-2">
                      ({category.clinical_profile})
                    </span>
                  )}
                </div>
                {showTypeColumn && (
                  <div className="w-28 flex justify-center">
                    <Badge
                      className={`${
                        categoryTypeBadgeStyles[category.category_type] ||
                        "bg-gray-100 text-gray-800"
                      } border text-xs`}
                    >
                      {categoryTypeLabels[category.category_type] ||
                        category.category_type}
                    </Badge>
                  </div>
                )}
                <div className="w-20 text-center text-sm text-gray-600">
                  {category.display_order ?? "—"}
                </div>
                <div className="w-20 flex justify-center">
                  <Badge
                    className={
                      category.is_active !== false
                        ? "bg-green-100 text-green-800 border-green-200 border"
                        : "bg-gray-100 text-gray-500 border-gray-200 border"
                    }
                  >
                    {category.is_active !== false ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="w-10 flex justify-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => onDelete(e, category)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
