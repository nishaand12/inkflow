import { supabase } from "@/utils/supabase";

const tableMap = {
  Appointment: "appointments",
  AppointmentCharge: "appointment_charges",
  AppointmentRefund: "appointment_refunds",
  AppointmentType: "appointment_types",
  Artist: "artists",
  ArtistLedgerEntry: "artist_ledger_entries",
  ArtistPayout: "artist_payouts",
  ArtistSplitRule: "artist_split_rules",
  ArtistAppointmentTypeExclusion: "artist_appointment_type_exclusions",
  ArtistWeeklySchedule: "artist_weekly_schedules",
  Availability: "availabilities",
  Customer: "customers",
  DailyReconciliation: "daily_reconciliations",
  ReconciliationTender: "reconciliation_tenders",
  Location: "locations",
  Payment: "payments",
  Sale: "sales",
  SaleLineItem: "sale_line_items",
  Product: "products",
  ReportingCategory: "reporting_categories",
  ReportingTenderGroup: "reporting_tender_groups",
  Studio: "studios",
  WorkStation: "workstations",
  User: "users",
  Supply: "supplies",
  StudioNotificationProfile: "studio_notification_profiles",
  AppointmentKindNotificationAssignment: "appointment_kind_notification_assignments"
};

const normalizeOrderColumn = (column) => {
  if (column === "created_date") return "created_at";
  return column;
};

/** Range operators usable as `{ column: { gte, lte } }` in a filter object. */
const RANGE_OPERATORS = new Set(["gte", "lte", "gt", "lt"]);

/**
 * PostgREST caps how many rows it will return and gives no signal when it
 * truncates. A response sitting exactly on a round cap is almost always a
 * truncated full-table read, which silently hides records from the UI.
 */
const ROW_CAP_HINTS = new Set([1000]);

const warnIfTruncated = (table, rows) => {
  if (!Array.isArray(rows) || !ROW_CAP_HINTS.has(rows.length)) return;
  console.warn(
    `[base44] "${table}" returned exactly ${rows.length} rows — this is almost certainly ` +
      `truncated by the PostgREST row cap, so records are missing from the UI. ` +
      `Scope the query with a range filter or paginate it.`
  );
};

const buildFilterQuery = (query, filters = {}) => {
  let filteredQuery = query;
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null) return;

    // `{ column: { gte: x, lte: y } }` → range comparison instead of equality.
    if (typeof value === "object" && !Array.isArray(value)) {
      Object.entries(value).forEach(([operator, operand]) => {
        if (operand === undefined || operand === null) return;
        if (!RANGE_OPERATORS.has(operator)) {
          throw new Error(`Unsupported filter operator "${operator}" on column "${key}"`);
        }
        filteredQuery = filteredQuery[operator](key, operand);
      });
      return;
    }

    filteredQuery = filteredQuery.eq(key, value);
  });
  return filteredQuery;
};

const createEntityClient = (entityName) => {
  const table = tableMap[entityName];
  if (!table) {
    throw new Error(`Unknown entity: ${entityName}`);
  }

  return {
    list: async () => {
      const { data, error } = await supabase.from(table).select("*");
      if (error) throw error;
      warnIfTruncated(table, data);
      return data || [];
    },
    filter: async (filters = {}, order) => {
      let query = buildFilterQuery(supabase.from(table).select("*"), filters);

      if (order) {
        const descending = order.startsWith("-");
        const column = normalizeOrderColumn(descending ? order.slice(1) : order);
        query = query.order(column, { ascending: !descending });
      }

      const { data, error } = await query;
      if (error) throw error;
      warnIfTruncated(table, data);
      return data || [];
    },
    create: async (payload) => {
      const { data, error } = await supabase.from(table).insert(payload).select("*").single();
      if (error) throw error;
      return data;
    },
    update: async (id, payload) => {
      const { data, error } = await supabase
        .from(table)
        .update(payload)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    delete: async (id) => {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
      return true;
    }
  };
};

const getOrCreateUserProfile = async (authUser) => {
  const { data: profile, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", authUser.id)
    .maybeSingle();

  if (error) throw error;

  if (profile) {
    return {
      ...profile,
      email: authUser.email,
      auth_id: authUser.id,
      role: profile.user_role ? profile.user_role.toLowerCase() : null
    };
  }

  const insertPayload = {
    id: authUser.id,
    email: authUser.email,
    full_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || null,
    user_role: "Artist",
    is_onboarded: false
  };

  const { data: created, error: insertError } = await supabase
    .from("users")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insertError) throw insertError;

  return {
    ...created,
    email: authUser.email,
    auth_id: authUser.id,
    role: created.user_role ? created.user_role.toLowerCase() : null
  };
};

export const base44 = {
  auth: {
    me: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!data?.user) throw new Error("Not authenticated");
      return getOrCreateUserProfile(data.user);
    },
    updateMe: async (payload) => {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!data?.user) throw new Error("Not authenticated");

      const { data: updated, error: updateError } = await supabase
        .from("users")
        .update(payload)
        .eq("id", data.user.id)
        .select("*")
        .single();

      if (updateError) throw updateError;
      return {
        ...updated,
        role: updated.user_role ? updated.user_role.toLowerCase() : null
      };
    },
    logout: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    }
  },
  entities: {
    Appointment: createEntityClient("Appointment"),
    AppointmentCharge: createEntityClient("AppointmentCharge"),
    AppointmentRefund: createEntityClient("AppointmentRefund"),
    AppointmentType: createEntityClient("AppointmentType"),
    Artist: createEntityClient("Artist"),
    ArtistLedgerEntry: createEntityClient("ArtistLedgerEntry"),
    ArtistPayout: createEntityClient("ArtistPayout"),
    ArtistSplitRule: createEntityClient("ArtistSplitRule"),
    ArtistAppointmentTypeExclusion: createEntityClient("ArtistAppointmentTypeExclusion"),
    ArtistWeeklySchedule: createEntityClient("ArtistWeeklySchedule"),
    Availability: createEntityClient("Availability"),
    Customer: createEntityClient("Customer"),
    DailyReconciliation: createEntityClient("DailyReconciliation"),
    ReconciliationTender: createEntityClient("ReconciliationTender"),
    Location: createEntityClient("Location"),
    Payment: createEntityClient("Payment"),
    Sale: createEntityClient("Sale"),
    SaleLineItem: createEntityClient("SaleLineItem"),
    Product: createEntityClient("Product"),
    ReportingCategory: createEntityClient("ReportingCategory"),
    ReportingTenderGroup: createEntityClient("ReportingTenderGroup"),
    Studio: createEntityClient("Studio"),
    WorkStation: createEntityClient("WorkStation"),
    User: createEntityClient("User"),
    Supply: createEntityClient("Supply"),
    StudioNotificationProfile: createEntityClient("StudioNotificationProfile"),
    AppointmentKindNotificationAssignment: createEntityClient("AppointmentKindNotificationAssignment")
  }
};
