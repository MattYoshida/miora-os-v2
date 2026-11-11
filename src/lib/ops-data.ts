import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdSetState } from "./adset-route";

// Readers for /ops (the ads manager) and the alert banner. Always called with the signed-in admin's client (RLS).
// Everything here is written by the Mac's ~/example/jobs/ops jobs; the app only flips ops_proposals.status.
// approved_by = "policy" marks what the autonomous buyer approved itself (POLICY.json on the Mac).

export type Entity = {
  id: string; level: "account" | "campaign" | "adset" | "ad"; parent_id: string | null; campaign_id: string | null;
  name: string | null; status: string | null; effective_status: string | null;
  daily_budget: number | null; lifetime_budget: number | null; spend_today: number; impressions_today: number;
  spend_day: string | null; issues: unknown[]; review_feedback: Record<string, unknown>;
  extra: { spend_cap?: number | null; amount_spent?: number | null; currency?: string; timezone?: string; account_status?: number; objective?: string };
  active_since: string | null; last_spend_at: string | null; missing_since: string | null; updated_at: string;
};

export type Alert = {
  id: string; key: string; kind: string; severity: "info" | "warn" | "bad"; entity_id: string | null; entity_level: string | null;
  title: string; detail: string | null; status: "open" | "resolved"; first_seen: string; last_seen: string; resolved_at: string | null;
};

export type ProposalStatus = "proposed" | "approved" | "rejected" | "executed" | "failed" | "skipped";
export type Proposal = {
  id: string; kind: "pause" | "archive" | "budget" | "refresh" | "activate"; entity_id: string; entity_level: string | null;
  entity_name: string | null; from_value: string | null; to_value: string | null; reason: string;
  evidence: Record<string, unknown>; source: string | null; status: ProposalStatus;
  approved_by: string | null; approved_at: string | null; executed_at: string | null;
  result: Record<string, unknown> | null; created_at: string; updated_at: string;
};

export type BuyerReport = {
  day: string; summary: string; updated_at: string;
  stats: { live?: boolean; policy_error?: string | null; daily_max_usd?: number; armed_budget?: number; spend_today?: number;
    amount_spent?: number; cap?: number | null; waiting?: number; open_alerts?: number; urgent_alerts?: number; snapshot_at?: string };
};

export type LanderArm = {
  lander?: string; ads?: { id: string; meta_ad_id: string | null }[]; spend?: number; impressions?: number; clicks?: number;
  atc?: number; purchases?: number; revenue?: number; cost_per_atc?: number | null; cvr?: number | null; cpa?: number | null;
  ctr?: number | null; first_day?: string | null;
};
export type LanderTest = { id: string; saved_at: string; question?: string; read_when?: string; arms: Record<string, LanderArm> };
export type CapacitySet = {
  label: string; on: number; cap: number; free_slots: number; never_run_in_meta: number; waiting_to_publish: number;
  rotate_next_7d: number; need: number; set_on: boolean;
};
export type Capacity = {
  saved_at: string; live: boolean; rotation: boolean; max_active_per_set: number; rotate_every_days: number;
  sets: Record<string, CapacitySet>; parked: Record<string, { label: string; queued: number }>; weekly_target: number;
  emulate_in_production: number; rule: string;
};

export type AdSetView = Entity & { ads: number; delivering: number };
export type CampaignView = Entity & { adsets: AdSetView[]; ads: number };
export type OpsView = {
  account: Entity | null; campaigns: CampaignView[]; snapshotAt: string | null; stale: boolean;
  activeBudgets: number; alerts: Alert[]; waiting: Proposal[]; queued: Proposal[]; recent: Proposal[];
  report: BuyerReport | null; buyer: Proposal[]; landerTest: LanderTest | null; capacity: Capacity | null;
  adsetState: AdSetState;
};

const LIVE_AD = (e: Entity) => !e.missing_since && e.effective_status !== "ARCHIVED" && e.effective_status !== "DELETED";
const ON = (s: string | null) => s === "ACTIVE";

export async function loadOps(sb: SupabaseClient): Promise<OpsView> {
  const [ents, alerts, open, recent, report, buyer, docs] = await Promise.all([
    sb.from("meta_entities").select("*").limit(2000),
    sb.from("ops_alerts").select("*").eq("status", "open").order("last_seen", { ascending: false }).limit(100),
    sb.from("ops_proposals").select("*").in("status", ["proposed", "approved"]).order("created_at", { ascending: false }).limit(200),
    sb.from("ops_proposals").select("*").in("status", ["executed", "failed", "skipped", "rejected"])
      .or("approved_by.is.null,approved_by.neq.policy").order("updated_at", { ascending: false }).limit(20),
    sb.from("ops_daily_report").select("*").order("day", { ascending: false }).limit(1).maybeSingle(),
    // What the buyer (POLICY.json) did on its own: every policy-approved proposal, newest first.
    sb.from("ops_proposals").select("*").eq("approved_by", "policy").order("approved_at", { ascending: false }).limit(30),
    // Written by the Mac's buyer: the lander split in 03, production capacity, runtime parked state of the ad sets.
    sb.from("registry_docs").select("key,value").in("key", ["lander_test", "capacity", "adset_state"]),
  ]);
  for (const r of [ents, alerts, open, recent, report, buyer, docs]) if (r.error) throw new Error(r.error.message);
  const doc = (k: string) => (docs.data ?? []).find((d) => d.key === k)?.value ?? null;
  const all = (ents.data ?? []) as Entity[];
  const account = all.find((e) => e.level === "account") ?? null;
  const ads = all.filter((e) => e.level === "ad" && LIVE_AD(e));
  const sets: AdSetView[] = all.filter((e) => e.level === "adset" && !e.missing_since).map((s) => {
    const mine = ads.filter((a) => a.parent_id === s.id);
    return { ...s, ads: mine.length, delivering: mine.filter((a) => ON(a.effective_status)).length };
  });
  const rank = (e: Entity) => (ON(e.effective_status) ? 0 : e.effective_status === "PAUSED" ? 1 : 2);
  const byName = (a: Entity, b: Entity) => rank(a) - rank(b) || (a.name ?? "").localeCompare(b.name ?? "");
  const campaigns: CampaignView[] = all
    .filter((e) => e.level === "campaign" && !e.missing_since && e.effective_status !== "ARCHIVED" && e.effective_status !== "DELETED")
    .map((c) => {
      const adsets = sets.filter((s) => s.parent_id === c.id).sort(byName);
      return { ...c, adsets, ads: adsets.reduce((n, s) => n + s.ads, 0) };
    })
    .sort(byName);
  // Daily budgets that can spend right now: delivering ad sets (ABO) and delivering campaigns with a budget (CBO).
  const activeBudgets = [...sets, ...campaigns].filter((e) => ON(e.effective_status) && e.daily_budget)
    .reduce((n, e) => n + Number(e.daily_budget), 0);
  const snapshotAt = account?.updated_at ?? null;
  const stale = !snapshotAt || Date.now() - new Date(snapshotAt).getTime() > 3 * 3600_000;
  const props = (open.data ?? []) as Proposal[];
  return {
    account, campaigns, snapshotAt, stale, activeBudgets, alerts: (alerts.data ?? []) as Alert[],
    waiting: props.filter((p) => p.status === "proposed"),
    queued: props.filter((p) => p.status === "approved" && p.approved_by !== "policy"),
    recent: (recent.data ?? []) as Proposal[], report: (report.data as BuyerReport | null) ?? null,
    buyer: (buyer.data ?? []) as Proposal[], landerTest: doc("lander_test") as LanderTest | null,
    capacity: doc("capacity") as Capacity | null, adsetState: doc("adset_state") as AdSetState,
  };
}

// For the banner: open warn/bad alerts and proposals waiting for a decision. Never throws.
export async function opsCounts(sb: SupabaseClient): Promise<{ alerts: number; bad: number; waiting: number }> {
  try {
    const [a, p] = await Promise.all([
      sb.from("ops_alerts").select("severity").eq("status", "open").in("severity", ["warn", "bad"]).limit(500),
      sb.from("ops_proposals").select("id", { count: "exact", head: true }).eq("status", "proposed"),
    ]);
    const rows = (a.data ?? []) as { severity: string }[];
    return { alerts: rows.length, bad: rows.filter((r) => r.severity === "bad").length, waiting: p.count ?? 0 };
  } catch {
    return { alerts: 0, bad: 0, waiting: 0 };
  }
}
