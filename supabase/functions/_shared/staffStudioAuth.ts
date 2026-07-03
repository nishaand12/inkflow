import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

export type StaffStudioContext = {
  userId: string;
  studioId: string;
  supabase: ReturnType<typeof createClient>;
};

type AuthFailure = { ok: false; status: number; error: string };
type AuthSuccess = { ok: true; ctx: StaffStudioContext };

export async function requireStaffStudio(
  authHeader: string | null
): Promise<AuthFailure | AuthSuccess> {
  if (!authHeader) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: staffUser, error: staffErr } = await supabase
    .from("users")
    .select("studio_id")
    .eq("id", user.id)
    .maybeSingle();

  if (staffErr || !staffUser?.studio_id) {
    return { ok: false, status: 403, error: "Staff profile not found" };
  }

  return {
    ok: true,
    ctx: {
      userId: user.id,
      studioId: staffUser.studio_id,
      supabase,
    },
  };
}
