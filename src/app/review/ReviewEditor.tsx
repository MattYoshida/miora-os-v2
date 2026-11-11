"use client";
import Link from "next/link";
import { createContext, useContext, useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { approve, reject, requestChanges, saveReview, type ReviewEdit } from "./actions";
import { routeKey } from "@/lib/adset-route";
import { gateProblems } from "@/lib/gate";
import { copyQA, ctaRule, bandOf, conceptKey } from "@/lib/copy-qa";
import { revisionStatusLabel, revisionWhen, type RevisionRequest } from "@/lib/revisions";
import { CTAS, VERDICT_STYLE, ctaLabel, findLander, offerFor, pathOnly, type Lander, type LanderGroup } from "@/lib/review-copy";
import { LANDER_PASS, landerGate } from "@/lib/lander-check";
import type { CopyOptions, Oversight, Row } from "@/lib/ads";

// Live landers, shared by every card on the page (sent once, not per card).
const Ctx = createContext<{ landers: Lander[]; groups: LanderGroup[] }>({ landers: [], groups: [] });
export function LandersProvider({ landers, groups, children }: { landers: Lander[]; groups: LanderGroup[]; children: React.ReactNode }) {
  return <Ctx.Provider value={{ landers, groups }}>{children}</Ctx.Provider>;
}

type Item = { text: string; on: boolean; angle?: string; why?: string; rec?: boolean };
type Props = {
  id: string;
  row: Row;                                   // slim tracker row (tags, hook, offer, lander, copy, file.paths)
  rec: { url: string; why: string } | null;   // the router's lander pick + why
  targets: [string, string][];
  initialTarget: string;
  video: ReactNode;
  title: string;                              // angle (or the ad id when it has none)
  openRequest: boolean;                       // an open revision request already exists
  requests: RevisionRequest[];
  children?: ReactNode;                       // QA, hook, scores, and the rest of the old header
};

const len = (s: string) => [...s].length;
const lab = "text-xs font-semibold uppercase tracking-wider text-brand-t";

function initItems(current: string[] = [], opts: CopyOptions["primary"] = []): Item[] {
  const cur = current.filter((t) => t.trim()).map((t) => {
    const o = (opts ?? []).find((x) => x.text.trim() === t.trim());
    return { text: t, on: true, angle: o?.angle, why: o?.why, rec: o?.rec };
  });
  const rest = (opts ?? []).filter((o) => !cur.some((c) => c.text.trim() === o.text.trim())).map((o) => ({ ...o, on: false }));
  return [...cur, ...rest];
}

export function ReviewEditor({ id, row, rec, targets, initialTarget, video, title, openRequest, requests, children }: Props) {
  const { landers, groups } = useContext(Ctx);
  const c = row.copy ?? {}, opts = c.options;
  const [lander, setLander] = useState(String(row.lander ?? ""));
  const [prim, setPrim] = useState<Item[]>(() => initItems(c.primary, opts?.primary));
  const [heads, setHeads] = useState<Item[]>(() => initItems(c.headline, opts?.headline));
  const [desc, setDesc] = useState(Array.isArray(c.description) ? String(c.description[0] ?? "") : String(c.description ?? ""));
  const page = findLander(landers, lander);
  const ruleCta = ctaRule({ ...row, lander }, page);
  const [cta, setCta] = useState(c.cta || opts?.cta || ruleCta.cta);
  const [target, setTarget] = useState(initialTarget);
  const [targetTouched, setTargetTouched] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [changeErr, setChangeErr] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [override, setOverride] = useState(false);

  const offer = offerFor(page) || String(row.offer ?? "");
  const lg = landerGate(row, lander);
  const landerBlocked = lg.state !== "pass" && !override;
  const on = (xs: Item[]) => xs.filter((x) => x.on && x.text.trim()).map((x) => x.text);
  const edit: ReviewEdit = { lander, primary: on(prim), headline: on(heads), description: desc, cta };
  const live: Row = { ...row, lander, offer, copy: { ...c, primary: edit.primary, headline: edit.headline, description: desc, cta } };
  const problems = gateProblems(live, landers);
  const qa = useMemo(() => copyQA(live, edit.primary, edit.headline, desc, cta), [JSON.stringify(edit)]); // eslint-disable-line react-hooks/exhaustive-deps
  const band = bandOf(row), ck = conceptKey(row);
  const recCta = opts?.cta && opts.cta !== ruleCta.cta && pathOnly(lander) === pathOnly(row.lander) ? { cta: opts.cta, why: opts.cta_why ?? "" } : ruleCta;
  const recUrl = rec?.url ?? "";
  const label = (k: string) => targets.find(([x]) => x === k)?.[1] ?? "";
  const parked = label(target).includes("parked");

  const touch = () => { setDirty(true); setMsg(null); };
  const pickLander = (url: string) => {
    setLander(url); touch();
    if (!targetTouched) setTarget(routeKey({ lander: url, angle: row.angle, problem: row.problem }) || target);
  };
  const run = (fn: () => Promise<{ error?: string; ok?: boolean; queued?: boolean }>, ok: string, queuedMsg?: string, stay = false) =>
    start(async () => {
      const r = await fn();
      if (r.error) setMsg(r.error);
      else if (stay) { setDirty(false); setMsg("Saved."); }
      else setDone(r.queued && queuedMsg ? queuedMsg : ok);
    });
  const sendChange = (e: FormEvent) => {
    e.preventDefault();
    setChangeErr(null);
    start(async () => {
      const r = await requestChanges(id, changeNote);
      if (r.error) setChangeErr(r.error);
      else { setAsked(true); setAsking(false); setChangeNote(""); }
    });
  };

  // The overseer's picks, in one click (still needs Save or Approve).
  const ov = row.oversight;
  const applyRec = () => {
    const rc = ov?.recommend ?? {};
    const pick = (items: Item[], want?: string[]) => {
      if (!want?.length) return items;
      const have = items.map((x) => ({ ...x, on: false }));
      for (const t of want) { const i = have.findIndex((x) => x.text.trim() === t.trim()); if (i >= 0) have[i].on = true; else have.push({ text: t, on: true }); }
      return [...want.map((t) => have.find((x) => x.text.trim() === t.trim())!), ...have.filter((x) => !want.some((t) => t.trim() === x.text.trim()))];
    };
    setPrim(pick(prim, rc.primary)); setHeads(pick(heads, rc.headline));
    if (rc.description) setDesc(rc.description);
    if (rc.cta) setCta(rc.cta);
    if (rc.lander && pathOnly(rc.lander) !== pathOnly(lander)) {
      setLander(rc.lander);
      if (!rc.adset) setTarget(routeKey({ lander: rc.lander, angle: row.angle, problem: row.problem }) || target);
    }
    if (rc.adset && targets.some(([k]) => k === rc.adset)) { setTarget(rc.adset); setTargetTouched(true); }
    touch();
  };

  // all landers flat, so a current lander that isn't in the live list still shows
  const allOpts = groups.flatMap((g) => g.opts);
  const currentMissing = lander && !allOpts.some((o) => pathOnly(o.url) === pathOnly(lander));

  const changes = openRequest || asked;
  return (
    <article id={id} className="card scroll-mt-4 space-y-4 p-3 sm:p-4">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
        <div className="w-[200px] max-w-full shrink-0">{video}</div>
        <div className="flex w-full min-w-0 flex-1 flex-col gap-3">
          <div>
            <h2 className="font-serif text-2xl leading-tight tracking-tight">{title}</h2>
            <Link href={`/ads/${encodeURIComponent(id)}`} className="mt-1 inline-block break-all font-mono text-xs text-muted hover:text-brand-t">{id}</Link>
            {changes && <p className="mt-2"><span className="pill border border-warn/40 bg-warn/10 font-semibold text-warn">Changes requested</span></p>}
            <div className="mt-2"><LanderBadge gate={lg} /></div>
          </div>
          {done ? <p className="text-sm text-ok">{done}</p> : (
            <div className="flex flex-col gap-2">
              {!rejecting ? (
                <>
                  <button className="btn btn-primary min-h-14 w-full text-base" disabled={pending || problems.length > 0 || !target || landerBlocked}
                    title={landerBlocked ? lg.msg : undefined}
                    onClick={() => run(() => approve(id, target, dirty ? edit : undefined, override), "Approved. The Mac re-checks it, then sends it to Facebook paused within 10 minutes.",
                      "Approved and queued: that ad set is parked, so it publishes when the set opens.")}>
                    {parked ? "Approve · queue" : "Approve"}
                  </button>
                  <button className="btn btn-bad min-h-14 w-full text-base" disabled={pending} onClick={() => { setRejecting(true); setAsking(false); }}>Reject</button>
                  {dirty && <p className="text-xs text-warn">Unsaved edits in Details. Approve saves them too.</p>}
                  {lg.state !== "pass" && (
                    <label className="flex items-center gap-1.5 text-xs text-warn">
                      <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                      Override the lander check{lg.lc && lg.state === "low" ? ` (${lg.lc.score}/10)` : ""}
                    </label>
                  )}
                </>
              ) : (
                <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => reject(id, reason), "Rejected and parked."); }}>
                  <input autoFocus value={reason} onChange={(e) => { setReason(e.target.value); setMsg(null); }}
                    placeholder="Why? One line, e.g. uncanny face at 0:04" className="field min-w-0" aria-label="Why reject" />
                  <div className="flex gap-2">
                    <button className="btn btn-bad min-h-12 flex-1 text-base" disabled={pending}>Reject</button>
                    <button type="button" className="btn min-h-12" onClick={() => setRejecting(false)}>Cancel</button>
                  </div>
                </form>
              )}
              {asking ? (
                <form className="space-y-2 pt-1" onSubmit={sendChange}>
                  <label className="block">
                    <span className={lab}>What should change?</span>
                    <textarea value={changeNote} onChange={(e) => { setChangeNote(e.target.value); setChangeErr(null); }}
                      rows={3} maxLength={4000} autoFocus className="field mt-1" placeholder="Shorter hook, swap the headline, remove the end card line" />
                  </label>
                  <div className="flex gap-2">
                    <button className="btn btn-primary" disabled={pending || !changeNote.trim()}>Submit</button>
                    <button type="button" className="btn" onClick={() => { setAsking(false); setChangeErr(null); }}>Cancel</button>
                  </div>
                  {changeErr && <p className="text-sm text-bad">{changeErr}</p>}
                </form>
              ) : (
                <button type="button" className="min-h-11 w-full text-sm font-semibold text-brand-t underline disabled:opacity-50" disabled={pending}
                  onClick={() => { setAsking(true); setRejecting(false); setChangeErr(null); }}>
                  Request changes
                </button>
              )}
              {msg && <p className={`text-sm ${msg === "Saved." ? "text-ok" : "text-bad"}`}>{msg}</p>}
            </div>
          )}
        </div>
      </div>

      <details className="rounded-xl border border-line">
        <summary className="cursor-pointer px-3 py-3 text-sm font-semibold">Details</summary>
        <div className="space-y-4 border-t border-line p-3">
          {children}
          {requests.length > 0 && (
            <div className="space-y-2">
              <p className={lab}>Change requests</p>
              <ul className="space-y-2">
                {requests.map((req) => (
                  <li key={req.id} className="rounded-xl border border-line p-3 text-[13px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`pill border font-semibold ${req.status === "done" ? "border-ok/40 bg-ok/10 text-ok" : req.status === "in_progress" ? "border-brand/40 bg-brand/10 text-brand-t" : "border-warn/40 bg-warn/10 text-warn"}`}>{revisionStatusLabel(req.status)}</span>
                      {req.handler && <span className="pill">{req.handler}</span>}
                      <span className="text-xs text-muted">{revisionWhen(req.created_at)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-ink">{req.note}</p>
                    {req.claimed_by && <p className="mt-1 text-xs text-muted">Claimed by {req.claimed_by}{req.claimed_at ? ` · ${revisionWhen(req.claimed_at)}` : ""}</p>}
                    {req.result_note && <p className="mt-1"><span className="font-semibold">Result: </span>{req.result_note}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ov && <OversightBox ov={ov} onApply={applyRec} />}
      {/* Landing page */}
      <div className="space-y-1.5">
        <p className={lab}>Landing page</p>
        <select value={allOpts.find((o) => pathOnly(o.url) === pathOnly(lander))?.url ?? lander} onChange={(e) => pickLander(e.target.value)}
          className="field !py-2" aria-label="Landing page">
          {currentMissing && <option value={lander}>{pathOnly(lander)} (not in the live list)</option>}
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.opts.map((o) => (
                <option key={o.url} value={o.url} disabled={o.disabled}>
                  {pathOnly(o.url) === pathOnly(recUrl) ? "★ " : ""}{o.label}{pathOnly(o.url) === pathOnly(recUrl) ? " · recommended" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {rec && (
          <p className="text-[13px] text-muted">
            <span className="font-semibold text-ink">★ Recommended {pathOnly(rec.url)}</span>: {rec.why}
            {pathOnly(rec.url) !== pathOnly(lander) && (
              <button type="button" className="ml-2 underline hover:text-ink" onClick={() => pickLander(rec.url)}>use it</button>
            )}
          </p>
        )}
        <p className="text-[13px]"><span className="text-muted">Offer: </span>{offer || "—"}{page?.kind ? <span className="pill ml-2">{page.kind}</span> : null}</p>
      </div>

      {(c.copy_source || opts?.why || c.why) && (
        <div className="rounded-xl border border-line bg-chip/40 p-3 text-[13px]">
          {String(c.copy_source ?? "").startsWith("suggested") && <span className="pill mr-2 !bg-brand/15 text-brand-t">Suggested draft</span>}
          {opts?.source && !String(c.copy_source ?? "").startsWith("suggested") && <span className="pill mr-2">Alternatives: {opts.source}</span>}
          <span className="text-muted">Why this copy: </span>{String(c.why ?? opts?.why ?? "")}
        </div>
      )}

      {/* Primary text */}
      <Variants title={`Primary text · ${ck} ad: main text ${band.min}–${band.max} chars`} items={prim} setItems={(x) => { setPrim(x); touch(); }}
        rows={5} lo={band.min} hi={band.max} altLo={band.alt_min} altHi={band.alt_max} />

      {/* Headline */}
      <Variants title="Headline · 40 max (≈27 show)" items={heads} setItems={(x) => { setHeads(x); touch(); }} max={40} lo={1} hi={40} altLo={1} altHi={40} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={lab}>Description · 30 max, often hidden</span>
          <input value={desc} maxLength={30} onChange={(e) => { setDesc(e.target.value); touch(); }} className="field mt-1" list={`desc-${id}`} />
          <datalist id={`desc-${id}`}>{(opts?.description ?? ["Free shipping over $75", "780 GSM · 100% cotton"]).map((d) => <option key={d} value={d} />)}</datalist>
        </label>
        <label className="block">
          <span className={lab}>Button</span>
          <select value={cta} onChange={(e) => { setCta(e.target.value); touch(); }} className="field mt-1 !py-2">
            {CTAS.map(([k, l]) => <option key={k} value={k}>{k === recCta.cta ? `★ ${l} · recommended` : l}</option>)}
          </select>
        </label>
      </div>
      <p className="-mt-2 text-[13px] text-muted">
        <span className="font-semibold text-ink">★ {ctaLabel(recCta.cta)}</span>: {recCta.why}
        {cta !== recCta.cta && <button type="button" className="ml-2 underline hover:text-ink" onClick={() => { setCta(recCta.cta); touch(); }}>use it</button>}
      </p>

      {qa.length > 0 && (
        <details className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-[13px] text-warn" open={qa.length <= 4}>
          <summary className="cursor-pointer font-semibold">Copy check (AD_COPY_SPEC): {qa.length} to look at</summary>
          <ul className="mt-1 list-disc pl-5">{qa.map((q) => <li key={q}>{q}</li>)}</ul>
        </details>
      )}
      {problems.length > 0 && (
        <ul className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}

          <div className="space-y-2">
            <p className="text-sm">
              <span className="text-muted">Goes to: </span>
              {target ? <b>{label(target).replace(" · parked · queued", "")}</b> : <b className="text-warn">no ad set for this lander/angle; pick one</b>}
              {target && parked && <span className="pill ml-2 !bg-warn/15 text-warn">parked · queued</span>}
              {!targetTouched && target && <span className="ml-2 text-xs text-muted">(routed from the lander + angle)</span>}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={target} onChange={(e) => { setTarget(e.target.value); setTargetTouched(true); }} className="field !w-auto !py-2" aria-label="Ad set">
                {!target && <option value="">Pick an ad set</option>}
                {targets.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <button className="btn" disabled={pending || !dirty} onClick={() => run(() => saveReview(id, edit), "", undefined, true)}>Save</button>
            </div>
          </div>
        </div>
      </details>
    </article>
  );
}

// Texts Meta rotates (On) + the suggested alternatives (Off) the admin can switch to or add.
function Variants({ title, items, setItems, rows = 1, max, lo, hi, altLo, altHi }: {
  title: string; items: Item[]; setItems: (x: Item[]) => void; rows?: number; max?: number; lo: number; hi: number; altLo: number; altHi: number;
}) {
  const onIdx = items.map((x, i) => (x.on ? i : -1)).filter((i) => i >= 0);
  const offIdx = items.map((x, i) => (!x.on ? i : -1)).filter((i) => i >= 0);
  const set = (i: number, patch: Partial<Item>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const only = (i: number) => setItems(items.map((x, j) => ({ ...x, on: j === i })));
  const Tag = ({ x }: { x: Item }) => (
    <>
      {x.rec && <span className="pill !bg-brand/15 text-brand-t">★ recommended</span>}
      {x.angle && <span className="pill">{x.angle}</span>}
      {x.why && <span className="text-xs text-muted">{x.why}</span>}
    </>
  );
  const Field = ({ i, x, first }: { i: number; x: Item; first: boolean }) => {
    const n = len(x.text), [a, b] = first ? [lo, hi] : [altLo, altHi], bad = rows > 1 ? n < a || n > b : n > (max ?? 1e9);
    return (
      <div className="flex items-start gap-2">
        {rows > 1
          ? <textarea value={x.text} onChange={(e) => set(i, { text: e.target.value })} rows={rows} className="field whitespace-pre-wrap" />
          : <input value={x.text} maxLength={max} onChange={(e) => set(i, { text: e.target.value })} className="field" />}
        <span className={`w-10 shrink-0 pt-2 text-right text-xs ${bad ? "text-bad" : "text-muted"}`}>{n}</span>
      </div>
    );
  };
  return (
    <div className="space-y-2">
      <p className={lab}>{title}</p>
      {onIdx.length === 0 && <p className="text-[13px] text-warn">Nothing selected: switch on a suggestion below or add one.</p>}
      {onIdx.map((i, k) => (
        <div key={i} className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-muted">{k === 0 ? "Main" : `Rotates #${k + 1}`}</span><Tag x={items[i]} />
            <button type="button" className="ml-auto text-muted underline hover:text-ink" onClick={() => set(i, { on: false })}>take out</button>
          </div>
          {Field({ i, x: items[i], first: k === 0 })}
        </div>
      ))}
      {offIdx.length > 0 && (
        <details className="rounded-xl border border-line p-2">
          <summary className="cursor-pointer text-[13px] font-semibold text-muted">{offIdx.length} alternative{offIdx.length > 1 ? "s" : ""}</summary>
          <div className="mt-2 space-y-3">
            {offIdx.map((i) => (
              <div key={i} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Tag x={items[i]} />
                  <span className="ml-auto flex gap-3">
                    <button type="button" className="underline hover:text-ink" onClick={() => only(i)}>use this instead</button>
                    {onIdx.length < 5 && <button type="button" className="underline hover:text-ink" onClick={() => set(i, { on: true })}>also rotate</button>}
                  </span>
                </div>
                <p className="line-clamp-4 whitespace-pre-line text-[13px] text-muted">{items[i].text}</p>
              </div>
            ))}
          </div>
        </details>
      )}
      {onIdx.length < 5 && (
        <button type="button" className="text-xs text-muted underline hover:text-ink" onClick={() => setItems([...items, { text: "", on: true }])}>+ add your own</button>
      )}
    </div>
  );
}

// raw.lander_check (~/example/jobs/tracker/lander_check.py): small badge, reasons + fix on click. Below 7 blocks
// Approve unless overridden on the card.
function LanderBadge({ gate }: { gate: ReturnType<typeof landerGate> }) {
  const { lc, state, msg } = gate;
  const tone = state === "pass" ? "border-ok/40 bg-ok/10 text-ok" : state === "low" ? "border-bad/40 bg-bad/10 text-bad" : "border-warn/40 bg-warn/10 text-warn";
  const label = state === "missing" ? "Lander check: pending" : state === "stale" ? `Lander check: re-check (was ${lc?.score}/10 on ${lc?.page})`
    : `Lander match ${lc?.score}/10${state === "low" ? ` · below ${LANDER_PASS}` : ""}`;
  return (
    <details className={`inline-block rounded-lg border px-2 py-1 text-xs ${tone}`}>
      <summary className="cursor-pointer font-semibold">{label}</summary>
      <div className="mt-1 max-w-xl space-y-0.5 text-[12px] text-ink">
        {msg && <p>{msg}</p>}
        {(lc?.reasons ?? []).map((x) => <p key={x}>· {x}</p>)}
        {lc?.fix && <p><span className="font-semibold">Fix: </span>{lc.fix}</p>}
        {lc?.facts?.router_pick && !lc.facts.router_match && <p className="text-muted">Router&apos;s pick for these tags: {lc.facts.router_pick}</p>}
        {lc?.checked_at && <p className="text-muted">checked {lc.checked_at.slice(4, 6)}/{lc.checked_at.slice(6, 8)} · {lc.model}</p>}
      </div>
    </details>
  );
}

const RUBRIC: [string, string][] = [["hook", "Hook"], ["fit", "Avatar/angle fit"], ["lander", "Lander"], ["copy", "Copy"], ["production", "Production"], ["novelty", "Novelty"], ["evidence", "Evidence"]];

// The overseer's call (oversee.py → raw.oversight): verdict, conviction, reasons, changes, one-click apply.
function OversightBox({ ov, onApply }: { ov: Oversight; onApply: () => void }) {
  const rc = ov.recommend ?? {};
  const picks = [rc.primary?.length ? `copy: ${rc.primary.length} text${rc.primary.length > 1 ? "s" : ""}` : "", rc.headline?.length ? "headline" : "",
    rc.lander ? `lander ${pathOnly(rc.lander)}` : "", rc.adset ? `ad set ${rc.adset}` : "", rc.cta ? `button ${ctaLabel(rc.cta)}` : "", rc.description ? "description" : ""].filter(Boolean);
  return (
    <div className={`rounded-xl border p-3 text-[13px] ${VERDICT_STYLE[ov.verdict] ?? "border-line"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold tabular-nums">{ov.conviction}</span>
        <span className="font-semibold">{ov.verdict}</span>
        <span className="text-xs opacity-80">overseer · {ov.model ?? ""}{ov.at ? ` · ${ov.at.slice(4, 6)}/${ov.at.slice(6, 8)}` : ""}</span>
        {picks.length > 0 && ov.verdict !== "REJECT" && (
          <button type="button" className="btn ml-auto !min-h-8 !px-3 !text-xs" onClick={onApply} title={`Sets ${picks.join(", ")} on this card (then Save or Approve)`}>
            Apply recommendation
          </button>
        )}
      </div>
      {ov.summary && <p className="mt-1 text-ink">{ov.summary}</p>}
      {(ov.reasons ?? []).length > 0 && <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-ink">{ov.reasons!.map((x) => <li key={x}>{x}</li>)}</ol>}
      {(ov.changes ?? []).length > 0 && (
        <div className="mt-1 text-ink"><span className="font-semibold">Changes: </span>{ov.changes!.join(" · ")}</div>
      )}
      {ov.risk && <p className="mt-1 text-ink"><span className="font-semibold">Risk: </span>{ov.risk}</p>}
      {ov.rubric && (
        <p className="mt-1 text-xs text-muted">
          {RUBRIC.map(([k, l]) => `${l} ${ov.rubric?.[k] ?? "–"}`).join(" · ")}{picks.length ? ` · recommends ${picks.join(", ")}` : ""}
        </p>
      )}
    </div>
  );
}
