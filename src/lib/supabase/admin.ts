import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service role, server only. Used for registry_save (granted to service_role only), always after requireAdmin().
export function supabaseAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
