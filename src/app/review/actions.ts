"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { adName, stamp, updateRow, type Row } from "@/lib/ads";
import { gateProblems } from "@/lib/gate";
import { landerGate } from "@/lib/lander-check";
import { adSets, type AdSetState } from "@/lib/adset-route";
import { registryMeta } from "@/lib/registry";
import { CTA_KEYS, SITE, blocked, findLander, offerFor, pathOnly, type Lander } from "@/lib/review-copy";

// What the Review card edits: the lander and the copy that goes to Meta.
export type ReviewEdit = { lander: string; primary: string[]; headline: string[]; description: string; cta: string };

const clean = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

function checkEdit(e: ReviewEdit, landers: Lander[], current: string): string | null {
  const heads = clean(e.headline), prim = clean(e.primary);
  if (heads.some((h) => h.length > 40)) return "Headlines must be 40 characters or fewer.";
  if (prim.length > 5 || heads.length > 5) return "Meta takes at most 5 primary texts and 5 headlines.";
  if (!CTA_KEYS.includes(e.cta)) return "Pick a button.";
  const page = findLander(landers, e.lander);
  if (pathOnly(e.lander) !== pathOnly(current)) {
    if (!page) return "That page isn't a live store.example.com lander.";
    if (blocked(page)) return "That page's buy box is a small set (lead rule).";
  }
  return null;
}

// Applies an edit to the row. A new lander: the router's pick is kept in lander_suggested and the row turns manual
// (so ~/example/jobs/tracker/landers.py stops re-routing it), and the offer follows what the page sells (as the router
// does). Picking the router's page again hands the row back to the router.
function applyEdit(r: Row, e: ReviewEdit, landers: Lander[], by: string): Row {
  const out: Row = { ...r };
  const recUrl = r.lander_choice === "manual" ? r.lander_suggested?.url : r.lander;
  if (pathOnly(e.lander) !== pathOnly(r.lander)) {
    const page = findLander(landers, e.lander);
    const url = page ? SITE + page.path + (e.lander.includes("?") ? "?" + e.lander.split("?")[1] : "") : e.lander;
    if (r.lander_choice !== "manual") out.lander_suggested = { url: r.lander, why: r.lander_routed, at: stamp() };
    out.lander = url;
    out.lander_choice = recUrl && pathOnly(recUrl) === pathOnly(url) ? "router" : "manual";
    const o = offerFor(page);
    if (o) out.offer = o;
  }
  const c = { ...(r.copy ?? {}) };
  const next = { primary: clean(e.primary), headline: clean(e.headline), description: e.description.trim(), cta: e.cta };
  const same = JSON.stringify([c.primary ?? [], c.headline ?? [], String(c.description ?? ""), c.cta ?? ""]) ===
    JSON.stringify([next.primary, next.headline, next.description, next.cta]);
  if (!same) {
    Object.assign(c, next, { edited_at: stamp(), edited_by: by });
    if (typeof c.copy_source === "string" && c.copy_source.startsWith("suggested") && !c.copy_source.includes("edited")) c.copy_source += " · edited in Review";
    // claims follow the option the admin picked when it came from the suggestions
    const opt = c.options;
    if (opt?.claims?.length && !(c.claims ?? []).length) c.claims = opt.claims;
  }
  out.copy = c;
  return out;
}

export async function saveReview(id: string, e: ReviewEdit) {
  const { sb, user } = await requireAdmin();
  const { landers } = await registryMeta(sb);
  try {
    await updateRow(id, (r) => {
      const err = checkEdit(e, landers, String(r.lander ?? ""));
      if (err) throw new Error(err);
      return applyEdit(r, e, landers, user.email ?? "");
    }, user.email ?? "admin");
  } catch (err) {
    return { error: (err as Error).message };
  }
  revalidatePath("/review");
  revalidatePath(`/ads/${encodeURIComponent(id)}`);
  return { ok: true };
}

// Approve = hand it to the Mac's publisher (tracker-sync, every 10 min), which uploads it PAUSED into the chosen ad set.
// Into a parked set (runtime state registry_docs.adset_state) it is QUEUED instead (publish.status "queued"): the
// publisher leaves it alone until the buyer (POLICY.json rotation) or the admin opens that set. An unsaved edit from the
// card is saved in the same write.
// Lander check (raw.lander_check, ~/example/jobs/tracker/lander_check.py): below 7/10, stale or missing blocks Approve
// unless the admin ticks the override on the card (kept in raw.review.lander_override). The approval snapshot
// (raw.publish.approved: lander + copy) is what prepublish_check.py and postpublish_verify.py compare against.
// Re-approving a row the pre-publish check held clears the hold.
export async function approve(id: string, target: string, edit?: ReviewEdit, overrideLander = false) {
  const { sb, user } = await requireAdmin();
  const [{ data }, { landers }] = await Promise.all([
    sb.from("registry_docs").select("value").eq("key", "adset_state").maybeSingle(),
    registryMeta(sb),
  ]);
  const set = adSets((data?.value ?? null) as AdSetState).find((s) => s.key === target && !s.retired);
  if (!set) return { error: "Pick an ad set." };
  const queued = set.parked;
  try {
    await updateRow(id, (r0) => {
      let r = r0;
      if (edit) {
        const err = checkEdit(edit, landers, String(r0.lander ?? ""));
        if (err) throw new Error(err);
        r = applyEdit(r0, edit, landers, user.email ?? "");
      }
      const problems = gateProblems(r, landers);
      if (problems.length) throw new Error(problems.join("; "));
      const lg = landerGate(r, String(r.lander ?? ""));
      if (lg.state !== "pass" && !overrideLander) throw new Error(`${lg.msg} Tick “Override the lander check” to approve anyway.`);
      const at = stamp(), by = user.email ?? "";
      const c = r.copy ?? {};
      const approved = {
        lander: String(r.lander ?? ""), primary: (c.primary ?? []).filter((t) => t.trim()), headline: (c.headline ?? []).filter((t) => t.trim()),
        description: Array.isArray(c.description) ? String(c.description[0] ?? "") : String(c.description ?? ""), cta: c.cta || "SHOP_NOW",
        lander_check: lg.lc ? { score: lg.lc.score, page: lg.lc.page, state: lg.state } : null, at, by,
      };
      return { ...r,
        review: { verdict: "approved", at, by,
          ...(lg.state !== "pass" ? { lander_override: { by, at, score: lg.lc?.score ?? null, page: String(r.lander ?? "") } } : {}) },
        publish: { status: queued ? "queued" : "requested", requested_at: at, ad_name: adName(r), target, approved } };
    }, user.email ?? "admin");
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/review");
  revalidatePath("/ads");
  return { ok: true, queued };
}

// Reject = out of the queue, parked, with the reason kept on the row (raw.review).
export async function reject(id: string, reason: string) {
  const { user } = await requireAdmin();
  if (!reason.trim()) return { error: "Add a one-line reason." };
  try {
    await updateRow(id, (r) => ({ ...r, status: "parked",
      review: { verdict: "rejected", reason: reason.trim(), at: stamp(), by: user.email ?? "" } }), user.email ?? "admin");
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/review");
  revalidatePath("/ads");
  return { ok: true };
}

// Request changes = a row in ad_revision_requests for Grok or Claude to claim. Does not touch raw.review,
// raw.publish, or the ad status. Approve and reject are unchanged.
const NOTE_MAX = 4000;
export async function requestChanges(id: string, note: string) {
  const text = note.trim();
  if (!text) return { error: "Say what should change." };
  if (text.length > NOTE_MAX) return { error: "Keep it under 4000 characters." };
  const { sb, user } = await requireAdmin();
  const { data: ad, error: findErr } = await sb.from("ads").select("id,raw").eq("id", id).is("removed_at", null).maybeSingle();
  if (findErr) return { error: findErr.message };
  if (!ad?.raw) return { error: "That ad is no longer here." };
  const { error } = await sb.from("ad_revision_requests").insert({
    ad_id: id,
    ad_name: adName(ad.raw as Row),
    note: text,
    status: "requested",
    requested_by: user.email ?? user.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/review");
  return { ok: true };
}
