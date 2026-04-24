import React, { useState, useEffect } from "react";
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
import { Tags, Plus, Trash2, Save, GripVertical } from "lucide-react";
import { normalizeUserRole } from "@/utils/roles";

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

const defaultFormState = {
  name: "",
  category_type: "service",
  display_order: 0,
  is_active: true,
};

export default function ReportingCategories() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [formData, setFormData] = useState(defaultFormState);

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
    return normalizeUserRole(user.user_role || (user.role === 'admin' ? 'Admin' : 'Front_Desk'));
  };
  const userRole = getUserRole();
  const isAdmin = userRole === 'Admin' || userRole === 'Owner';

  const openNewDialog = () => {
    setSelectedCategory(null);
    setFormData({
      ...defaultFormState,
      display_order: categories.length > 0
        ? Math.max(...categories.map((c) => c.display_order ?? 0)) + 1
        : 0,
    });
    setDialogOpen(true);
  };

  const openEditDialog = (category) => {
    setSelectedCategory(category);
    setFormData({
      name: category.name || "",
      category_type: category.category_type || "service",
      display_order: category.display_order ?? 0,
      is_active: category.is_active !== false,
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setSelectedCategory(null);
    setFormData(defaultFormState);
  };

  const handleSave = () => {
    if (!formData.name.trim()) return;

    if (selectedCategory) {
      updateMutation.mutate({ id: selectedCategory.id, data: formData });
    } else {
      createMutation.mutate({ ...formData, studio_id: user.studio_id });
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
              <h1 className="text-3xl font-bold text-gray-900">Reporting Categories</h1>
              <p className="text-gray-500 mt-1">Manage categories used in studio reports</p>
            </div>
          </div>
          <Button
            onClick={openNewDialog}
            className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Category
          </Button>
        </div>

        <Card className="bg-white border-none shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              Categories
              <span className="text-sm font-normal text-gray-500">
                ({categories.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-12 text-center text-gray-500">Loading categories...</div>
            ) : categories.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-gray-500 mb-4">No reporting categories configured</p>
                <Button
                  onClick={openNewDialog}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add First Category
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-4 px-4 py-2 text-sm font-medium text-gray-500 border-b border-gray-100">
                  <div className="w-6" />
                  <div>Name</div>
                  <div className="w-28 text-center">Type</div>
                  <div className="w-20 text-center">Order</div>
                  <div className="w-20 text-center">Status</div>
                  <div className="w-10" />
                </div>
                {categories.map((category) => (
                  <div
                    key={category.id}
                    onClick={() => openEditDialog(category)}
                    className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-4 items-center px-4 py-3 rounded-lg border border-gray-100 hover:border-indigo-200 hover:shadow-md transition-all duration-200 cursor-pointer group"
                  >
                    <GripVertical className="w-4 h-4 text-gray-300 group-hover:text-gray-400" />
                    <div className="font-medium text-gray-900">{category.name}</div>
                    <div className="w-28 flex justify-center">
                      <Badge
                        className={`${categoryTypeBadgeStyles[category.category_type] || "bg-gray-100 text-gray-800"} border text-xs`}
                      >
                        {categoryTypeLabels[category.category_type] || category.category_type}
                      </Badge>
                    </div>
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
                        onClick={(e) => handleDeleteClick(e, category)}
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
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>
              {selectedCategory ? "Edit Category" : "Add Category"}
            </DialogTitle>
            <DialogDescription>
              {selectedCategory
                ? "Update the reporting category details below."
                : "Fill in the details to create a new reporting category."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Tattoo Services"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category_type">Category Type</Label>
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
            <div className="space-y-2">
              <Label htmlFor="display_order">Display Order</Label>
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
            <AlertDialogTitle>Delete Category</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedCategory?.name}"? This action
              cannot be undone.
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
