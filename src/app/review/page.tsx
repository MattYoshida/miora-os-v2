import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { adName, listAds, inReview, heldAfterApproval, defaultTarget, laneOf, isStory, type Ad, type Lane, type Row } from "@/lib/ads";
import { targetOptions, type AdSetState } from "@/lib/adset-route";
import { gateProblems, PROBLEM, ANGLE, CONCEPT } from "@/lib/gate";
import { registryMeta } from "@/lib/registry";
import { VERDICT_STYLE, findLander, landerGroups, landerWhy, type Lander } from "@/lib/review-copy";
import { revisionOpen, type RevisionRequest } from "@/lib/revisions";
import { Shell } from "@/components/Shell";
import { AdVideo } from "@/components/AdVideo";
import { NativeImage, NativeStory } from "@/components/NativePost";
import { LandersProvider, ReviewEditor } from "./ReviewEditor";

export const metadata = { title: "Review · MIORA OS" };
export const dynamic = "force-dynamic";

const VERDICTS = ["APPROVE", "APPROVE WITH CHANGES", "HOLD", "REJECT"] as const;

export default async function Review({ searchParams }: { searchParams: Promise<{ verdict?: string; lane?: string }> }) {
  const { sb } = await requireAdmin();
  const { verdict, lane: laneParam } = await searchParams;
  // Two pipelines, two queues: ?lane=native | video (default video).
  const lane: Lane = laneParam === "native" ? "native" : "video";
  // Highest conviction first (the overseer's score, oversee.py), then newest; unscored after scored. Ads the publisher
  // would refuse go in a folded section. ?verdict= filters to one overseer verdict.
  const conv = (a: Ad) => (a.raw.oversight ? Number(a.raw.oversight.conviction) : -1);
  const all0 = await listAds(sb);
  const laneCount = { video: all0.filter((a) => laneOf(a) === "video" && inReview(a)).length, native: all0.filter((a) => laneOf(a) === "native" && inReview(a)).length };
  const listed = all0.filter((a) => laneOf(a) === lane);
  // Approved, then held by the Mac's pre-publish check (prepublish_check.py): shown first with the reason.
  const held = listed.filter(heldAfterApproval);
  const every = listed.filter(inReview)
    .sort((a, b) => conv(b) - conv(a) || String(b.created_on ?? "").localeCompare(String(a.created_on ?? "")) || b.id.localeCompare(a.id, undefined, { numeric: true }));
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, every.filter((a) => a.raw.oversight?.verdict === v).length]));
  const unscored = every.filter((a) => !a.raw.oversight).length;
  const all = verdict === "unscored" ? every.filter((a) => !a.raw.oversight)
    : verdict && (VERDICTS as readonly string[]).includes(verdict) ? every.filter((a) => a.raw.oversight?.verdict === verdict) : every;
  // Live landers: the registry's list (lander_sync.py, with what each page sells), minus pages Shopify no longer
  // publishes (store_pages, hourly). These feed the Landing page dropdown on every card.
  const ids = [...all, ...held].map((a) => a.id);
  const [{ landers: reg }, { data: sp }, { data: st }, pfRes, revRes] = await Promise.all([
    registryMeta(sb),
    sb.from("store_pages").select("path").is("gone_at", null),
    sb.from("registry_docs").select("value").eq("key", "adset_state").maybeSingle(),
    ids.length
      ? sb.from("ad_preflight").select("ad_id,verdict,complete,scores").in("ad_id", ids)
      : Promise.resolve({ data: [] as PreflightRow[], error: null }),
    ids.length
      ? sb.from("ad_revision_requests").select("id,ad_id,ad_name,note,status,handler,claimed_by,claimed_at,result_note,requested_by,created_at,updated_at").in("ad_id", ids).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as RevisionRequest[], error: null }),
  ]);
  if (pfRes.error) throw new Error(pfRes.error.message);
  if (revRes.error) throw new Error(revRes.error.message);
  const livePaths = new Set((sp ?? []).map((p) => p.path as string));
  const landers: Lander[] = livePaths.size ? reg.filter((l) => livePaths.has(l.path)) : reg;
  const groups = landerGroups(landers);
  const ready = all.filter((a) => !gateProblems(a.raw, landers).length), blocked = all.filter((a) => gateProblems(a.raw, landers).length);
  // Every ad set, with the runtime parked state (the buyer can open a parked angle): parked ones queue on approve.
  const targets = targetOptions((st?.value ?? null) as AdSetState);
  // QA pre-flight results (~/example/jobs/tools/qa/preflight.py → ad_preflight), shown inside Details.
  const pre = new Map((pfRes.data ?? []).map((p) => [p.ad_id as string, p as Preflight]));
  const byRequest = new Map<string, RevisionRequest[]>();
  for (const row of (revRes.data ?? []) as RevisionRequest[]) {
    const list = byRequest.get(row.ad_id) ?? [];
    list.push(row);
    byRequest.set(row.ad_id, list);
  }
  const openChange = (a: Ad) => (byRequest.get(a.id) ?? []).some((r) => revisionOpen(r.status));
  const changes = all.filter(openChange);
  const decide = ready.filter((a) => !openChange(a));
  const blockedRest = blocked.filter((a) => !openChange(a));
  const card = (a: Ad) => Card(a, targets, landers, pre.get(a.id), byRequest.get(a.id) ?? []);

  return (
    <Shell active="/review" count={decide.length}>
      <div className="mb-6">
        <p className="eyebrow">Brand veto</p>
        <h1 className="font-serif text-3xl tracking-tight">Ready for review</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Finished ads, highest overseer conviction first. Watch the creative, then approve or reject. Request changes
          when it needs a new cut. Landing page, copy, QA, and the overseer&apos;s notes are under Details. Approve still
          sends it paused to the ad set its lander and angle route to (or the one you pick in Details).
        </p>
      </div>
      <nav className="mb-3 flex gap-1 border-b border-line text-sm" aria-label="Pipeline">
        {([["video", "Video pipeline"], ["native", "Native pipeline"]] as [Lane, string][]).map(([k, l]) => (
          <Link key={k} href={k === "native" ? "/review?lane=native" : "/review"}
            className={`-mb-px border-b-2 px-3 py-2 font-semibold ${lane === k ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {l} <span className="text-muted">{laneCount[k]}</span>
          </Link>
        ))}
      </nav>
      {lane === "native" && (
        <p className="mb-3 max-w-2xl text-[13px] text-muted">
          Story ads where the text is the advertorial (Ads/natives, NATIVE_PLAYBOOK.md). Facebook Feed only, no Instagram.
          They route to the N1 native ad set, which isn&apos;t created yet, so an approval queues until you say go.
        </p>
      )}
      <nav className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="Filter by overseer verdict">
        {[["", `All ${every.length}`], ...VERDICTS.map((v) => [v, `${v.toLowerCase()} ${counts[v]}`]), ...(unscored ? [["unscored", `not scored ${unscored}`]] : [])].map(([k, l]) => (
          <Link key={k} href={`/review?${new URLSearchParams({ ...(lane === "native" ? { lane } : {}), ...(k ? { verdict: k } : {}) })}`}
            className={`pill !px-3 !py-1 ${(verdict ?? "") === k ? "!bg-ink text-bg" : "hover:bg-line"}`}>{l}</Link>
        ))}
      </nav>
      <LandersProvider landers={landers} groups={groups}>
      {held.length > 0 && (
        <section className="mb-8 space-y-4" aria-label="Held after approval">
          <div className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
            <b>Held after approval: {held.length}.</b> The Mac&apos;s pre-publish check stopped these before anything went to
            Facebook. Each shows why; fix it here and approve again.
          </div>
          {held.map((a) => (
            <div key={a.id} className="space-y-2">
              <p className="text-[13px] text-bad"><span className="font-semibold">{a.id} held: </span>{String(a.raw.publish?.hold_reason ?? "")}</p>
              {card(a)}
            </div>
          ))}
        </section>
      )}
      {decide.length === 0 && changes.length === 0 && blockedRest.length === 0 && <p className="card p-8 text-center text-muted">Nothing waiting. New finished ads land here automatically.</p>}
      {decide.length === 0 && (changes.length > 0 || blockedRest.length > 0) && <p className="mb-4 text-sm text-muted">Nothing new to approve or reject.</p>}
      <div className="space-y-4">{decide.map(card)}</div>
      {changes.length > 0 && (
        <section className="mt-8" aria-label="Changes requested">
          <h2 className="mb-3 text-sm font-semibold">Changes requested <span className="text-muted">{changes.length}</span></h2>
          <div className="space-y-4">{changes.map(card)}</div>
        </section>
      )}
      {blockedRest.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-semibold text-muted">
            {blockedRest.length} finished ads can&apos;t be approved yet (missing copy, tags or file). Open one to fix it here, or reject it.
          </summary>
          <div className="mt-4 space-y-4">{blockedRest.map(card)}</div>
        </details>
      )}
      </LandersProvider>
    </Shell>
  );
}

type Preflight = { verdict?: string; complete?: boolean; scores?: { summary?: { overall?: number; fixes?: string[] } } };
type PreflightRow = Preflight & { ad_id?: string };

function PreflightBox({ p }: { p?: Preflight }) {
  if (!p) return <p className="text-xs text-muted">QA pre-flight: not run yet</p>;
  const fixes = p.scores?.summary?.fixes ?? [], pass = p.verdict === "pass";
  return (
    <details className={`rounded-xl border p-3 text-sm ${pass ? "border-ok/40 bg-ok/10" : "border-bad/40 bg-bad/10"}`} open={!pass}>
      <summary className={`cursor-pointer font-semibold ${pass ? "text-ok" : "text-bad"}`}>
        QA pre-flight: {pass ? "pass" : "needs fixes"}{p.scores?.summary?.overall != null ? ` · ${p.scores.summary.overall}/100` : ""}{p.complete === false ? " · AI check pending" : ""}
      </summary>
      {fixes.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px]">{fixes.slice(0, 8).map((f, i) => <li key={i}>{f}</li>)}</ul>}
    </details>
  );
}

// The router's pick (landers.py): the current lander while the router owns the row, else the pick saved when the admin chose by hand.
function recommended(r: Row, landers: Lander[]) {
  const url = r.lander_choice === "manual" ? r.lander_suggested?.url : r.lander;
  const why = r.lander_choice === "manual" ? r.lander_suggested?.why : r.lander_routed;
  return url ? { url: String(url), why: landerWhy(r, why, findLander(landers, url)) } : null;
}

// Only what the editor needs (keeps the page payload small: no QA notes, scripts or results).
function slim(r: Row): Row {
  const { id, problem, avatar, angle, concept, hook, hook_type, native_type, offer, lander, copy, file, oversight, lander_check } = r;
  return { id, problem, avatar, angle, concept, hook, hook_type, native_type, offer, lander, copy, file: { paths: file?.paths ?? [] }, oversight, lander_check };
}

function Card(a: Ad, targets: [string, string][], landers: Lander[], pre: Preflight | undefined, requests: RevisionRequest[]) {
  const r = a.raw;
  const angle = ANGLE[r.angle ?? ""] ?? r.angle ?? a.id;
  return (
    <ReviewEditor key={a.id} id={a.id} row={slim(r)} rec={recommended(r, landers)} targets={targets} initialTarget={defaultTarget(r)}
      video={isStory(a) ? <NativeImage ad={a} /> : <AdVideo ad={a} className="w-full" />} title={String(angle)} openRequest={requests.some((req) => revisionOpen(req.status))} requests={requests}>
      <div className="space-y-2 text-sm">
        <p><span className="text-muted">Ad name </span><span className="break-all font-mono text-xs">{adName(r)}</span></p>
        <div className="flex flex-wrap items-center gap-2">
          {r.oversight ? <span className={`pill border font-semibold ${VERDICT_STYLE[r.oversight.verdict] ?? ""}`}>{r.oversight.conviction} · {r.oversight.verdict}</span> : null}
          {r.conviction ? <span className="pill">script conviction {String(r.conviction)}</span> : null}
        </div>
        <p className="text-muted">
          {[PROBLEM[r.problem ?? ""] ?? r.problem, r.avatar, ANGLE[r.angle ?? ""] ?? r.angle, CONCEPT[r.concept ?? ""] ?? r.concept, r.hook_n]
            .filter(Boolean).join(" › ")}
        </p>
        {r.hook ? <p className="font-serif text-lg leading-snug">“{r.hook}”</p> : null}
        {r.notes ? <p className="text-muted">{r.notes}</p> : null}
        {isStory(a) ? <NativeStory ad={a} /> : null}
      </div>
      <PreflightBox p={pre} />
    </ReviewEditor>
  );
}
