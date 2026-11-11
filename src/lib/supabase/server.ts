import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Per-request client acting as the signed-in user; every table is RLS-locked to is_miora_admin().
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // called from a server component: the middleware refreshes the session instead
        }
      },
    },
  });
}
