import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabase/admin";
import { routeKey, targetOptions } from "./adset-route";

// One tracker row (ads.raw). Framework v3: Problem › Avatar › Angle › Concept › Hook + Offer.
export type Row = {
  id: string;
  status?: string;
  problem?: string;
  avatar?: string;
  angle?: string;
  concept?: string;
  hook?: string;
  hook_type?: string;
  hook_n?: string;
  offer?: string;
  lander?: string;
  speaker?: string;
  notes?: string;
  parent?: string;
  conviction?: number;
  // description is a string (the Mac jobs and publisher.py write one; older app saves wrote a one-item array).
  // options = suggested sets from suggest_copy.py (1 recommended + 2 alternatives, AD_COPY_SPEC.md); primary[]/headline[]
  // are what goes to Meta (it rotates them), the alternatives stay in options until the admin switches to one.
  copy?: {
    primary?: string[]; headline?: string[]; description?: string | string[]; claims?: string[]; cta?: string;
    co_claims?: string[]; why?: string; cta_why?: string; copy_source?: string; event?: unknown;
    options?: CopyOptions;
    [k: string]: unknown;
  };
  lander_choice?: string;
  lander_routed?: string;
  lander_suggested?: { url?: string; why?: string; at?: string };
  native_type?: string;
  pipeline?: "video" | "native";
  placements?: { publisher_platforms?: string[]; facebook_positions?: string[]; why?: string };
  oversight?: Oversight;
  file?: { paths?: string[]; kind?: string; duration?: number };
  publish?: { status?: string; target?: string; requested_at?: string; ad_name?: string; issues?: string[]; [k: string]: unknown };
  review?: { verdict?: "approved" | "rejected"; reason?: string; at?: string; by?: string;
    lander_override?: { by: string; at: string; score: number | null; page: string } };
  lander_check?: import("./lander-check").LanderCheck;
  [k: string]: unknown;
};

export type CopyOption = { text: string; angle?: string; why?: string; rec?: boolean };
export type CopyOptions = {
  primary?: CopyOption[]; headline?: CopyOption[]; description?: string[]; cta?: string; cta_why?: string; why?: string;
  claims?: string[]; co_claims?: string[]; qa?: string[]; source?: string; spec?: string;
};

// raw.oversight: the ad overseer's call (~/example/jobs/tracker/oversee.py, agent ~/.config/example-agents/agents/miora-ad-overseer.md).
export type Oversight = {
  verdict: "APPROVE" | "APPROVE WITH CHANGES" | "HOLD" | "REJECT"; conviction: number;
  rubric?: Record<string, number | null>; summary?: string; reasons?: string[]; changes?: string[]; risk?: string;
  recommend?: { primary?: string[]; headline?: string[]; description?: string | null; cta?: string | null; lander?: string | null; adset?: string | null };
  model?: string; fp?: string; at?: string;
};

export type Media = Record<string, { bucket: string; path: string; bytes?: number }>;
export type Ad = { id: string; status: string; created_on: string | null; meta_ad_id: string | null; media: Media | null; results: Record<string, number> | null; raw: Row };

export const SELECT = "id,status,created_on,meta_ad_id,media,results,raw";

export async function listAds(sb: SupabaseClient): Promise<Ad[]> {
  const out: Ad[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from("ads").select(SELECT).is("removed_at", null).not("raw", "is", null)
      .order("id").range(from, from + 499);
    if (error) throw error;
    out.push(...((data ?? []) as Ad[]));
    if (!data || data.length < 500) return out;
  }
}

export async function getAd(sb: SupabaseClient, id: string): Promise<Ad | null> {
  const { data } = await sb.from("ads").select(SELECT).eq("id", id).is("removed_at", null).maybeSingle();
  return (data as Ad) ?? null;
}

const sentToMeta = (a: Ad) => !!(a.meta_ad_id || ["requested", "published", "queued"].includes(String(a.raw.publish?.status ?? "")));

// Approved, then held by the Mac's pre-publish check (~/example/jobs/tracker/prepublish_check.py): shown on Review with
// the reason so the admin can fix and approve again.
export const heldAfterApproval = (a: Ad) =>
  !a.meta_ad_id && a.raw.publish?.status === "hold" && a.raw.publish?.held_by === "prepublish_check.py";

// Finished, not yet on Facebook, not decided: what the admin reviews.
export const inReview = (a: Ad) =>
  !sentToMeta(a) && (a.raw.status ?? a.status) === "ready" && !a.raw.review?.verdict && !!(a.raw.file?.paths?.length);

// What this app plays. The review preview (previews/<id>.mp4, a few MB) comes first. The finished
// 9x16 master is often tens or hundreds of MB and is what Facebook gets, not what /review scrolls.
// Ads with no preview keep the old order: 9x16, then 4x5.
export const videoOf = (a: Ad) => a.media?.preview ?? a.media?.["9x16"] ?? a.media?.["4x5"] ?? null;

// Two pipelines (2026-11-03): NATIVE = text-led ads (story advertorials in the primary text, native statics), made in
// ~/example/brand/Ads/natives and filed by register_natives.py; VIDEO = everything the ad-director agents cut.
export type Lane = "video" | "native";
export const laneOf = (a: Ad): Lane => (a.raw.pipeline === "native" || a.raw.concept === "native" ? "native" : "video");
export const isStory = (a: Ad) => a.raw.native_type === "native-story";
// A native story's still (media.image); native statics keep their png→mp4 in videoOf().
export const imageOf = (a: Ad) => a.media?.image ?? null;

// Ad sets: one shared map (src/lib/adsets.json, also read by the Mac's publisher and buyer). TARGETS lists every set
// that takes ads, parked ones labelled "parked · queued" (approving into one queues the ad until the set opens).
// Pages that know the runtime parked state (registry_docs.adset_state) use targetOptions(state) instead.
export const TARGETS: [string, string][] = targetOptions();
export function defaultTarget(r: Row) {
  return routeKey(r);
}
export function adName(r: Row) {
  return [r.problem || "X", r.avatar || "x", r.angle || "x", r.concept || "x", r.hook_n || "H1", r.id].join("_");
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

// Change one row through registry_save (optimistic lock on registry meta saved_at; history kept server-side).
// Re-reads and re-applies on registry_conflict, like the tracker page and registry_io.update().
export async function updateRow(id: string, mutate: (r: Row) => Row, by: string) {
  const sb = supabaseAdmin();
  for (let attempt = 0; attempt < 3; attempt++) {
    const [{ data: meta }, { data: ad }] = await Promise.all([
      sb.from("registry_docs").select("value").eq("key", "meta").single(),
      sb.from("ads").select("raw").eq("id", id).is("removed_at", null).single(),
    ]);
    if (!ad?.raw) throw new Error(`ad ${id} not found`);
    const row = mutate(structuredClone(ad.raw as Row));
    const p = { base_saved_at: meta?.value?.saved_at ?? "", saved_by: `MIORA OS app (${by})`, rows: [row], removed: [], doc: {} };
    const { error } = await sb.rpc("registry_save", { p });
    if (!error) return row;
    if (!/registry_conflict/.test(error.message)) throw new Error(error.message);
  }
  throw new Error("Someone else kept saving at the same moment. Try again.");
}
export { stamp };
