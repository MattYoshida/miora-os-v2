"use client";
import { useState, useTransition } from "react";
import { approve, reject } from "./actions";

// targets: [key, label]; parked sets carry "parked · queued" in their label (src/lib/adset-route.ts setLabel).
// landerMsg: why the lander check blocks Approve (src/lib/lander-check.ts landerGate), empty when it passes.
export function ReviewActions({ id, targets, initial, problems, landerMsg = "" }: { id: string; targets: [string, string][]; initial: string; problems: string[]; landerMsg?: string }) {
  const [override, setOverride] = useState(false);
  const [target, setTarget] = useState(initial);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done) return <p className="text-sm text-ok">{done}</p>;
  const run = (fn: () => Promise<{ error?: string; ok?: boolean; queued?: boolean }>, ok: string, queuedMsg?: string) =>
    start(async () => { const r = await fn(); if (r.error) setMsg(r.error); else setDone(r.queued && queuedMsg ? queuedMsg : ok); });
  const label = (k: string) => targets.find(([x]) => x === k)?.[1] ?? "";
  const parked = label(target).includes("parked");

  return (
    <div className="space-y-3">
      {problems.length > 0 && (
        <ul className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      {!rejecting && (
        <p className="text-sm">
          <span className="text-muted">Goes to: </span>
          {initial ? <b>{label(initial).replace(" · parked · queued", "")}</b> : <b className="text-warn">no ad set for this lander/angle; pick one</b>}
          {initial && label(initial).includes("parked") && <span className="pill ml-2 !bg-warn/15 text-warn">parked · queued</span>}
        </p>
      )}
      {!rejecting ? (
        <div className="flex flex-wrap items-center gap-2">
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="field !w-auto !py-2" aria-label="Ad set">
            {!initial && <option value="">Pick an ad set</option>}
            {targets.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <button className="btn btn-primary" disabled={pending || problems.length > 0 || !target || (!!landerMsg && !override)}
            title={landerMsg || undefined}
            onClick={() => run(() => approve(id, target, undefined, override), "Approved. The Mac re-checks it, then sends it to Facebook paused within 10 minutes.",
              "Approved and queued: that ad set is parked, so it publishes when the set opens.")}>
            {parked ? "Approve · queue" : "Approve"}
          </button>
          <button className="btn btn-bad" disabled={pending} onClick={() => setRejecting(true)}>Reject</button>
          {landerMsg && (
            <label className="flex items-center gap-1.5 text-xs text-warn">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              Override the lander check
            </label>
          )}
        </div>
      ) : (
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(() => reject(id, reason), "Rejected and parked."); }}>
          <input autoFocus value={reason} onChange={(e) => { setReason(e.target.value); setMsg(null); }}
            placeholder="Why? One line, e.g. uncanny face at 0:04" className="field flex-1 min-w-0" />
          <button className="btn btn-bad" disabled={pending}>Reject</button>
          <button type="button" className="btn" onClick={() => setRejecting(false)}>Cancel</button>
        </form>
      )}
      {msg && <p className="text-sm text-bad">{msg}</p>}
    </div>
  );
}
