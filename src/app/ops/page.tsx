import { Markdown } from "@/components/lrn-markdown";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Shell } from "@/components/Shell";
import { loadOps, type Proposal, type CampaignView, type Alert, type LanderTest, type Capacity } from "@/lib/ops-data";
import { adSets } from "@/lib/adset-route";
import { KIND, KIND_EFFECT, LEVEL, ago, at, change, statusLabel, statusTone, usd } from "@/lib/ops-labels";
import { adHref } from "@/lib/lrn-labels";
import { ProposalButtons } from "./ProposalButtons";

export const metadata = { title: "Ads · MIORA OS" };
export const dynamic = "force-dynamic";

const MAX_ADS = 10; // publisher.py MAX_ADS

export default async function Ops() {
  const { sb } = await requireAdmin();
  const v = await loadOps(sb);
  // Daily review written by the cloud routine "MIORA daily media-buyer review" (Opus, 08:30 PT).
  const { data: cr } = await sb.from("registry_docs").select("value").eq("key", "cloud_buyer_review").maybeSingle();
  const cloud = (cr?.value ?? null) as { saved_at?: string; markdown?: string } | null;
  const a = v.account;
  const cap = Number(a?.extra?.spend_cap ?? 0);
  const spent = Number(a?.extra?.amount_spent ?? 0);
  const pct = cap ? Math.min(1, spent / cap) : 0;
  const parkedIds = new Set(adSets(v.adsetState).filter((s) => s.parked).map((s) => s.adset));

  return (
    <Shell active="/ops">
      <div className="mb-5">
        <p className="eyebrow">Meta ad account</p>
        <h1 className="font-serif text-3xl tracking-tight">Ads</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Snapshot {v.snapshotAt ? <>{ago(v.snapshotAt)} ({at(v.snapshotAt)})</> : "not taken yet"}, refreshed hourly by the Mac.
          The app never calls Meta. The Mac&apos;s buyer acts on its own inside POLICY.json (kills, cuts, scale steps, the
          daily-max guard and, once it&apos;s live, switching on newly published ads); anything outside the policy waits here
          for your tap. Everything is re-checked against Meta before it runs.
        </p>
        {v.report && <BuyerCard r={v.report} />}
        {cloud?.markdown && (
          <details className="card mt-3 p-4" open>
            <summary className="cursor-pointer text-sm font-semibold">Daily review from the cloud media buyer{cloud.saved_at ? ` · ${ago(cloud.saved_at)}` : ""}</summary>
            <div className="mt-3 text-sm leading-relaxed"><Markdown text={cloud.markdown} /></div>
          </details>
        )}
        {v.stale && (
          <p className="card mt-3 border-warn/40 p-3 text-sm text-warn">
            The snapshot is over 3 hours old, so these numbers may be out of date (rate-limit backoff, token or the Mac asleep).
          </p>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Account" value={statusLabel(a?.effective_status)} tone={statusTone(a?.effective_status)} />
        <Stat label="Spent today" value={usd(a?.spend_today)} sub={a?.spend_day ? `account day ${a.spend_day}` : undefined} />
        {v.report?.stats?.daily_max_usd
          ? <Stat label="Daily budgets on" value={`${usd(v.report.stats.armed_budget ?? 0)} / ${usd(v.report.stats.daily_max_usd)}`}
              sub={`max per day · ${usd(v.activeBudgets)} delivering now`} />
          : <Stat label="Active daily budgets" value={usd(v.activeBudgets)} sub="delivering ad sets + CBO campaigns" />}
        <div className="card p-4">
          <p className="text-xs text-muted">Spend cap</p>
          <p className="mt-1 font-serif text-2xl leading-none">{cap ? `${Math.round(pct * 100)}%` : "none"}</p>
          {cap > 0 && (
            <>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-chip">
                <div className={`h-full rounded-full ${pct >= 0.95 ? "bg-bad" : pct >= 0.8 ? "bg-warn" : "bg-brand"}`} style={{ width: `${pct * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">{usd(spent)} of {usd(cap)}</p>
            </>
          )}
        </div>
      </section>

      <Section title="Open alerts" count={v.alerts.length} empty="Nothing needs attention.">
        {v.alerts.map((al) => <AlertRow key={al.id} al={al} />)}
      </Section>

      <Section title="What the buyer did" count={v.buyer.length}
        empty="The buyer hasn't acted yet. Its actions (each approved by POLICY.json, then re-checked and run by the Mac) show here.">
        {v.buyer.map((p) => <ResultRow key={p.id} p={p} />)}
      </Section>

      <Section title="Waiting for your decision" count={v.waiting.length}
        empty="Nothing outside the policy. Verdicts (daily, after the 07:30 results), the fatigue check and the buyer put anything the policy doesn't cover here.">
        {v.waiting.map((p) => <ProposalRow key={p.id} p={p} />)}
      </Section>

      {v.queued.length > 0 && (
        <Section title="Approved" count={v.queued.length}>
          {v.queued.map((p) => <ProposalRow key={p.id} p={p} />)}
        </Section>
      )}

      {v.landerTest && <LanderTestCard t={v.landerTest} />}

      {v.capacity && <CapacityCard c={v.capacity} />}

      <Section title="Campaigns and ad sets" count={v.campaigns.length} empty="No campaigns in the snapshot.">
        {v.campaigns.map((c) => <CampaignCard key={c.id} c={c} parked={parkedIds} />)}
      </Section>

      <Section title="Recent decisions and executions" count={v.recent.length} empty="Nothing has run yet.">
        {v.recent.map((p) => <ResultRow key={p.id} p={p} />)}
      </Section>
    </Shell>
  );
}

function BuyerCard({ r }: { r: NonNullable<Awaited<ReturnType<typeof loadOps>>["report"]> }) {
  const st = r.stats ?? {};
  return (
    <div className={`card mt-3 p-4 ${st.policy_error ? "border-bad/40" : st.live ? "border-ok/40" : "border-brand/40 bg-soft"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`pill ${st.live ? "!bg-ok/15 text-ok" : ""}`}>{st.live ? "buyer live" : "buyer off: protective only"}</span>
        <span className="text-xs text-muted">{r.day} · updated {ago(r.updated_at)}</span>
      </div>
      <p className="mt-1.5 break-words text-sm">{r.summary}</p>
      {st.policy_error && <p className="mt-1 text-xs text-bad">{st.policy_error}</p>}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-serif text-2xl leading-none">
        {tone !== undefined ? <span className={`pill !text-sm ${tone}`}>{value}</span> : value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-baseline gap-2 font-serif text-xl">{title}<span className="text-sm text-muted">{count}</span></h2>
      {count ? <div className="space-y-3">{children}</div> : <p className="card p-5 text-sm text-muted">{empty}</p>}
    </section>
  );
}

function AlertRow({ al }: { al: Alert }) {
  return (
    <article className={`card p-4 ${al.severity === "bad" ? "border-bad/40" : al.severity === "warn" ? "border-warn/40" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`pill ${statusTone(al.severity)}`}>{al.severity === "bad" ? "urgent" : al.severity}</span>
        <h3 className="min-w-0 flex-1 break-words font-semibold">{al.title}</h3>
      </div>
      {al.detail && <p className="mt-1.5 break-words text-sm text-muted">{al.detail}</p>}
      <p className="mt-1.5 text-xs text-muted">
        Since {at(al.first_seen)} · last seen {ago(al.last_seen)}{al.entity_id && <> · <span className="break-all font-mono">{al.entity_id}</span></>}
      </p>
    </article>
  );
}

function regId(p: Proposal): string | null {
  const r = (p.evidence as { registry_id?: unknown })?.registry_id;
  return typeof r === "string" && /^[A-Za-z0-9_.-]{1,160}$/.test(r) ? r : null;
}

function Evidence({ e }: { e: Record<string, unknown> }) {
  const keys = ["spend", "purchases", "cpa", "ctr", "impressions", "hookrate", "spend_7d", "purchases_7d", "cpa_7d", "spend_3d",
    "purchases_3d", "frequency_7d", "rule", "test"].filter((k) => e[k] !== undefined && e[k] !== null);
  if (!keys.length) return null;
  const fmt = (k: string, x: unknown) =>
    /spend|cpa/.test(k) ? usd(x) : k === "ctr" || k === "hookrate" ? `${x}%` : typeof x === "number" ? x.toLocaleString("en-US") : String(x);
  return (
    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {keys.map((k) => (
        <div key={k} className="flex gap-1"><dt className="text-muted">{k.replace(/_/g, " ")}</dt><dd className="break-all">{fmt(k, e[k])}</dd></div>
      ))}
    </dl>
  );
}

function ProposalRow({ p }: { p: Proposal }) {
  const rid = regId(p);
  return (
    <article className="card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill !bg-brand/15 text-brand-t">{KIND[p.kind] ?? p.kind}</span>
            <span className="text-xs text-muted">{LEVEL[p.entity_level ?? ""] ?? p.entity_level}</span>
            <b className="text-sm">{change(p.kind, p.from_value, p.to_value)}</b>
          </div>
          <h3 className="mt-1.5 break-words font-semibold">{p.entity_name || p.entity_id}</h3>
          <p className="mt-1 break-words text-sm leading-relaxed">{p.reason}</p>
          <Evidence e={p.evidence ?? {}} />
          <p className="mt-2 text-xs text-muted">
            {KIND_EFFECT[p.kind]} Proposed {at(p.created_at)} by {p.source ?? "a job"}
            {rid && <> · <Link href={adHref(rid)} className="font-mono text-brand-t hover:underline">{rid}</Link></>}
            {p.status === "approved" && p.approved_at && <> · approved {ago(p.approved_at)}</>}
          </p>
        </div>
        <ProposalButtons id={p.id} status={p.status} kind={p.kind} />
      </div>
    </article>
  );
}

function ResultRow({ p }: { p: Proposal }) {
  const r = (p.result ?? {}) as { reason?: string; error?: string; verified?: boolean };
  const why = (p.evidence as { policy?: unknown } | null)?.policy;
  return (
    <article className="card flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
      <span className={`pill ${statusTone(p.status)}`}>{p.status === "approved" ? "queued" : p.status}</span>
      <span className="font-semibold">{KIND[p.kind] ?? p.kind}</span>
      <span className="min-w-0 flex-1 break-words">{p.entity_name || p.entity_id} · {change(p.kind, p.from_value, p.to_value)}</span>
      <span className="text-xs text-muted">{at(p.executed_at ?? p.updated_at)}</span>
      {p.approved_by === "policy" && <p className="w-full break-words text-xs text-muted">{p.reason}{typeof why === "string" ? ` (${why})` : ""}</p>}
      {(r.reason || r.error) && <p className="w-full break-words text-xs text-muted">{r.reason || r.error}</p>}
      {p.status === "executed" && r.verified === false && <p className="w-full text-xs text-warn">Written, but the check read-back didn&apos;t confirm it.</p>}
    </article>
  );
}

function LanderTestCard({ t }: { t: LanderTest }) {
  const arms = Object.entries(t.arms ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(2)}%`);
  return (
    <section className="mt-8">
      <h2 className="mb-1 font-serif text-xl">Lander test · product page vs angle page</h2>
      <p className="mb-3 text-sm text-muted">{t.question} Ad set 03, same 2 creatives in both arms. Read it when {t.read_when}. Updated {ago(t.saved_at)}.</p>
      <div className="card overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Arm</th>
              <th className="px-3 py-2.5 text-right font-semibold">Spend</th>
              <th className="px-3 py-2.5 text-right font-semibold">CTR</th>
              <th className="px-3 py-2.5 text-right font-semibold">ATC</th>
              <th className="px-3 py-2.5 text-right font-semibold">Cost / ATC</th>
              <th className="px-3 py-2.5 text-right font-semibold">CVR</th>
              <th className="px-3 py-2.5 text-right font-semibold">CPA</th>
            </tr>
          </thead>
          <tbody>
            {arms.map(([arm, a]) => (
              <tr key={arm} className="border-b border-line last:border-0">
                <td className="px-3 py-2">
                  <b>{arm === "pdp" ? "Product page" : arm === "angle" ? "Angle page" : arm}</b>
                  <span className="block break-all text-xs text-muted">{(a.lander ?? "").replace(/^https?:\/\/[^/]+/, "")}</span>
                  <span className="block text-xs text-muted">{(a.ads ?? []).filter((x) => x.meta_ad_id).length}/{(a.ads ?? []).length} in Meta</span>
                </td>
                <td className="px-3 py-2 text-right">{usd(a.spend)}</td>
                <td className="px-3 py-2 text-right">{pct(a.ctr)}</td>
                <td className="px-3 py-2 text-right">{a.atc ?? 0}</td>
                <td className="px-3 py-2 text-right">{a.cost_per_atc ? usd(a.cost_per_atc) : "—"}</td>
                <td className="px-3 py-2 text-right">{pct(a.cvr)}</td>
                <td className="px-3 py-2 text-right">{a.cpa ? usd(a.cpa) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CapacityCard({ c }: { c: Capacity }) {
  const sets = Object.entries(c.sets ?? {});
  const parked = Object.entries(c.parked ?? {}).filter(([, p]) => p.queued > 0);
  return (
    <section className="mt-8">
      <h2 className="mb-1 flex items-baseline gap-2 font-serif text-xl">Production capacity
        <span className="text-sm text-muted">make ≤ {c.weekly_target} new this week</span></h2>
      <p className="mb-3 text-sm text-muted">
        Rotation keeps ≤ {c.max_active_per_set} ads on per open set and swaps the weakest every {c.rotate_every_days} days
        {c.rotation ? "" : " (rotation is off)"}{c.live ? "" : "; the buyer isn't live yet"}. Copies of winners (EMULATE) first,
        then the highest-conviction originals. {c.emulate_in_production} EMULATE ad(s) in production. Updated {ago(c.saved_at)}.
      </p>
      <ul className="card divide-y divide-line">
        {sets.map(([k, s]) => (
          <li key={k} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:grid-cols-[1fr_6rem_8rem_7rem_5rem] sm:items-center">
            <span className="min-w-0 break-words">{s.label}</span>
            <span className="text-right text-xs text-muted sm:text-sm">{s.on}/{s.cap} on</span>
            <span className="text-xs text-muted sm:text-right sm:text-sm">{s.never_run_in_meta} ready in Meta</span>
            <span className="text-right text-xs text-muted sm:text-sm">{s.waiting_to_publish} to publish</span>
            <span className={`col-span-2 text-xs font-semibold sm:col-span-1 sm:text-right sm:text-sm ${s.need ? "text-warn" : "text-ok"}`}>
              {s.need ? `need ${s.need}` : "covered"}
            </span>
          </li>
        ))}
        {parked.length > 0 && (
          <li className="px-4 py-2.5 text-xs text-muted">
            Parked queues: {parked.map(([, p]) => `${p.label} (${p.queued})`).join(" · ")}. One opens when the rules close an open set.
          </li>
        )}
      </ul>
    </section>
  );
}

function CampaignCard({ c, parked }: { c: CampaignView; parked: Set<string> }) {
  return (
    <article className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
        <span className={`pill ${statusTone(c.effective_status)}`}>{statusLabel(c.effective_status)}</span>
        <h3 className="min-w-0 flex-1 break-words font-semibold">{c.name}</h3>
        <span className="text-xs text-muted">
          {c.daily_budget ? `${usd(c.daily_budget)}/day CBO · ` : c.adsets.length ? "ABO · " : ""}today {usd(c.spend_today)} · {c.ads} ads
        </span>
      </div>
      {c.adsets.length > 0 && (
        <ul className="divide-y divide-line">
          {c.adsets.map((s) => (
            <li key={s.id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:grid-cols-[1fr_7rem_6rem_6rem_5rem] sm:items-center">
              <div className="min-w-0">
                <span className="break-words">{s.name}</span>
                {s.issues?.length ? <span className="pill ml-2 !bg-warn/15 text-warn">issues</span> : null}
                {parked.has(s.id) ? <span className="pill ml-2">parked · queued</span> : null}
              </div>
              <span className={`pill justify-self-end sm:justify-self-start ${statusTone(s.effective_status)}`}>{statusLabel(s.effective_status)}</span>
              <span className="text-xs text-muted sm:text-right sm:text-sm sm:text-ink">{s.daily_budget ? `${usd(s.daily_budget)}/day` : "—"}</span>
              <span className="text-right text-xs text-muted sm:text-sm sm:text-ink">today {usd(s.spend_today)}</span>
              <span className={`col-span-2 text-xs sm:col-span-1 sm:text-right sm:text-sm ${s.ads >= MAX_ADS ? "text-bad" : "text-muted"}`}>
                {s.ads}/{MAX_ADS} ads{s.delivering ? ` · ${s.delivering} on` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
