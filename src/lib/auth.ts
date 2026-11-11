import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";

// Signed in AND on the miora_admins allowlist, or out.
export async function requireAdmin() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  // Two-factor: once an authenticator is set up, every session must pass it (aal2) before anything loads.
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") redirect("/login/mfa");
  const { data: ok } = await sb.rpc("is_miora_admin");
  if (!ok) redirect("/login?denied=1");
  return { sb, user };
}
