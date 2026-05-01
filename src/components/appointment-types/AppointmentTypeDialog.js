import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Save, Trash2 } from "lucide-react";
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

import { APPOINTMENT_CATEGORIES, PIERCING_CATEGORIES, formatDuration } from "@/utils/index";
import {
  CATEGORY_ROLE_APPOINTMENT_KIND,
  CATEGORY_ROLE_REPORTING,
  getLeafCategoryOptions,
  getCategoryPathLabel,
  findCategoryById,
  filterCategoriesByRole,
  isPiercingClinicalProfile,
} from "@/utils/reportingCategories";

const DURATION_PRESETS = [10, 15, 20, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360];

const DEFAULT_FORM = {
  appointment_kind_category_id: "",
  category: "Tattoo",
  name: "",
  description: "",
  default_duration_minutes: 120,
  default_deposit: 10,
  service_cost: "",
  is_active: true,
  is_public_bookable: false,
  reporting_category_id: "",
};

export default function AppointmentTypeDialog({ open, onOpenChange, appointmentType, currentUser }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState(DEFAULT_FORM);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);

  const { data: reportingCategories = [] } = useQuery({
    queryKey: ["reportingCategories", currentUser?.studio_id],
    queryFn: async () => {
      if (!currentUser?.studio_id) return [];
      return base44.entities.ReportingCategory.filter({ studio_id: currentUser.studio_id });
    },
    enabled: open && !!currentUser?.studio_id,
  });

  const appointmentKindLeaves = useMemo(
    () => getLeafCategoryOptions(reportingCategories, CATEGORY_ROLE_APPOINTMENT_KIND),
    [reportingCategories]
  );

  const reportingLeaves = useMemo(
    () => getLeafCategoryOptions(reportingCategories, CATEGORY_ROLE_REPORTING),
    [reportingCategories]
  );

  const useConfigurableKinds = appointmentKindLeaves.length > 0;

  useEffect(() => {
    if (appointmentType) {
      setFormData({
        appointment_kind_category_id: appointmentType.appointment_kind_category_id || "",
        category: appointmentType.category || "Tattoo",
        name: appointmentType.name || "",
        description: appointmentType.description || "",
        default_duration_minutes: appointmentType.default_duration_minutes || 120,
        default_deposit: appointmentType.default_deposit ?? 10,
        service_cost: appointmentType.service_cost ?? "",
        is_active: appointmentType.is_active !== undefined ? appointmentType.is_active : true,
        is_public_bookable: appointmentType.is_public_bookable || false,
        reporting_category_id: appointmentType.reporting_category_id || "",
      });
    } else {
      setFormData(DEFAULT_FORM);
    }
  }, [appointmentType, open]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.AppointmentType.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointmentTypes"] });
      onOpenChange(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AppointmentType.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointmentTypes"] });
      onOpenChange(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.AppointmentType.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointmentTypes"] });
      onOpenChange(false);
    },
  });

  const kindSelectValue = useMemo(() => {
    if (useConfigurableKinds) {
      return formData.appointment_kind_category_id || "__legacy__";
    }
    return formData.category || "Tattoo";
  }, [useConfigurableKinds, formData.appointment_kind_category_id, formData.category]);

  const handleKindChange = (value) => {
    if (useConfigurableKinds) {
      if (value === "__legacy__") {
        setFormData((prev) => ({
          ...prev,
          appointment_kind_category_id: "",
          category: prev.category || "Tattoo",
        }));
        return;
      }
      const leaf = findCategoryById(appointmentKindLeaves, value);
      setFormData((prev) => ({
        ...prev,
        appointment_kind_category_id: value,
        category: leaf?.name || prev.category,
      }));
      return;
    }
    setFormData((prev) => ({ ...prev, category: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const submitData = {
      ...formData,
      studio_id: currentUser?.studio_id,
      appointment_kind_category_id: formData.appointment_kind_category_id || null,
      reporting_category_id: formData.reporting_category_id || null,
      service_cost: formData.service_cost !== "" ? parseFloat(formData.service_cost) : null,
    };

    if (appointmentType) {
      updateMutation.mutate({ id: appointmentType.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const handleDelete = () => {
    setShowDeleteAlert(true);
  };

  const confirmDelete = () => {
    deleteMutation.mutate(appointmentType.id);
    setShowDeleteAlert(false);
  };

  const resetForm = () => {
    setFormData(DEFAULT_FORM);
  };

  const showPiercingCostHint =
    (useConfigurableKinds &&
      isPiercingClinicalProfile(reportingCategories, formData.appointment_kind_category_id)) ||
    (!useConfigurableKinds && PIERCING_CATEGORIES.has(formData.category));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl bg-white">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              {appointmentType ? "Edit Appointment Type" : "New Appointment Type"}
            </DialogTitle>
            <DialogDescription>
              {appointmentType
                ? "Update the appointment type settings."
                : "Create a new appointment type with default duration and deposit."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="kind_category">Category *</Label>
              <Select value={kindSelectValue} onValueChange={handleKindChange} required>
                <SelectTrigger id="kind_category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {useConfigurableKinds ? (
                    <>
                      {appointmentKindLeaves.map((leaf) => (
                        <SelectItem key={leaf.id} value={leaf.id}>
                          {getCategoryPathLabel(
                            filterCategoriesByRole(reportingCategories, CATEGORY_ROLE_APPOINTMENT_KIND),
                            leaf.id
                          )}
                        </SelectItem>
                      ))}
                      <SelectItem value="__legacy__">Legacy label only…</SelectItem>
                    </>
                  ) : (
                    APPOINTMENT_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {useConfigurableKinds && kindSelectValue === "__legacy__" && (
                <p className="text-xs text-amber-700">
                  Choose a legacy label below for this type until you configure the booking hierarchy
                  under Categories.
                </p>
              )}
              {useConfigurableKinds && kindSelectValue === "__legacy__" && (
                <Select
                  value={formData.category}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, category: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APPOINTMENT_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="e.g., Small Tattoo, Ear Piercing"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                placeholder="Describe this appointment type..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="default_duration_minutes">Default Duration *</Label>
                <Select
                  value={
                    DURATION_PRESETS.includes(formData.default_duration_minutes)
                      ? String(formData.default_duration_minutes)
                      : "__custom__"
                  }
                  onValueChange={(val) => {
                    if (val !== "__custom__") {
                      setFormData({ ...formData, default_duration_minutes: parseInt(val, 10) });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select duration" />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATION_PRESETS.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {formatDuration(m)}
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom__">Custom…</SelectItem>
                  </SelectContent>
                </Select>
                {!DURATION_PRESETS.includes(formData.default_duration_minutes) && (
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={formData.default_duration_minutes}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          default_duration_minutes: parseInt(e.target.value, 10) || 1,
                        })
                      }
                      className="w-28"
                    />
                    <span className="text-sm text-gray-500">minutes</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="default_deposit">Default Deposit ($) *</Label>
                <Input
                  id="default_deposit"
                  type="number"
                  min="0"
                  step="1"
                  value={formData.default_deposit}
                  onChange={(e) =>
                    setFormData({ ...formData, default_deposit: parseFloat(e.target.value) })
                  }
                  required
                />
              </div>

              <div className="space-y-2 col-span-2">
                <Label htmlFor="service_cost">
                  Service Cost ($)
                  <span className="ml-1 text-xs font-normal text-gray-400">
                    (optional — shown to customers at booking)
                  </span>
                </Label>
                <Input
                  id="service_cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.service_cost}
                  onChange={(e) => setFormData({ ...formData, service_cost: e.target.value })}
                  placeholder="e.g., 40.00"
                />
                {showPiercingCostHint && (
                  <p className="text-xs text-gray-500">
                    Piercing appointments will show this price to customers. The $
                    {formData.default_deposit} deposit applies toward the total.
                  </p>
                )}
              </div>
            </div>

            {reportingLeaves.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="reporting_category_id">Reporting category</Label>
                <Select
                  value={formData.reporting_category_id}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      reporting_category_id: value === "__none__" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select reporting category (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {reportingLeaves.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {getCategoryPathLabel(
                          filterCategoriesByRole(reportingCategories, CATEGORY_ROLE_REPORTING),
                          cat.id
                        )}{" "}
                        ({cat.category_type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200">
              <div>
                <Label htmlFor="is_public_bookable" className="cursor-pointer">
                  Public Booking
                </Label>
                <p className="text-sm text-gray-500">
                  Allow customers to self-book this service online
                </p>
              </div>
              <Switch
                id="is_public_bookable"
                checked={formData.is_public_bookable}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_public_bookable: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200">
              <div>
                <Label htmlFor="is_active" className="cursor-pointer">
                  Active
                </Label>
                <p className="text-sm text-gray-500">Inactive types won&apos;t appear in booking</p>
              </div>
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
            </div>

            <DialogFooter className="flex justify-between gap-2">
              {appointmentType && (
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
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  <Save className="w-4 h-4 mr-2" />
                  {appointmentType ? "Update" : "Create"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteAlert} onOpenChange={setShowDeleteAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Appointment Type?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete &quot;{appointmentType?.name}
              &quot;. Historical appointments will retain their original values.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
