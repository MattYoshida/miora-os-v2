"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";

export async function signIn(_: unknown, form: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({
    email: String(form.get("email") ?? "").trim(),
    password: String(form.get("password") ?? ""),
  });
  if (error) return { error: "That email and password didn't match." };
  redirect("/review");
}

// Magic link for existing accounts only: sign-ups are off in Supabase.
export async function emailLink(_: unknown, form: FormData) {
  const sb = await supabaseServer();
  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;
  const { error } = await sb.auth.signInWithOtp({
    email: String(form.get("email") ?? "").trim(),
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { error: "Couldn't send a link to that address." };
  return { sent: true };
}

export async function signOut() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}
