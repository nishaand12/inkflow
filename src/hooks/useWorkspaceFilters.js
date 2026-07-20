import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { endOfMonth, format, isValid, parseISO, startOfMonth } from "date-fns";
import { useSearchParams } from "react-router-dom";

const STORAGE_KEY = "inkflow.workspaceFilters.v1";

function defaultStartDate() {
  return format(startOfMonth(new Date()), "yyyy-MM-dd");
}

function defaultEndDate() {
  return format(endOfMonth(new Date()), "yyyy-MM-dd");
}

function defaultCalendarDate() {
  return format(new Date(), "yyyy-MM-dd");
}

export const WORKSPACE_FILTER_DEFAULTS = {
  locationId: "all",
  artistId: "all",
  status: "all",
  typeCategory: "all",
  workStationId: "all",
  specificTypeId: "all",
  calendarView: "day",
  reportsTab: "daily",
  reportsCategoryKey: "",
  reportsCategoryScope: "leaf",
};

const DATE_KEYS = new Set(["startDate", "endDate", "calendarDate"]);
const ALLOWED_VIEWS = new Set(["day", "3day", "4day", "week", "month"]);
const ALLOWED_CATEGORY_SCOPES = new Set(["leaf", "tree"]);
const ALLOWED_TABS = new Set([
  "daily",
  "category",
  "category-detail",
  "artist",
  "location",
  "support_staff_hours",
  "payments",
  "stripe",
  "sales",
]);

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return isValid(parseISO(value));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/** Coerce shared artist filter to a Reports-safe value (plain id or "all"). */
export function toReportsArtistId(artistId) {
  if (!artistId || artistId === "all") return "all";
  if (artistId === "unassigned" || artistId.startsWith("type:")) return "all";
  return artistId;
}

/** Availability only supports day/week/month — map multi-day calendar views safely. */
export function toAvailabilityView(calendarView) {
  if (calendarView === "week" || calendarView === "month" || calendarView === "day") {
    return calendarView;
  }
  // 3day / 4day (and anything unknown) → week so the page still renders usefully
  if (calendarView === "3day" || calendarView === "4day") return "week";
  return "day";
}

function sanitizeFilters(input = {}) {
  const next = {
    ...WORKSPACE_FILTER_DEFAULTS,
    startDate: defaultStartDate(),
    endDate: defaultEndDate(),
    calendarDate: defaultCalendarDate(),
  };

  if (isNonEmptyString(input.locationId)) next.locationId = input.locationId;
  if (isNonEmptyString(input.artistId)) next.artistId = input.artistId;
  if (isNonEmptyString(input.status)) next.status = input.status;
  if (isNonEmptyString(input.typeCategory)) next.typeCategory = input.typeCategory;
  if (isNonEmptyString(input.workStationId)) next.workStationId = input.workStationId;
  if (isNonEmptyString(input.specificTypeId)) next.specificTypeId = input.specificTypeId;

  if (isIsoDate(input.startDate)) next.startDate = input.startDate;
  if (isIsoDate(input.endDate)) next.endDate = input.endDate;
  if (isIsoDate(input.calendarDate)) next.calendarDate = input.calendarDate;

  if (ALLOWED_VIEWS.has(input.calendarView)) next.calendarView = input.calendarView;
  if (ALLOWED_TABS.has(input.reportsTab)) next.reportsTab = input.reportsTab;
  if (typeof input.reportsCategoryKey === "string") {
    next.reportsCategoryKey = input.reportsCategoryKey;
  }
  if (ALLOWED_CATEGORY_SCOPES.has(input.reportsCategoryScope)) {
    next.reportsCategoryScope = input.reportsCategoryScope;
  }

  return next;
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return sanitizeFilters();
    return sanitizeFilters(JSON.parse(raw));
  } catch {
    return sanitizeFilters();
  }
}

function saveToStorage(filters) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Ignore quota / private-mode failures; in-memory state still works.
  }
}

const WorkspaceFiltersContext = createContext(null);

export function WorkspaceFiltersProvider({ children }) {
  const [filters, setFiltersState] = useState(loadFromStorage);

  const setFilters = useCallback((patch) => {
    setFiltersState((prev) => {
      const partial = typeof patch === "function" ? patch(prev) : patch;
      const next = sanitizeFilters({ ...prev, ...partial });
      saveToStorage(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ filters, setFilters }), [filters, setFilters]);

  return (
    <WorkspaceFiltersContext.Provider value={value}>
      {children}
    </WorkspaceFiltersContext.Provider>
  );
}

export function useWorkspaceFilters() {
  const ctx = useContext(WorkspaceFiltersContext);
  if (!ctx) {
    throw new Error("useWorkspaceFilters must be used within WorkspaceFiltersProvider");
  }
  return ctx;
}

/**
 * Sync a subset of workspace filters to URL search params.
 * Priority on mount: URL params override localStorage when present.
 * mapping: { urlParamName: filterKey }
 */
export function useWorkspaceUrlSync(mapping) {
  const { filters, setFilters } = useWorkspaceFilters();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hydrated, setHydrated] = useState(false);
  const mappingRef = useRef(mapping);
  mappingRef.current = mapping;

  // URL → store before paint, so the first store→URL write uses the right values.
  useLayoutEffect(() => {
    const patch = {};
    let found = false;
    for (const [param, key] of Object.entries(mappingRef.current)) {
      const raw = searchParams.get(param);
      if (raw != null && raw !== "") {
        patch[key] = raw;
        found = true;
      }
    }
    if (found) setFilters(patch);
    setHydrated(true);
    // Only hydrate from the URL present on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Store → URL
  useEffect(() => {
    if (!hydrated) return;

    const next = new URLSearchParams(searchParams);
    let changed = false;

    for (const [param, key] of Object.entries(mappingRef.current)) {
      const value = filters[key];
      const omit =
        value == null ||
        value === "" ||
        (value === "all" && !DATE_KEYS.has(key)) ||
        (key === "calendarView" && value === WORKSPACE_FILTER_DEFAULTS.calendarView) ||
        (key === "reportsTab" && value === WORKSPACE_FILTER_DEFAULTS.reportsTab) ||
        (key === "reportsCategoryScope" && value === WORKSPACE_FILTER_DEFAULTS.reportsCategoryScope);

      if (omit) {
        if (next.has(param)) {
          next.delete(param);
          changed = true;
        }
      } else if (next.get(param) !== String(value)) {
        next.set(param, String(value));
        changed = true;
      }
    }

    if (changed) {
      setSearchParams(next, { replace: true });
    }
  }, [hydrated, filters, searchParams, setSearchParams]);
}
