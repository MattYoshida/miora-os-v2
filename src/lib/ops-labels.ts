// Labels and formatting for /ops and the alert banner (no server-only: shared by client buttons).

export const KIND: Record<string, string> = {
  pause: "Pause", archive: "Archive", budget: "Budget", refresh: "Refresh creative", activate: "Switch on",
};

// What tapping Approve does, per kind. Only pause / archive / budget ever reach Meta (Mac job, every 10 min).
export const KIND_EFFECT: Record<string, string> = {
  pause: "The Mac pauses it in Meta within ~10 minutes, if it's still in the state shown.",
  archive: "The Mac archives it in Meta within ~10 minutes, if it's still paused.",
  budget: "The Mac sets this daily budget within ~10 minutes, if the budget is still the one shown (an example step cap, never over the daily max).",
  refresh: "Queues new variants for the next-tests plan. Nothing changes in Meta.",
  activate: "Runs only while the buyer is live (POLICY.json) and inside it: never in a parked ad set, never a campaign, never over the daily max.",
};

export const LEVEL: Record<string, string> = { account: "Account", campaign: "Campaign", adset: "Ad set", ad: "Ad" };

export function statusTone(s: string | null | undefined): string {
  switch (s) {
    case "ACTIVE": case "executed": case "approved": return "!bg-ok/15 text-ok";
    case "PAUSED": case "CAMPAIGN_PAUSED": case "ADSET_PAUSED": case "skipped": case "proposed": return "";
    case "WITH_ISSUES": case "PENDING_REVIEW": case "IN_PROCESS": case "warn": return "!bg-warn/15 text-warn";
    case "DISAPPROVED": case "failed": case "rejected": case "bad": return "!bg-bad/15 text-bad";
    default: return "";
  }
}

export function statusLabel(s: string | null | undefined): string {
  if (!s) return "—";
  return s.toLowerCase().replace(/_/g, " ");
}

export const usd = (v: unknown, zero = "$0") => {
  const n = Number(v);
  if (v === null || v === undefined || Number.isNaN(n)) return "—";
  if (!n) return zero;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
};

// ISO -> "Oct 27, 14:38" in the admin's time zone (the account and the Mac are on Los Angeles time).
export function at(t: string | null | undefined): string {
  if (!t) return "—";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  return d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function ago(t: string | null | undefined): string {
  if (!t) return "never";
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

// "25.00" -> "$25/day" for budgets, statuses as words.
export function change(kind: string, from: string | null, to: string | null): string {
  if (kind === "budget") return `${usd(from)}/day → ${usd(to)}/day`;
  if (kind === "refresh") return "new variants";
  return `${statusLabel(from)} → ${statusLabel(to)}`;
}
