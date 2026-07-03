import React, { useEffect, useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import {
  CATEGORY_ROLE_APPOINTMENT_KIND,
  filterCategoriesByRole,
  getCategoryPathLabel,
  groupChildrenByParentId,
} from "@/utils/reportingCategories";
import { getAppointmentTypeIdsInCategoryTree } from "@/utils/artistServiceEligibility";

function sortTypes(list) {
  return [...(list || [])].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export default function ServiceRestrictionsDialog({ open, onOpenChange, artist, studioId }) {
  const queryClient = useQueryClient();
  const [excludedTypeIds, setExcludedTypeIds] = useState(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [saveError, setSaveError] = useState("");
  const initializedRef = useRef(false);

  useEffect(() => {
    initializedRef.current = false;
  }, [artist?.id]);

  const { data: appointmentTypes = [] } = useQuery({
    queryKey: ["appointmentTypes", studioId],
    queryFn: () => base44.entities.AppointmentType.filter({ studio_id: studioId }),
    enabled: open && !!studioId,
  });

  const { data: kindCategories = [] } = useQuery({
    queryKey: ["reportingCategories", studioId, "appointment_kind"],
    queryFn: async () => {
      const all = await base44.entities.ReportingCategory.filter({ studio_id: studioId });
      return filterCategoriesByRole(all, CATEGORY_ROLE_APPOINTMENT_KIND).filter(
        (c) => c.is_active !== false
      );
    },
    enabled: open && !!studioId,
  });

  const { data: exclusions = [], isFetching: exclusionsFetching } = useQuery({
    queryKey: ["artistAppointmentTypeExclusions", studioId],
    queryFn: () => base44.entities.ArtistAppointmentTypeExclusion.filter({ studio_id: studioId }),
    enabled: open && !!studioId,
  });

  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      return;
    }
    if (!artist?.id || exclusionsFetching) return;
    if (initializedRef.current) return;

    setSaveError("");
    setBulkCategoryId("");
    const ids = exclusions
      .filter((e) => e.artist_id === artist.id)
      .map((e) => e.appointment_type_id);
    setExcludedTypeIds(new Set(ids));
    initializedRef.current = true;
  }, [open, artist?.id, exclusions, exclusionsFetching]);

  const activeTypes = useMemo(
    () => sortTypes(appointmentTypes.filter((t) => t.is_active)),
    [appointmentTypes]
  );

  const groupedSections = useMemo(() => {
    const childrenByParent = groupChildrenByParentId(kindCategories, CATEGORY_ROLE_APPOINTMENT_KIND);
    const typesByCategory = new Map();
    const uncategorized = [];

    for (const type of activeTypes) {
      if (!type.appointment_kind_category_id) {
        uncategorized.push(type);
        continue;
      }
      const key = type.appointment_kind_category_id;
      if (!typesByCategory.has(key)) typesByCategory.set(key, []);
      typesByCategory.get(key).push(type);
    }

    const sections = [];
    for (const [categoryId, types] of typesByCategory.entries()) {
      if (!types.length) continue;
      sections.push({
        categoryId,
        label: getCategoryPathLabel(kindCategories, categoryId) || "Uncategorized",
        types: sortTypes(types),
      });
    }
    sections.sort((a, b) => a.label.localeCompare(b.label));

    if (uncategorized.length) {
      sections.push({ categoryId: "", label: "Uncategorized", types: sortTypes(uncategorized) });
    }

    return { sections, childrenByParent };
  }, [activeTypes, kindCategories]);

  const bulkCategoryOptions = useMemo(() => {
    return groupedSections.sections
      .filter((s) => s.categoryId)
      .map((s) => ({ id: s.categoryId, label: s.label }));
  }, [groupedSections]);

  const toggleType = (typeId, checked) => {
    setExcludedTypeIds((prev) => {
      const next = new Set(prev);
      if (checked === true) next.add(typeId);
      else next.delete(typeId);
      return next;
    });
  };

  const handleBulkExcludeCategory = () => {
    if (!bulkCategoryId) return;
    const typeIds = getAppointmentTypeIdsInCategoryTree(
      bulkCategoryId,
      kindCategories,
      activeTypes
    );
    setExcludedTypeIds((prev) => {
      const next = new Set(prev);
      for (const id of typeIds) next.add(id);
      return next;
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const existing = exclusions.filter((e) => e.artist_id === artist.id);
      const desired = excludedTypeIds;

      const toDelete = existing.filter((e) => !desired.has(e.appointment_type_id));
      const existingTypeIds = new Set(existing.map((e) => e.appointment_type_id));
      const toCreate = [...desired].filter((typeId) => !existingTypeIds.has(typeId));

      await Promise.all(
        toDelete.map((e) => base44.entities.ArtistAppointmentTypeExclusion.delete(e.id))
      );
      await Promise.all(
        toCreate.map((appointmentTypeId) =>
          base44.entities.ArtistAppointmentTypeExclusion.create({
            studio_id: studioId,
            artist_id: artist.id,
            appointment_type_id: appointmentTypeId,
          })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["artistAppointmentTypeExclusions"] });
      onOpenChange(false);
    },
    onError: (error) => {
      setSaveError(error?.message || "Failed to save service restrictions.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-white">
        <DialogHeader>
          <DialogTitle>Service Restrictions — {artist?.full_name}</DialogTitle>
          <DialogDescription>
            Excluded services won&apos;t appear for this artist in online booking or the internal calendar.
          </DialogDescription>
        </DialogHeader>

        {bulkCategoryOptions.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-2 items-end rounded-lg border border-gray-200 p-3">
            <div className="flex-1 space-y-1 w-full">
              <Label>Bulk exclude by category</Label>
              <Select value={bulkCategoryId} onValueChange={setBulkCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {bulkCategoryOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!bulkCategoryId}
              onClick={handleBulkExcludeCategory}
            >
              Exclude all in category
            </Button>
          </div>
        )}

        <div className="space-y-4">
          {groupedSections.sections.length === 0 ? (
            <p className="text-sm text-gray-500">No active appointment types to configure.</p>
          ) : (
            groupedSections.sections.map((section) => (
              <div key={section.categoryId || "uncategorized"} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {section.label}
                </p>
                <div className="space-y-2 rounded-lg border border-gray-100 p-3">
                  {section.types.map((type) => {
                    const checkboxId = `exclude-type-${artist?.id}-${type.id}`;
                    return (
                      <div key={type.id} className="flex items-start gap-3 text-sm">
                        <Checkbox
                          id={checkboxId}
                          checked={excludedTypeIds.has(type.id)}
                          onCheckedChange={(checked) => toggleType(type.id, checked)}
                        />
                        <Label htmlFor={checkboxId} className="cursor-pointer font-normal leading-snug">
                          <span className="font-medium text-gray-900">{type.name}</span>
                          {!type.is_public_bookable && (
                            <span className="ml-2 text-xs text-gray-400">(internal only)</span>
                          )}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {saveError && (
          <Alert className="border-red-200 bg-red-50 text-red-900">
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button
            className="bg-indigo-600 hover:bg-indigo-700"
            onClick={() => {
              setSaveError("");
              saveMutation.mutate();
            }}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save Restrictions"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
