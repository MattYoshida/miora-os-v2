// MIORA cloud money guard (2026-10-28). Supabase Edge Function, called every 10 min by pg_cron (job 'money-guard'),
// independent of the admin's Mac. SQL: supabase/2026-10-28_money_guard.sql.
//
// Each run:
//   1. reads ops_policy (mirror of ~/example/jobs/ops/POLICY.json) and its own state (ops_guard_state)
//   2. ONE Meta GET (account amount_spent + spend_cap + status, today's account spend, campaigns, ad sets, and ads that
//      are DISAPPROVED / WITH_ISSUES). A second GET only to read back after a pause.
//   3. guard: today's spend > spike_x * daily_max_usd, or daily budgets that can spend now > daily_max_usd, or
//      amount_spent >= cap_guard_pct * cap  ->  pause the in-scope campaign(s) that are ON (status PAUSED, the one write
//      this function can make), record an ops_alerts row (bad) + an ops_proposals row (approved_by 'cloud-guard',
//      executed), and record an alert.
//   4. pushes only (no Meta write): ads disapproved / with issues, account not ACTIVE, Mac heartbeat stale (no job_runs /
//      meta_snapshot update in 2 h), Meta unreadable for > 1 h.
// Never activates anything, never changes a budget or the spend cap. On a Meta rate limit (4/17/32/613/80000-80014) it
// stops calling Meta for 60 min. Pushes: same key at most once per 2 h (ops_push_log, shared with the Mac).
// Levels: priority >= 4 is urgent (guard trip, account not ACTIVE, ad rejected, Meta unreadable),
// <= 3 is quiet. rejected:<ad> is recorded once ever per ad.
// This snapshot records alerts in ops_alerts and ops_push_log. Chat, bot, and webhook delivery are not included.
//
//   POST /money-guard                 run (header x-guard-key required)
//   POST /money-guard?dry=1           read Meta + evaluate, write nothing; returns what it would do
//        &sim_spend=162&sim_on=<id>   (dry only) pretend today's spend / that a campaign and its ad sets are ON
//   POST /money-guard?test_push=1     record one test alert in ops_push_log and stop (no Meta call)

const GRAPH = "https://graph.facebook.com/v21.0";
const RATE_CODES = new Set([4, 17, 32, 613, 80000, 80003, 80004, 80014]);
const BACKOFF_MIN = 60;          // stay off Meta this long after a rate-limit error
const SOFT_BACKOFF_MIN = 30;     // ... or after usage headers say >= 90% of a quota
const UNREADABLE_H = 1;          // alert when Meta couldn't be read for this long
const MAC_STALE_H = 2;           // "Mac jobs stopped" after this long without job_runs / meta_snapshot
const PUSH_GAP_H = 2;            // same push key at most once per 2 h
const TEST_CAMPAIGN = "EXAMPLE_CAMPAIGN_TEST";
const OPS_URL = "https://app.example.com/ops";
const SAFE_POLICY = {                           // EXAMPLE defaults if ops_policy is missing — not production limits
  live: false, auto_approve_protective: true, daily_max_usd: 20, account_cap_usd: 250, cap_guard_pct: 0.5,
  spike_x: 3, guard_enabled: true, guard_campaign_ids: [TEST_CAMPAIGN], account_id: "act_EXAMPLE",
};
const ACCOUNT_STATUS: Record<number, string> = {
  1: "ACTIVE", 2: "DISABLED", 3: "UNSETTLED", 7: "PENDING_RISK_REVIEW", 8: "PENDING_SETTLEMENT", 9: "IN_GRACE_PERIOD",
  100: "PENDING_CLOSURE", 101: "CLOSED",
};

const env = (k: string) => Deno.env.get(k) ?? "";
const SB_URL = env("SUPABASE_URL");
const SB_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const enc = new TextEncoder();

// ------------------------------------------------------------------ helpers
type J = Record<string, any>;
const now = () => new Date();
const iso = (d: Date = now()) => d.toISOString();
const hoursSince = (s?: string | null) => (s ? (now().getTime() - new Date(s).getTime()) / 3.6e6 : Infinity);
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;
const cents = (v: unknown) => (v === undefined || v === null || v === "" ? null : Math.round(Number(v)) / 100);

function redact(s: string): string {
  for (const secret of [env("META_ACCESS_TOKEN"), env("META_APP_SECRET"), env("MONEY_GUARD_KEY")]) {
    if (secret) s = s.split(secret).join("***");
  }
  return s.replace(/access_token=[^&\s"]+/g, "access_token=***").replace(/appsecret_proof=[^&\s"]+/g, "appsecret_proof=***");
}

function sameKey(a: string, b: string): boolean {    // constant-time compare
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function db(method: string, path: string, body?: unknown, prefer?: string): Promise<any> {
  const headers: Record<string, string> = { apikey: SB_KEY, "Content-Type": "application/json" };
  if (SB_KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${SB_KEY}`;
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`db ${method} ${path.split("?")[0]} ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ------------------------------------------------------------------ Meta
class MetaError extends Error {
  constructor(msg: string, public code: number | null = null, public rate = false) { super(msg); }
}

async function proof(): Promise<string> {
  if (!env("META_APP_SECRET")) return "";
  const key = await crypto.subtle.importKey("raw", enc.encode(env("META_APP_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(env("META_ACCESS_TOKEN")));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function usagePct(h: Headers): number {
  // x-business-use-case-usage {acct: [{call_count,total_cputime,total_time}]}, x-ad-account-usage {acc_id_util_pct},
  // x-app-usage {call_count,total_cputime,total_time}. Highest percentage wins.
  let max = 0;
  const take = (o: unknown) => {
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o as J)) {
        if (typeof v === "number" && /count|time|pct/.test(k)) max = Math.max(max, v);
        else if (v && typeof v === "object") take(v);
      }
    }
  };
  for (const name of ["x-business-use-case-usage", "x-ad-account-usage", "x-app-usage"]) {
    try { take(JSON.parse(h.get(name) || "null")); } catch { /* ignore */ }
  }
  return max;
}

async function meta(method: "GET" | "POST", path: string, params: Record<string, string>): Promise<{ data: J; usage: number }> {
  const pr = await proof();
  const p = new URLSearchParams({ ...params, access_token: env("META_ACCESS_TOKEN"), ...(pr ? { appsecret_proof: pr } : {}) });
  let r: Response;
  try {
    r = method === "GET"
      ? await fetch(`${GRAPH}/${path}?${p}`)
      : await fetch(`${GRAPH}/${path}`, { method: "POST", body: p, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  } catch (e) {
    throw new MetaError(redact(`network: ${(e as Error).message}`));
  }
  const usage = usagePct(r.headers);
  let data: J = {};
  try { data = await r.json(); } catch { /* non-JSON */ }
  if (!r.ok || data.error) {
    const err = data.error || {};
    const code = typeof err.code === "number" ? err.code : null;
    const msg = redact(`Graph API error ${code ?? r.status}: ${err.message || r.statusText}`).slice(0, 300);
    const rate = (code !== null && RATE_CODES.has(code)) || /rate limit|too many calls/i.test(msg);
    throw new MetaError(msg, code, rate);
  }
  return { data, usage };
}

const READ_FIELDS = [
  "account_status", "disable_reason", "amount_spent", "spend_cap", "currency", "timezone_name",
  "insights.date_preset(today){spend,date_start}",
  "campaigns.limit(100){id,name,status,effective_status,daily_budget,lifetime_budget,issues_info}",
  "adsets.limit(200){id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,issues_info}",
  'ads.effective_status(["DISAPPROVED","WITH_ISSUES"]).limit(100){id,name,adset_id,campaign_id,effective_status,issues_info,ad_review_feedback}',
].join(",");

// Meta's ad_review_feedback {global: {"Policy name": "text"}, placement_specific: {...}} -> one line (same as alerts.py)
function reviewReason(fb: unknown): string {
  if (!fb || typeof fb !== "object") return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fb as J)) {
    if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v as J)) parts.push(`${k}: ${kk}: ${vv}`);
    else parts.push(`${k}: ${v}`);
  }
  return parts.join("; ").slice(0, 900);
}

// ------------------------------------------------------------------ push
// Alerts are recorded in the database. This shareable slice does not call a chat, bot, or webhook.
let lastPushError = "";
type Sent = { ok: boolean; rid?: number; via?: "recorded"; tg?: boolean };

async function sendPush(title: string, message: string, priority = 3, _tags: string[] = [], _topicOverride = "", _key = ""): Promise<Sent> {
  lastPushError = "";
  void title; void message; void priority;
  return { ok: true, via: "recorded", tg: false };
}

type Push = { key: string; title: string; message: string; priority: number; tags?: string[] };

/** Record pushes whose key wasn't recorded in the last PUSH_GAP_H; rejected:<ad> once ever per ad.
 *  Priority >= 4 is urgent, <= 3 is quiet. Several due at once stay in their own level. */
const ONCE = ["rejected:"];
async function pushAll(items: Push[], source: string): Promise<{ sent: string[]; held: string[]; rid?: number }> {
  if (!items.length) return { sent: [], held: [] };
  const keys = [...new Set(items.map((i) => i.key))];
  const inList = encodeURIComponent(`(${keys.map((k) => `"${k.replace(/"/g, "")}"`).join(",")})`);
  const log: J[] = await db("GET", `ops_push_log?select=key,last_sent_at,sent_count&key=in.${inList}`);
  const recent = new Map(log.map((l) => [l.key, l]));
  const sentBefore = (k: string) => { const t = recent.get(k)?.last_sent_at; return !!t && new Date(t).getUTCFullYear() > 1970; };
  const due = items.filter((i) => ONCE.some((p) => i.key.startsWith(p)) ? !sentBefore(i.key) : hoursSince(recent.get(i.key)?.last_sent_at) >= PUSH_GAP_H);
  const held = items.filter((i) => !due.includes(i)).map((i) => i.key);
  if (!due.length) return { sent: [], held };
  const sent: Push[] = [];
  let rid: number | undefined;
  for (const grp of [due.filter((d) => d.priority >= 4), due.filter((d) => d.priority < 4)]) {
    if (!grp.length) continue;
    grp.sort((a, b) => b.priority - a.priority);
    const urgent = grp[0].priority >= 4;
    const title = grp.length === 1 ? grp[0].title : `MIORA: ${grp.length} ${urgent ? "urgent ad alerts" : "ad updates"}`;
    const message = grp.length === 1 ? grp[0].message : grp.slice(0, 6).map((d) => `• ${d.message}`).join("\n") + (grp.length > 6 ? "\n…" : "");
    const res = await sendPush(title, message, grp[0].priority, grp[0].tags || [], "", grp.map((d) => d.key).join(",").slice(0, 200));
    if (!res.ok) { held.push(...grp.map((d) => d.key)); continue; }
    sent.push(...grp);
    rid = res.rid ?? rid;
  }
  if (!sent.length) return { sent: [], held };
  const t = iso();
  await db("POST", "ops_push_log?on_conflict=key", sent.map((d) => ({
    key: d.key, last_sent_at: t, sent_count: (recent.get(d.key)?.sent_count || 0) + 1, last_title: d.title.slice(0, 200), source,
  })), "resolution=merge-duplicates,return=minimal");
  // Earlier database delivery rows are checked on the next run (checkPushes).
  return { sent: sent.map((d) => d.key), held, rid };
}

/** Earlier pushes sent through pg_net: any that failed are made due again (key reset in ops_push_log, condition
 *  dropped from `open` so this run treats it as new). Returns the requests still waiting for a result. */
async function checkPushes(state: J, open: Record<string, string>, report: J): Promise<J[]> {
  const reqs: J[] = (state.push_requests || []).filter((r: J) => typeof r.rid === "number");
  if (!reqs.length) return [];
  const res: J[] = await db("POST", "rpc/ops_push_results", { p_ids: reqs.map((r) => r.rid) });
  const by = new Map(res.map((r) => [r.id, r]));
  const waiting: J[] = [], failed: J[] = [];
  for (const r of reqs) {
    const x = by.get(r.rid);
    if (x && x.status_code >= 200 && x.status_code < 300) continue;
    if (!x && hoursSince(r.at) < 0.5) { waiting.push(r); continue; }
    failed.push({ ...r, status: x?.status_code ?? null, error: x?.error_msg ?? (x ? null : "no result") });
  }
  if (failed.length) {
    const keys = failed.flatMap((f) => f.keys || []);
    for (const k of keys) delete open[k];
    if (keys.length) {
      const inList = encodeURIComponent(`(${keys.map((k) => `"${k.replace(/"/g, "")}"`).join(",")})`);
      await db("PATCH", `ops_push_log?key=in.${inList}`, { last_sent_at: "1970-01-01T00:00:00Z" }, "return=minimal");
    }
    report.notes.push(`${failed.length} earlier push(es) failed (${failed.map((f) => f.status ?? f.error).join(", ")}); retrying`);
    state.last_push_failure = { at: iso(), failed };
  }
  return waiting;
}

// ------------------------------------------------------------------ main run
type Sim = { spend?: number; on?: string } | null;   // dry-run only: pretend today's spend / a campaign + its sets are ON

async function run(dry: boolean, sim: Sim = null): Promise<J> {
  if (!dry) sim = null;
  const t0 = now();
  const report: J = { at: iso(t0), dry, reads: {}, guard: {}, would: [], did: [], pushes: [], notes: [] };

  const polRows: J[] = await db("GET", "ops_policy?select=*&id=eq.main");
  const pol: J = polRows[0] ? { ...SAFE_POLICY, ...polRows[0] } : { ...SAFE_POLICY, _missing: true };
  if (pol._missing) report.notes.push("ops_policy row missing: using the seeded defaults");
  report.policy = {
    live: pol.live, auto_approve_protective: pol.auto_approve_protective, daily_max_usd: Number(pol.daily_max_usd),
    account_cap_usd: Number(pol.account_cap_usd), cap_guard_pct: Number(pol.cap_guard_pct), spike_x: Number(pol.spike_x),
    guard_enabled: pol.guard_enabled, guard_campaign_ids: pol.guard_campaign_ids, synced_at: pol.synced_at ?? null,
  };
  if (!pol.guard_enabled) {
    report.notes.push("guard_enabled is false: nothing read, nothing written");
    return report;
  }
  const stRows: J[] = await db("GET", "ops_guard_state?select=state&id=eq.money-guard");
  const state: J = stRows[0]?.state || {};
  const open: Record<string, string> = { ...(state.open || {}) };   // condition key -> first seen
  const pushWaiting = dry ? [] : await checkPushes(state, open, report);
  const current = new Map<string, Push & { alert?: J; meta?: boolean }>();

  // --- Mac heartbeat (Supabase only)
  const [jr, snap]: J[][] = await Promise.all([
    db("GET", "job_runs?select=observed_at&order=observed_at.desc.nullslast&limit=1"),
    db("GET", "meta_entities?select=updated_at&level=eq.account&order=updated_at.desc&limit=1"),
  ]);
  const lastJob = jr[0]?.observed_at ?? null, lastSnap = snap[0]?.updated_at ?? null;
  const macAge = Math.min(hoursSince(lastJob), hoursSince(lastSnap));
  report.reads.mac = { last_job_run: lastJob, last_meta_snapshot: lastSnap, stale: macAge > MAC_STALE_H };
  if (macAge > MAC_STALE_H && pol.live) {  // only matters once spend can happen; the Mac sleeps most nights
    const msg = `MIORA: Mac jobs stopped — no update for ${Number.isFinite(macAge) ? macAge.toFixed(1) + " h" : "ever"}. Cloud guard still on.`;
    current.set("cloud:mac_stale", {
      key: "cloud:mac_stale", title: "MIORA: Mac jobs stopped", message: msg, priority: 3, tags: ["computer"],
      alert: { kind: "mac_stale", severity: "warn", title: "Mac jobs stopped (cloud guard covering)",
               detail: `No job_runs or Meta snapshot update for over ${MAC_STALE_H} h. The Mac buyer, publisher and alerts are not running; the cloud money guard keeps checking spend every 10 min.`,
               evidence: { last_job_run: lastJob, last_meta_snapshot: lastSnap } },
    });
  }

  // --- Meta read (one GET)
  let acct: J | null = null;
  let metaOk = false;
  const backoffUntil = state.backoff_until && new Date(state.backoff_until) > t0 ? state.backoff_until : null;
  const nextState: J = { ...state };
  if (backoffUntil) {
    report.reads.meta = { skipped: `rate-limit backoff until ${backoffUntil}` };
  } else if (!env("META_ACCESS_TOKEN")) {
    report.reads.meta = { error: "META_ACCESS_TOKEN secret is not set" };
  } else {
    try {
      const { data, usage } = await meta("GET", pol.account_id, { fields: READ_FIELDS });
      acct = data;
      metaOk = true;
      nextState.last_ok_read_at = iso();
      nextState.first_fail_at = null;
      nextState.last_usage_pct = usage;
      if (usage >= 90) {
        nextState.backoff_until = iso(new Date(Date.now() + SOFT_BACKOFF_MIN * 60e3));
        report.notes.push(`Meta usage at ${usage}%: backing off ${SOFT_BACKOFF_MIN} min`);
      }
      report.reads.meta = { ok: true, usage_pct: usage };
    } catch (e) {
      const me = e as MetaError;
      nextState.first_fail_at = nextState.first_fail_at || iso();
      nextState.last_error = me.message;
      if (me.rate) nextState.backoff_until = iso(new Date(Date.now() + BACKOFF_MIN * 60e3));
      report.reads.meta = { error: me.message, rate_limited: me.rate };
    }
  }
  if (!metaOk) {
    const since = nextState.last_ok_read_at || nextState.first_fail_at || state.first_fail_at;
    if (hoursSince(since) > UNREADABLE_H) {
      const h = hoursSince(since);
      current.set("cloud:meta_unreadable", {
        key: "cloud:meta_unreadable", title: "MIORA: can't read Meta",
        message: `MIORA: cloud guard can't read Meta for ${Number.isFinite(h) ? h.toFixed(1) + " h" : "over 1 h"} — spend unguarded. Check token / rate limit.`,
        priority: 4, tags: ["warning"],
        alert: { kind: "cloud_guard", severity: "bad", title: "Cloud money guard can't read Meta",
                 detail: `${nextState.last_error || "Meta read failing"}. While this lasts the cloud guard can't pause anything.`,
                 evidence: { last_ok_read_at: nextState.last_ok_read_at ?? null, backoff_until: nextState.backoff_until ?? null } },
      });
    }
  }

  // --- evaluate
  if (acct) {
    const ins = (acct.insights?.data || [])[0] || {};
    const spendToday = sim?.spend !== undefined ? sim.spend : Number(ins.spend || 0);
    if (sim?.on) {
      for (const c of acct.campaigns?.data || []) if (c.id === sim.on) c.status = c.effective_status = "ACTIVE";
      for (const x of acct.adsets?.data || []) if (x.campaign_id === sim.on) x.status = x.effective_status = "ACTIVE";
    }
    if (sim) report.simulated = sim;
    const day = ins.date_start || new Intl.DateTimeFormat("en-CA", { timeZone: acct.timezone_name || "America/Los_Angeles" }).format(t0);
    const camps: J[] = acct.campaigns?.data || [];
    const sets: J[] = acct.adsets?.data || [];
    const badAds: J[] = (acct.ads?.data || []).filter((a: J) =>
      a.effective_status === "DISAPPROVED" || a.effective_status === "WITH_ISSUES" || (a.issues_info || []).length);
    const metaCap = cents(acct.spend_cap) || 0;
    const spent = cents(acct.amount_spent) || 0;
    const pcap = Number(pol.account_cap_usd) || 0;
    const cap = [metaCap, pcap].filter((v) => v > 0).reduce((a, b) => Math.min(a, b), Infinity);
    const campById = new Map(camps.map((c) => [c.id, c]));
    // budgets that can spend right now: ad set ON inside a campaign that is ON (ABO), plus campaign budgets (CBO) of
    // campaigns ON with an ad set ON. (The Mac's alert also counts sets ON inside paused campaigns, conservatively.)
    const onSets = sets.filter((s) => s.status === "ACTIVE" && campById.get(s.campaign_id)?.status === "ACTIVE");
    let liveBudget = onSets.reduce((a, s) => a + (cents(s.daily_budget) || 0), 0);
    for (const c of camps) {
      if (c.status === "ACTIVE" && c.daily_budget && onSets.some((s) => s.campaign_id === c.id)) liveBudget += cents(c.daily_budget) || 0;
    }
    const armedBudget = sets.filter((s) => s.status === "ACTIVE").reduce((a, s) => a + (cents(s.daily_budget) || 0), 0)
      + camps.filter((c) => c.status === "ACTIVE" && c.daily_budget && sets.some((s) => s.campaign_id === c.id && s.status === "ACTIVE"))
        .reduce((a, c) => a + (cents(c.daily_budget) || 0), 0);
    const lifetimeOn = onSets.filter((s) => cents(s.lifetime_budget)).length
      + camps.filter((c) => c.status === "ACTIVE" && cents(c.lifetime_budget)).length;
    const statusName = ACCOUNT_STATUS[acct.account_status] || String(acct.account_status);
    const incomplete = ["campaigns", "adsets", "ads"].filter((k) => acct![k]?.paging?.next);

    const dmax = Number(pol.daily_max_usd), spike = Number(pol.spike_x) || 3, guardPct = Number(pol.cap_guard_pct);
    report.reads.account = {
      account_status: statusName, disable_reason: acct.disable_reason, currency: acct.currency, timezone: acct.timezone_name,
      day, spend_today: spendToday, amount_spent: spent, meta_spend_cap: metaCap || null, policy_cap: pcap, cap: Number.isFinite(cap) ? cap : null,
      cap_used_pct: Number.isFinite(cap) ? Math.round((spent / cap) * 1000) / 10 : null,
      campaigns: camps.length, campaigns_on: camps.filter((c) => c.status === "ACTIVE").map((c) => ({ id: c.id, name: c.name, effective_status: c.effective_status })),
      adsets: sets.length, adsets_on: sets.filter((s) => s.status === "ACTIVE").map((s) => ({ id: s.id, name: s.name, campaign_id: s.campaign_id, daily_budget: cents(s.daily_budget), effective_status: s.effective_status })),
      live_daily_budgets: Math.round(liveBudget * 100) / 100, armed_daily_budgets_incl_paused_campaigns: Math.round(armedBudget * 100) / 100,
      lifetime_budgets_on: lifetimeOn, ads_disapproved_or_with_issues: badAds.length, incomplete_edges: incomplete,
    };
    if (incomplete.length) report.notes.push(`Meta returned more pages for ${incomplete.join(", ")}; evaluated the first page`);

    // guard
    const trips: { code: string; text: string }[] = [];
    if (dmax > 0 && spendToday > spike * dmax) trips.push({ code: "spend", text: `today ${usd(spendToday)} > ${usd(spike * dmax)} guard` });
    if (dmax > 0 && liveBudget > dmax + 1e-6) trips.push({ code: "budget", text: `budgets on ${usd(liveBudget)}/day > ${usd(dmax)} max` });
    if (Number.isFinite(cap) && guardPct > 0 && spent >= guardPct * cap) trips.push({ code: "cap", text: `spent ${usd(spent)} ≥ ${Math.round(guardPct * 100)}% of ${usd(cap)} cap` });
    const scopeAll = (pol.guard_campaign_ids || []).includes("all");
    const inScope = (id: string) => scopeAll || (pol.guard_campaign_ids || []).includes(id);
    const onCamps = camps.filter((c) => c.status === "ACTIVE");
    const targets = onCamps.filter((c) => inScope(c.id));
    const outside = onCamps.filter((c) => !inScope(c.id));
    const label = (c: J) => (c.id === TEST_CAMPAIGN ? "test campaign" : `campaign ${String(c.name || c.id).slice(0, 40)}`);
    report.guard = {
      tripped: trips.map((t) => t.text), thresholds: {
        spend_today_max: spike * dmax, daily_budgets_max: dmax, cap_guard_at: Number.isFinite(cap) ? guardPct * cap : null },
      scope: pol.guard_campaign_ids, campaigns_it_would_pause: targets.map((c) => c.id), on_but_outside_scope: outside.map((c) => c.id),
    };

    if (trips.length && onCamps.length) {
      const why = trips.map((t) => t.text).join("; ");
      const day_key = `cloud:guard:${day}`;
      const canWrite = pol.auto_approve_protective !== false;
      for (const c of targets) {
        report.would.push({ action: "pause", level: "campaign", id: c.id, name: c.name, from: c.status, to: "PAUSED", why, allowed: canWrite });
      }
      if (!canWrite) report.notes.push("auto_approve_protective is false in POLICY.json: the guard alerts but does not pause");
      const results: J[] = [];
      if (!dry && canWrite && targets.length) {
        for (const c of targets) {
          try {
            const { data } = await meta("POST", c.id, { status: "PAUSED" });
            results.push({ id: c.id, ok: !!data.success, response: data });
          } catch (e) {
            const me = e as MetaError;
            if (me.rate) nextState.backoff_until = iso(new Date(Date.now() + BACKOFF_MIN * 60e3));
            results.push({ id: c.id, ok: false, error: me.message });
          }
        }
        let after: J = {};
        const okIds = results.filter((r) => r.ok).map((r) => r.id);
        if (okIds.length) {
          try {
            after = (await meta("GET", "", { ids: okIds.join(","), fields: "id,status,effective_status" })).data;
          } catch (e) {
            report.notes.push(`read-back failed: ${(e as Error).message}`);
          }
        }
        const t = iso();
        for (const r of results) {
          const c = campById.get(r.id)!;
          const a = after[r.id];
          const verified = !!a && a.status === "PAUSED";
          const status = r.ok && (verified || !a) ? "executed" : "failed";
          report.did.push({ action: "pause", id: r.id, status, after: a ?? null, error: r.error ?? null });
          await db("POST", "ops_proposals", [{
            kind: "pause", entity_id: r.id, entity_level: "campaign", entity_name: c.name, from_value: c.status, to_value: "PAUSED",
            reason: `Cloud money guard: ${why}.`, source: "money-guard", status, approved_by: "cloud-guard", approved_at: t,
            executed_at: status === "executed" ? t : null,
            evidence: { trips, spend_today: spendToday, live_daily_budgets: liveBudget, amount_spent: spent, cap, day,
                        policy: { daily_max_usd: dmax, spike_x: spike, cap_guard_pct: guardPct, live: pol.live } },
            result: { before: { status: c.status, effective_status: c.effective_status }, after: a ?? null, response: r.response ?? null,
                      error: r.error ?? null, verified, by: "cloud-guard" },
          }], "return=minimal");
        }
      }
      // in a dry run, word the push as if the pauses had gone through
      const paused = dry && canWrite ? targets.map((c) => ({ id: c.id })) : report.did.filter((d: J) => d.status === "executed");
      const failed = report.did.filter((d: J) => d.status === "failed");
      let msg: string;
      if (paused.length) msg = `MIORA: paused ${paused.map((d: J) => label(campById.get(d.id)!)).join(", ")} — ${why}`;
      else if (failed.length) msg = `MIORA: guard tripped (${why}) but pause FAILED — pause in Ads Manager now`;
      else if (!canWrite && targets.length) msg = `MIORA: guard tripped (${why}); auto-pause is off — pause in Ads Manager`;
      else msg = `MIORA: guard tripped (${why}); nothing in guard scope is on`;
      if (outside.length) msg += `. Also on, not touched: ${outside.map(label).join(", ")}`;
      current.set(day_key, {
        key: day_key, title: "MIORA: money guard", message: msg, priority: 5, tags: ["rotating_light"],
        alert: { kind: "cloud_guard", severity: "bad", entity_id: pol.account_id, entity_level: "account",
                 title: paused.length ? `Cloud guard paused ${paused.length} campaign(s): ${why}` : `Cloud guard tripped: ${why}`,
                 detail: msg.replace(/^MIORA: /, "") + ". The cloud guard only ever pauses; switch back on in Ads Manager after you've checked.",
                 evidence: { trips, did: report.did, would: report.would, outside_scope: outside.map((c) => c.id) } },
      });
    }

    // pushes without a Meta write (keys match ~/example/jobs/ops/alerts.py so the phone gets one push per condition)
    if (statusName !== "ACTIVE") {
      current.set(`account:${statusName}`, { key: `account:${statusName}`, title: "MIORA: ad account problem", meta: true,
        message: `MIORA: ad account is ${statusName} (reason ${acct.disable_reason ?? "?"}). Check billing / account quality.`, priority: 5, tags: ["warning"] });
    }
    // levels (2026-10-30): a rejected ad is URGENT with the ad set and Meta's exact reason; "has issues" is QUIET
    const setName = new Map(sets.map((x) => [x.id, x.name]));
    for (const a of badAds) {
      if (a.effective_status === "DISAPPROVED") {
        const k = `rejected:${a.id}`;
        current.set(k, { key: k, title: "MIORA: ad rejected", meta: true, priority: 5, tags: ["warning"],
          message: `Ad rejected: ${String(a.name || a.id).slice(0, 120)} (in ${String(setName.get(a.adset_id) || a.adset_id || "?").slice(0, 80)})\n`
            + `Meta: ${reviewReason(a.ad_review_feedback) || "no reason given"}` });
      } else {
        const k = `issues:${a.id}`;
        current.set(k, { key: k, title: "MIORA: ad has issues", meta: true, message: `Ad ${String(a.name || a.id).slice(0, 60)} has issues`, priority: 3, tags: ["warning"] });
      }
    }
    for (const e of [...camps, ...sets]) {
      if ((e.effective_status === "WITH_ISSUES" || (e.issues_info || []).length) && e.status !== "ARCHIVED") {
        const lvl = e.campaign_id ? "Ad set" : "Campaign";
        current.set(`issues:${e.id}`, { key: `issues:${e.id}`, title: `MIORA: ${lvl.toLowerCase()} has issues`, meta: true,
          message: `${lvl} ${String(e.name || e.id).slice(0, 40)} has issues`, priority: 3, tags: ["warning"] });
      }
    }
  }

  // --- new conditions -> push; cloud: alerts -> ops_alerts
  const metaKnown = metaOk;   // Meta-derived keys only change when Meta was read
  const nextOpen: Record<string, string> = {};
  for (const [k, since] of Object.entries(open)) {
    const isMeta = !k.startsWith("cloud:mac_stale") && !k.startsWith("cloud:meta_unreadable");
    if (!metaKnown && isMeta) nextOpen[k] = since;          // can't tell: keep as it was
  }
  const fresh: Push[] = [];
  for (const [k, c] of current) {
    nextOpen[k] = open[k] || iso();
    if (!open[k]) fresh.push(c);
  }
  report.conditions = [...current.keys()];
  report.new_conditions = fresh.map((f) => f.key);
  report.would_push = fresh.map((f) => ({ key: f.key, title: f.title, message: f.message, priority: f.priority }));

  if (dry) {
    report.notes.push("dry run: no Meta write, no Supabase write, no push");
    report.ms = Date.now() - t0.getTime();
    return report;
  }

  const p = await pushAll(fresh, "cloud-guard");
  report.pushes = p.sent;
  if (p.held.length) report.notes.push(`pushes held by the 2 h rate limit or failed: ${p.held.join(", ")}${lastPushError ? ` (${lastPushError})` : ""}`);

  // ops_alerts rows for cloud: conditions (alerts.py leaves cloud: keys alone; this function resolves them)
  const existing: J[] = await db("GET", "ops_alerts?select=key,status,first_seen,notified_at&key=like.cloud:*");
  const ex = new Map(existing.map((e) => [e.key, e]));
  const t = iso();
  const rows = [...current.entries()].filter(([, c]) => c.alert).map(([k, c]) => {
    const old = ex.get(k);
    const reopened = !old || old.status !== "open";
    return { key: k, entity_id: null, entity_level: null, ...c.alert, status: "open", last_seen: t, resolved_at: null,
             first_seen: reopened ? t : old!.first_seen, notified_at: p.sent.includes(c.key) ? t : (reopened ? null : old!.notified_at ?? null) };
  });
  if (rows.length) await db("POST", "ops_alerts?on_conflict=key", rows, "resolution=merge-duplicates,return=minimal");
  for (const e of existing) {
    // a guard alert stays open for its account day (the proposal row is the permanent record)
    const keep = current.has(e.key) || (e.key.startsWith("cloud:guard:") && (!metaKnown || e.key === `cloud:guard:${report.reads.account?.day}`));
    if (e.status === "open" && !keep) {
      await db("PATCH", `ops_alerts?key=eq.${encodeURIComponent(e.key)}&status=eq.open`, { status: "resolved", resolved_at: t }, "return=minimal");
    }
  }

  nextState.open = nextOpen;
  nextState.push_requests = [...pushWaiting, ...(p.rid ? [{ rid: p.rid, keys: p.sent, at: iso() }] : [])];
  if (state.last_push_failure) nextState.last_push_failure = state.last_push_failure;
  nextState.last_run = { at: report.at, meta_ok: metaOk, tripped: report.guard?.tripped || [], did: report.did, pushes: p.sent };
  await db("POST", "ops_guard_state?on_conflict=id", [{ id: "money-guard", state: nextState, updated_at: t }], "resolution=merge-duplicates,return=minimal");
  report.ms = Date.now() - t0.getTime();
  return report;
}

Deno.serve(async (req) => {
  if (!sameKey(req.headers.get("x-guard-key") || "", env("MONEY_GUARD_KEY"))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const url = new URL(req.url);
  try {
    if (url.searchParams.get("test_push") === "1") {
      const res = await sendPush("MIORA test alert", "MIORA test alert — recorded by the cloud money guard. External delivery is not in this snapshot.", 3, ["white_check_mark"], "");
      if (!res.ok) return Response.json({ test_push: false, error: lastPushError || "not recorded" });
      await db("POST", "ops_push_log?on_conflict=key", [{ key: "test", last_sent_at: iso(), sent_count: 1, last_title: "MIORA test alert", source: "test" }],
               "resolution=merge-duplicates,return=minimal");
      return Response.json({ test_push: true, via: res.via, delivered: false, note: "Recorded in ops_push_log. Chat delivery is not part of this snapshot." });
    }
    const q = url.searchParams;
    const sim: Sim = q.get("sim_spend") || q.get("sim_on")
      ? { ...(q.get("sim_spend") ? { spend: Number(q.get("sim_spend")) } : {}), ...(q.get("sim_on") ? { on: q.get("sim_on")! } : {}) } : null;
    const out = await run(q.get("dry") === "1", sim);
    console.log(JSON.stringify({ at: out.at, dry: out.dry, meta: out.reads?.meta, tripped: out.guard?.tripped, did: out.did, pushes: out.pushes }));
    return Response.json(out);
  } catch (e) {
    const msg = redact((e as Error).message || String(e));
    console.error("money-guard failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
});
