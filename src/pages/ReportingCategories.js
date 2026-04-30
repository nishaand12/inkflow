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
import { Tags, Plus, Trash2, Save, GripVertical } from "lucide-react";
import { normalizeUserRole } from "@/utils/roles";
import {
  CATEGORY_ROLE_REPORTING,
  CATEGORY_ROLE_APPOINTMENT_KIND,
  flattenCategoryTree,
  filterCategoriesByRole,
  getCategoryPathLabel,
} from "@/utils/reportingCategories";

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
              <h1 className="text-3xl font-bold text-gray-900">Categories</h1>
              <p className="text-gray-500 mt-1">
                Reporting hierarchy for revenue and products; appointment kinds for booking and
                calendars
              </p>
            </div>
          </div>
        </div>

        <Tabs value={roleTab} onValueChange={setRoleTab} className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <TabsList className="bg-white border border-gray-200">
              <TabsTrigger value={CATEGORY_ROLE_REPORTING}>Reporting &amp; products</TabsTrigger>
              <TabsTrigger value={CATEGORY_ROLE_APPOINTMENT_KIND}>Appointment kinds</TabsTrigger>
            </TabsList>
            <Button
              onClick={openNewDialog}
              className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 shrink-0"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add {roleTab === CATEGORY_ROLE_REPORTING ? "category" : "kind"}
            </Button>
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
              emptyLabel="No appointment kind categories — add a parent (e.g. Piercing) then sub-kinds"
              onAdd={openNewDialog}
              onRowClick={openEditDialog}
              onDelete={handleDeleteClick}
              categoryTypeLabels={categoryTypeLabels}
              categoryTypeBadgeStyles={categoryTypeBadgeStyles}
              showTypeColumn={false}
            />
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
                ? "Appointment kinds appear when creating appointment types and on the public booking page. Use sub-categories for detail (e.g. Piercing › Ear)."
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
                    ? "e.g. Ear piercings"
                    : "e.g. Tattoo services"
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
