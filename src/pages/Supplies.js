import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Search, Save, Trash2, ClipboardCheck } from "lucide-react";
import { sortByNameThenId } from "@/utils/listSort";

const STATUS_OPTIONS = [
  "In Stock",
  "Running Low",
  "Order Now",
  "Out of Stock",
  "Ordered",
];

const statusBadgeStyles = {
  "In Stock": "bg-green-100 text-green-800 border-green-200",
  "Running Low": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "Order Now": "bg-red-100 text-red-800 border-red-200",
  "Out of Stock": "bg-gray-100 text-gray-800 border-gray-200",
  "Ordered": "bg-blue-100 text-blue-800 border-blue-200",
};

const emptyForm = {
  item_name: "",
  item_description: "",
  supplier: "",
  status: "In Stock",
  notes: "",
};

export default function Supplies() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    base44.auth.me().then(setUser).catch(console.error);
  }, []);

  const { data: supplies = [] } = useQuery({
    queryKey: ["supplies", user?.studio_id],
    queryFn: () => base44.entities.Supply.filter({ studio_id: user.studio_id }),
    enabled: !!user?.studio_id,
  });

  const filtered = useMemo(() => {
    let list = sortByNameThenId(supplies, "item_name");
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.item_name?.toLowerCase().includes(q) ||
          s.supplier?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") {
      list = list.filter((s) => s.status === statusFilter);
    }
    return list;
  }, [supplies, search, statusFilter]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Supply.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplies"] });
      closeDialog();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Supply.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplies"] });
      closeDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Supply.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplies"] });
      closeDialog();
    },
  });

  const openNew = () => {
    setSelected(null);
    setForm(emptyForm);
    setShowDialog(true);
  };

  const openEdit = (item) => {
    setSelected(item);
    setForm({
      item_name: item.item_name || "",
      item_description: item.item_description || "",
      supplier: item.supplier || "",
      status: item.status || "In Stock",
      notes: item.notes || "",
    });
    setShowDialog(true);
  };

  const closeDialog = () => {
    setShowDialog(false);
    setSelected(null);
    setForm(emptyForm);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { ...form, studio_id: user?.studio_id };
    if (selected) {
      updateMutation.mutate({ id: selected.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this supply item?")) {
      deleteMutation.mutate(selected.id);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Supplies</h1>
            <p className="text-gray-500 mt-1">
              Track studio supplies and ordering status
            </p>
          </div>
          <Button
            onClick={openNew}
            className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Supply
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search by name or supplier..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-white"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px] bg-white">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card className="bg-white border-none shadow-lg overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                      Item Name
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 hidden md:table-cell">
                      Description
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                      Supplier
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 hidden lg:table-cell">
                      Notes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => openEdit(item)}
                      className="border-b border-gray-100 hover:bg-indigo-50/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {item.item_name}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 hidden md:table-cell max-w-[200px] truncate">
                        {item.item_description || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {item.supplier || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={statusBadgeStyles[item.status] || ""}
                        >
                          {item.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 hidden lg:table-cell max-w-[250px] truncate">
                        {item.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && (
              <div className="p-12 text-center">
                <ClipboardCheck className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">
                  {supplies.length === 0
                    ? "No supplies added yet"
                    : "No supplies match your search"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-xl bg-white">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              {selected ? "Edit Supply" : "Add New Supply"}
            </DialogTitle>
            <DialogDescription>
              {selected
                ? "Update supply details."
                : "Enter the details for the new supply item."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="item_name">Item Name *</Label>
              <Input
                id="item_name"
                value={form.item_name}
                onChange={(e) =>
                  setForm({ ...form, item_name: e.target.value })
                }
                required
                placeholder="e.g., Black Ink 1oz"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="item_description">Description</Label>
              <Input
                id="item_description"
                value={form.item_description}
                onChange={(e) =>
                  setForm({ ...form, item_description: e.target.value })
                }
                placeholder="e.g., Eternal Ink, matte black"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="supplier">Supplier</Label>
                <Input
                  id="supplier"
                  value={form.supplier}
                  onChange={(e) =>
                    setForm({ ...form, supplier: e.target.value })
                  }
                  placeholder="e.g., Kingpin Supply"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(val) => setForm({ ...form, status: val })}
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Any additional details..."
                rows={3}
              />
            </div>

            <DialogFooter className="flex justify-between gap-2">
              {selected && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700"
                  disabled={
                    createMutation.isPending || updateMutation.isPending
                  }
                >
                  <Save className="w-4 h-4 mr-2" />
                  {selected ? "Update" : "Create"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
