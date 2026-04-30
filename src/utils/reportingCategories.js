/**
 * Helpers for hierarchical reporting_categories (and appointment_kind trees).
 */

import { PIERCING_CATEGORIES, APPOINTMENT_CATEGORIES } from "@/utils/index";

export const CATEGORY_ROLE_REPORTING = "reporting";
export const CATEGORY_ROLE_APPOINTMENT_KIND = "appointment_kind";

/** @typedef {{ id: string, parent_id?: string|null, name?: string, display_order?: number, is_active?: boolean, category_type?: string, category_role?: string, clinical_profile?: string|null }} ReportingCategoryLike */

/**
 * @param {ReportingCategoryLike[]} categories
 * @param {string} [role] - filter by category_role; omit for all
 * @returns {ReportingCategoryLike[]}
 */
export function filterCategoriesByRole(categories, role) {
  if (!role) return [...(categories || [])];
  return (categories || []).filter((c) => (c.category_role || CATEGORY_ROLE_REPORTING) === role);
}

/**
 * Sort by display_order then name.
 * @param {ReportingCategoryLike[]} list
 */
export function sortCategoriesFlat(list) {
  return [...(list || [])].sort((a, b) => {
    const oa = a.display_order ?? 0;
    const ob = b.display_order ?? 0;
    if (oa !== ob) return oa - ob;
    return (a.name || "").localeCompare(b.name || "");
  });
}

/**
 * @param {ReportingCategoryLike[]} categories
 * @param {string|null|undefined} id
 * @returns {ReportingCategoryLike|null}
 */
export function findCategoryById(categories, id) {
  if (!id) return null;
  return (categories || []).find((c) => c.id === id) || null;
}

/**
 * @param {ReportingCategoryLike[]} categories
 * @param {string|null|undefined} childId
 * @returns {ReportingCategoryLike[]}
 */
export function getAncestorChain(categories, childId) {
  const chain = [];
  let cur = findCategoryById(categories, childId);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parent_id ? findCategoryById(categories, cur.parent_id) : null;
  }
  return chain;
}

/**
 * Full path label for UI (e.g. "Piercing › Ear").
 * @param {ReportingCategoryLike[]} categories
 * @param {string|null|undefined} id
 */
export function getCategoryPathLabel(categories, id) {
  const chain = getAncestorChain(categories, id);
  if (chain.length === 0) return "";
  return chain.map((c) => c.name || "—").join(" › ");
}

/**
 * @param {ReportingCategoryLike[]} categories
 * @param {string|null|undefined} id
 * @returns {ReportingCategoryLike|null}
 */
export function getRootAncestor(categories, id) {
  const chain = getAncestorChain(categories, id);
  return chain[0] || null;
}

/**
 * Selectable leaves: active nodes with no active children in the same role-filtered set.
 * @param {ReportingCategoryLike[]} allCategories
 * @param {string} role
 */
export function getLeafCategoryOptions(allCategories, role) {
  const list = sortCategoriesFlat(filterCategoriesByRole(allCategories, role)).filter(
    (c) => c.is_active !== false
  );
  const activeIds = new Set(list.map((c) => c.id));
  const hasActiveChild = new Set();
  for (const c of list) {
    if (c.parent_id && activeIds.has(c.parent_id)) {
      hasActiveChild.add(c.parent_id);
    }
  }
  return list.filter((c) => !hasActiveChild.has(c.id));
}

/**
 * @param {ReportingCategoryLike[]} allCategories
 * @param {string} role
 * @returns {{ node: ReportingCategoryLike, depth: number }[]}
 */
export function flattenCategoryTree(allCategories, role) {
  const list = sortCategoriesFlat(filterCategoriesByRole(allCategories, role));
  const byParent = new Map();
  for (const c of list) {
    const p = c.parent_id || "__root__";
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(c);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => {
      const oa = a.display_order ?? 0;
      const ob = b.display_order ?? 0;
      if (oa !== ob) return oa - ob;
      return (a.name || "").localeCompare(b.name || "");
    });
  }

  const out = [];
  function walk(parentKey, depth) {
    const children = byParent.get(parentKey) || [];
    for (const node of children) {
      out.push({ node, depth });
      walk(node.id, depth + 1);
    }
  }
  walk("__root__", 0);
  return out;
}

/**
 * @param {ReportingCategoryLike[]} allCategories
 * @param {string} role
 * @returns {Map<string, ReportingCategoryLike[]>} parentId -> ordered children (root uses '')
 */
export function groupChildrenByParentId(allCategories, role) {
  const list = sortCategoriesFlat(filterCategoriesByRole(allCategories, role));
  const map = new Map();
  for (const c of list) {
    const p = c.parent_id || "";
    if (!map.has(p)) map.set(p, []);
    map.get(p).push(c);
  }
  return map;
}

/**
 * True if this appointment_kind leaf (or ancestor) is marked piercing clinical.
 * @param {ReportingCategoryLike[]} allCategories
 * @param {string|null|undefined} appointmentKindCategoryId
 */
export function isPiercingClinicalProfile(allCategories, appointmentKindCategoryId) {
  const chain = getAncestorChain(
    filterCategoriesByRole(allCategories, CATEGORY_ROLE_APPOINTMENT_KIND),
    appointmentKindCategoryId
  );
  return chain.some((c) => c.clinical_profile === "piercing");
}

/**
 * @param {ReportingCategoryLike[]} allCategories
 * @param {string|null|undefined} appointmentKindCategoryId
 */
export function isTattooClinicalProfile(allCategories, appointmentKindCategoryId) {
  const chain = getAncestorChain(
    filterCategoriesByRole(allCategories, CATEGORY_ROLE_APPOINTMENT_KIND),
    appointmentKindCategoryId
  );
  return chain.some((c) => c.clinical_profile === "tattoo");
}

/**
 * When appointment_kind_category_id is null, bucket legacy `appointment_types.category` strings.
 * @param {{ category?: string, appointment_kind_category_id?: string|null }} aptType
 * @returns {'tattoo'|'piercing'|'other'|null}
 */
export function legacyAppointmentTypeBucket(aptType) {
  if (!aptType || aptType.appointment_kind_category_id) return null;
  if (aptType.category === "Tattoo") return "tattoo";
  if (aptType.category && PIERCING_CATEGORIES.has(aptType.category)) return "piercing";
  return "other";
}

/**
 * @param {ReportingCategoryLike[]} allCategories
 * @param {string|null|undefined} appointmentKindCategoryId
 */
export function getAppointmentKindRootId(allCategories, appointmentKindCategoryId) {
  const kindCats = filterCategoriesByRole(allCategories, CATEGORY_ROLE_APPOINTMENT_KIND);
  const root = getRootAncestor(kindCats, appointmentKindCategoryId);
  return root?.id || null;
}

/**
 * @param {ReportingCategoryLike[]} allCategories
 * @param {{ category?: string, appointment_kind_category_id?: string|null }} aptType
 */
export function appointmentTypeMatchesFilter(allCategories, aptType, filterValue) {
  if (filterValue === "all") return true;
  if (!aptType) return false;
  if (filterValue.startsWith("kind:")) {
    const rootId = filterValue.slice(5);
    const kindRoot = getAppointmentKindRootId(allCategories, aptType.appointment_kind_category_id);
    return kindRoot === rootId;
  }
  if (filterValue === "legacy_tattoo") return legacyAppointmentTypeBucket(aptType) === "tattoo";
  if (filterValue === "legacy_piercing") return legacyAppointmentTypeBucket(aptType) === "piercing";
  if (filterValue === "legacy_other") return legacyAppointmentTypeBucket(aptType) === "other";
  return true;
}

export function getAppointmentTypeDisplaySections(appointmentTypes, reportingCategories) {
  const kindAll = filterCategoriesByRole(
    reportingCategories,
    CATEGORY_ROLE_APPOINTMENT_KIND
  );
  const roots = kindAll
    .filter((c) => !c.parent_id)
    .sort(
      (a, b) =>
        (a.display_order ?? 0) - (b.display_order ?? 0) ||
        (a.name || "").localeCompare(b.name || "")
    );

  const sections = [];
  const assigned = new Set();

  for (const root of roots) {
    const types = (appointmentTypes || []).filter((t) => {
      if (!t.appointment_kind_category_id) return false;
      return getAppointmentKindRootId(reportingCategories, t.appointment_kind_category_id) === root.id;
    });
    if (types.length === 0) continue;
    types.forEach((t) => assigned.add(t.id));
    sections.push({ key: `kind:${root.id}`, label: root.name, types });
  }

  const orphanKinds = (appointmentTypes || []).filter(
    (t) =>
      t.appointment_kind_category_id &&
      !assigned.has(t.id) &&
      !getAppointmentKindRootId(reportingCategories, t.appointment_kind_category_id)
  );
  if (orphanKinds.length) {
    orphanKinds.forEach((t) => assigned.add(t.id));
    sections.push({
      key: "kind:orphan",
      label: "Other services",
      types: orphanKinds,
    });
  }

  const legacyOrder = [...APPOINTMENT_CATEGORIES, "Piercing", "Other", "Deposit"];
  for (const cat of legacyOrder) {
    let types;
    if (cat === "Piercing") {
      types = (appointmentTypes || []).filter(
        (t) => !assigned.has(t.id) && PIERCING_CATEGORIES.has(t.category)
      );
    } else if (cat === "Other") {
      types = (appointmentTypes || []).filter(
        (t) =>
          !assigned.has(t.id) &&
          t.category !== "Tattoo" &&
          !PIERCING_CATEGORIES.has(t.category) &&
          t.category !== "Deposit"
      );
    } else if (cat === "Deposit") {
      types = (appointmentTypes || []).filter(
        (t) => !assigned.has(t.id) && t.category === "Deposit"
      );
    } else {
      types = (appointmentTypes || []).filter(
        (t) => !assigned.has(t.id) && t.category === cat
      );
    }
    if (types.length === 0) continue;
    types.forEach((t) => assigned.add(t.id));
    sections.push({ key: `legacy:${cat}`, label: cat, types });
  }

  return sections;
}
