"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export function MfaForm() {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const sb = supabaseBrowser();
    const { data: f } = await sb.auth.mfa.listFactors();
    const factor = f?.totp?.find((x) => x.status === "verified");
    if (!factor) { setMsg("No authenticator is set up on this account."); setBusy(false); return; }
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    if (error) { setMsg("That code didn't work. Codes change every 30 seconds; try the current one."); setBusy(false); return; }
    window.location.href = "/review";
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <input id="mfa-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code"
        pattern="[0-9]{6}" maxLength={6} required placeholder="123456" className="field text-center font-mono text-lg tracking-[0.4em]" />
      {msg && <p className="text-sm text-bad">{msg}</p>}
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
    </form>
  );
}
