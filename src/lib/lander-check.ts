import type { Row } from "./ads";

// Lander congruency (2026-11-03, the admin: "make sure the ads correlate with the correct landing pages").
// ~/example/jobs/tracker/lander_check.py scores every Review ad 0–10 (does the lander's first screen continue the hook,
// same problem/angle/avatar, buy box sells the set the copy names, page live) and writes raw.lander_check.
// Approve is blocked below PASS unless the admin overrides on the card (raw.review.lander_override). The Mac's
// prepublish_check.py re-checks after approval and holds the row if anything moved.
export const LANDER_PASS = 7;

export type LanderCheck = {
  score: number; pass?: boolean; reasons?: string[]; fix?: string; page: string; checked_at?: string; model?: string;
  facts?: { live?: boolean; h1?: string; sells?: string | null; router_pick?: string | null; router_match?: boolean };
};

// Same as ad_guard.path_view: path (no trailing slash) + the theme ?view only.
export function pathView(u?: string | null): string {
  const raw = String(u ?? "").trim();
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(raw.startsWith("/") ? "https://store.example.com" + raw : /^https?:\/\//i.test(raw) ? raw : "https://" + raw);
  } catch {
    return raw;
  }
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const view = url.searchParams.get("view");
  return path + (view ? `?view=${view}` : "");
}

// What the card shows and Approve enforces for the lander the card has now.
export function landerGate(r: Row, lander: string): { lc: LanderCheck | null; state: "pass" | "low" | "stale" | "missing"; msg: string } {
  const lc = (r.lander_check as LanderCheck | undefined) ?? null;
  if (!lc) return { lc, state: "missing", msg: "Lander check hasn't run yet (the Mac scores new ads within ~10 min)." };
  if (lc.page !== pathView(lander))
    return { lc, state: "stale", msg: `Lander check is for ${lc.page}; this card now points at ${pathView(lander)}. Save, and it re-scores within ~10 min.` };
  if (Number(lc.score) >= LANDER_PASS) return { lc, state: "pass", msg: "" };
  return { lc, state: "low", msg: `Lander check ${lc.score}/10 is below ${LANDER_PASS}.` };
}
