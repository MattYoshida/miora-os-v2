import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

// Emailed sign-in links land here. token_hash links (our email template) work in any browser;
// ?code= links only work in the browser that asked for them (PKCE), so they're the fallback.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sb = await supabaseServer();
  const tokenHash = url.searchParams.get("token_hash"), type = (url.searchParams.get("type") ?? "magiclink") as EmailOtpType;
  const code = url.searchParams.get("code");
  const { error } = tokenHash
    ? await sb.auth.verifyOtp({ token_hash: tokenHash, type })
    : code ? await sb.auth.exchangeCodeForSession(code) : { error: new Error("no token") };
  return NextResponse.redirect(new URL(error ? "/login?link=failed" : "/review", url.origin));
}
