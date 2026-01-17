
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || "";
const supabaseKey = process.env.REACT_APP_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.warn("Supabase env vars are missing. Check .env.local.");
}

export const supabase = createClient(supabaseUrl, supabaseKey);
        