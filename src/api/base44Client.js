import { supabase } from "@/utils/supabase";

const tableMap = {
  Appointment: "appointments",
  AppointmentType: "appointment_types",
  Artist: "artists",
  ArtistLocation: "artist_locations",
  Availability: "availabilities",
  Customer: "customers",
  Location: "locations",
  Studio: "studios",
  WorkStation: "workstations",
  User: "users"
};

const normalizeOrderColumn = (column) => {
  if (column === "created_date") return "created_at";
  return column;
};

const buildFilterQuery = (query, filters = {}) => {
  let filteredQuery = query;
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
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
    AppointmentType: createEntityClient("AppointmentType"),
    Artist: createEntityClient("Artist"),
    ArtistLocation: createEntityClient("ArtistLocation"),
    Availability: createEntityClient("Availability"),
    Customer: createEntityClient("Customer"),
    Location: createEntityClient("Location"),
    Studio: createEntityClient("Studio"),
    WorkStation: createEntityClient("WorkStation"),
    User: createEntityClient("User")
  }
};
