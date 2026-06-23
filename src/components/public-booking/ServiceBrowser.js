import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, ChevronRight, ArrowLeft } from "lucide-react";
import { formatDuration } from "@/utils/index";
import {
  CATEGORY_ROLE_APPOINTMENT_KIND,
  filterCategoriesByRole,
  groupChildrenByParentId,
} from "@/utils/reportingCategories";
import AppointmentTypeImage from "@/components/appointment-types/AppointmentTypeImage";

/**
 * Hierarchical service browser used by both the public booking flow and the
 * customer self-service reschedule flow. Category navigation is controlled by
 * the parent via `categoryPath` / `onCategoryPathChange` so the parent can react
 * to navigation (e.g. embed resize).
 */
export default function ServiceBrowser({
  appointmentTypes,
  kindCategories,
  selectedType,
  categoryPath,
  onCategoryPathChange,
  onSelectType,
  emptyMessage = "No services available for online booking at this time.",
}) {
  const serviceBrowser = useMemo(() => {
    const activeKindCategories = filterCategoriesByRole(
      kindCategories,
      CATEGORY_ROLE_APPOINTMENT_KIND
    ).filter((c) => c.is_active !== false);
    const childrenByParent = groupChildrenByParentId(
      activeKindCategories,
      CATEGORY_ROLE_APPOINTMENT_KIND
    );
    const activeCategoryIds = new Set(activeKindCategories.map((c) => c.id));
    const typesByCategory = new Map();

    for (const type of appointmentTypes) {
      if (!type.appointment_kind_category_id) continue;
      if (!activeCategoryIds.has(type.appointment_kind_category_id)) continue;
      const key = type.appointment_kind_category_id;
      if (!typesByCategory.has(key)) typesByCategory.set(key, []);
      typesByCategory.get(key).push(type);
    }

    for (const [key, list] of typesByCategory.entries()) {
      typesByCategory.set(key, sortAppointmentTypes(list));
    }

    const countTypesInCategory = (categoryId, seen = new Set()) => {
      if (seen.has(categoryId)) return 0;
      seen.add(categoryId);
      const directCount = typesByCategory.get(categoryId)?.length || 0;
      const childCount = (childrenByParent.get(categoryId) || []).reduce(
        (sum, child) => sum + countTypesInCategory(child.id, seen),
        0
      );
      return directCount + childCount;
    };

    const visibleChildrenByParent = new Map();
    for (const [parentId, children] of childrenByParent.entries()) {
      visibleChildrenByParent.set(
        parentId,
        children.filter((child) => countTypesInCategory(child.id) > 0)
      );
    }

    return {
      childrenByParent: visibleChildrenByParent,
      typesByCategory,
      countTypesInCategory,
    };
  }, [appointmentTypes, kindCategories]);

  const currentCategoryId = categoryPath[categoryPath.length - 1]?.id || "";
  const currentCategoryChildren = serviceBrowser.childrenByParent.get(currentCategoryId) || [];
  const currentCategoryTypes = currentCategoryId
    ? serviceBrowser.typesByCategory.get(currentCategoryId) || []
    : [];
  const hasServicesToShow =
    currentCategoryChildren.length > 0 || currentCategoryTypes.length > 0;

  const handleCategorySelect = (category) => {
    onCategoryPathChange([...categoryPath, category]);
  };

  const handleCategoryBack = () => {
    onCategoryPathChange(categoryPath.slice(0, -1));
  };

  if (!hasServicesToShow) {
    return <p className="text-gray-500 text-center py-6">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-4">
      {categoryPath.length > 0 && (
        <div className="space-y-3">
          <Button variant="outline" size="sm" onClick={handleCategoryBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Browsing</p>
            <p className="font-semibold text-gray-900">
              {categoryPath.map((c) => c.name).join(" / ")}
            </p>
          </div>
        </div>
      )}

      {currentCategoryChildren.length > 0 && (
        <div className="space-y-2">
          {currentCategoryChildren.map((category) => (
            <button
              key={category.id}
              data-testid="public-service-category"
              onClick={() => handleCategorySelect(category)}
              className="w-full p-4 rounded-xl border-2 border-gray-200 text-left transition-all hover:border-indigo-300 hover:bg-indigo-50"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{category.name}</p>
                  <p className="text-sm text-gray-500">
                    {serviceBrowser.countTypesInCategory(category.id)} services
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </div>
            </button>
          ))}
        </div>
      )}

      {currentCategoryTypes.length > 0 && (
        <ServiceTypeList
          types={currentCategoryTypes}
          selectedType={selectedType}
          onSelect={onSelectType}
        />
      )}
    </div>
  );
}

function ServiceTypeList({ types, selectedType, onSelect }) {
  return (
    <div className="space-y-2">
      {types.map((type) => (
        <button
          key={type.id}
          data-testid="public-service-type"
          onClick={() => onSelect(type)}
          className={`w-full p-4 rounded-xl border-2 text-left transition-all hover:border-indigo-300 hover:bg-indigo-50 ${
            selectedType?.id === type.id ? "border-indigo-500 bg-indigo-50" : "border-gray-200"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            {type.image_url && (
              <AppointmentTypeImage
                imageUrl={type.image_url}
                alt={type.name}
                className="h-16 w-16 shrink-0 rounded-lg object-cover"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900">{type.name}</p>
              {type.description && (
                <p className="text-sm text-gray-500 mt-0.5">{type.description}</p>
              )}
            </div>
            <div className="text-right shrink-0 space-y-1">
              <div className="flex items-center gap-1 text-sm text-gray-500 justify-end">
                <Clock className="w-3.5 h-3.5" />
                {formatDuration(type.default_duration_minutes)}
              </div>
              {type.service_cost > 0 && (
                <p className="text-sm font-semibold text-gray-900">
                  ${type.service_cost}
                  {type.price_includes_tax ? (
                    <span className="text-xs font-normal text-gray-500"> incl. tax</span>
                  ) : null}
                </p>
              )}
              {type.default_deposit > 0 && (
                <Badge className="bg-indigo-100 text-indigo-700 text-xs">
                  ${type.default_deposit} deposit
                </Badge>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function sortAppointmentTypes(types) {
  return [...(types || [])].sort((a, b) => {
    const orderA = a.display_order ?? 0;
    const orderB = b.display_order ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    return (a.name || "").localeCompare(b.name || "");
  });
}
