"use client";
import { useActionState, useState } from "react";
import { signIn, emailLink } from "./actions";

export function LoginForm() {
  const [pw, signInAction, signingIn] = useActionState(signIn, null);
  const [link, linkAction, sending] = useActionState(emailLink, null);
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-6">
      <form action={signInAction} className="space-y-3">
        <input name="email" type="email" required autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Email" className="field" />
        <div className="relative">
          <input name="password" type={show ? "text" : "password"} required autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Password" className="field pr-16" />
          <button type="button" onClick={() => setShow(!show)} aria-pressed={show} className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-muted hover:text-ink">{show ? "Hide" : "Show"}</button>
        </div>
        {pw?.error && <p className="text-sm text-bad">{pw.error}</p>}
        <button className="btn btn-primary w-full" disabled={signingIn}>{signingIn ? "Signing in…" : "Sign in"}</button>
      </form>
      <form action={linkAction} className="space-y-3 border-t border-line pt-6">
        <p className="text-sm text-muted">Or get a sign-in link by email.</p>
        <input name="email" type="email" required autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Email" className="field" />
        {link?.error && <p className="text-sm text-bad">{link.error}</p>}
        {link?.sent && <p className="text-sm text-ok">Check your inbox.</p>}
        <button className="btn w-full" disabled={sending}>{sending ? "Sending…" : "Email me a link"}</button>
      </form>
    </div>
  );
}
