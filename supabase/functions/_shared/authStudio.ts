import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Studio id for the signed-in user (from public.users). Service-role client is required
 * so this works regardless of table RLS.
 */
export async function fetchAuthUserStudioId(
  supabase: ReturnType<typeof createClient>,
  authUserId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("users")
    .select("studio_id")
    .eq("id", authUserId)
    .maybeSingle();

  if (error || data?.studio_id == null) {
    return null;
  }
  return data.studio_id as string;
}
