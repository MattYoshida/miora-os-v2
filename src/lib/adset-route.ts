import MAP from "./adsets.json";

// The ad set map: src/lib/adsets.json is the ONE copy, read here and by the Mac (~/example/jobs/tracker/adset_route.py,
// used by publisher.py and the buyer). Runtime parked state = registry_docs.adset_state (the buyer may open a parked
// angle under POLICY.json); pass it in to get the live picture.

export type AdSet = {
  key: string; short: string; label: string; campaign: string; adset: string; rank: number; parked: boolean;
  manual_only?: boolean; retired?: boolean;
};
export type AdSetState = { unparked?: Record<string, unknown>; parked?: Record<string, unknown> } | null;
type Route = { lander: string; angle?: string; set: string };

const SETS = MAP.sets as AdSet[];
const ROUTES = MAP.routes as Route[];
const BY_PROBLEM = MAP.by_problem as Record<string, string>;

export function adSets(state?: AdSetState): AdSet[] {
  return SETS.map((s) => {
    let parked = s.parked;
    if (state?.unparked && s.key in state.unparked) parked = false;
    if (state?.parked && s.key in state.parked) parked = true;
    return { ...s, parked };
  });
}

export function landerPath(u?: string | null): string {
  let x = String(u ?? "").trim().replace(/^https?:\/\/[^/]+/, "");
  x = x.split("?")[0].split("#")[0].replace(/\/+$/, "");
  return x || "/";
}

// Same rules as adset_route.route(): first lander substring (+ angle) match, then the problem default.
export function routeKey(row: { lander?: string | null; angle?: string | null; problem?: string | null }): string {
  const path = landerPath(row.lander), angle = row.angle ?? "";
  for (const r of ROUTES) if (path.includes(r.lander) && (!r.angle || r.angle === angle)) return r.set;
  return BY_PROBLEM[row.problem ?? ""] ?? "";
}

// "07 · Skin → skin-reasons" (+ " · parked · queued").
export function setLabel(s: AdSet): string {
  return s.parked ? `${s.label} · parked · queued` : s.label;
}

// Options for the Review dropdown: every set that can take ads (retired ones left out), parked ones labelled.
export function targetOptions(state?: AdSetState): [string, string][] {
  return adSets(state).filter((s) => !s.retired).sort((a, b) => a.rank - b.rank).map((s) => [s.key, setLabel(s)]);
}
