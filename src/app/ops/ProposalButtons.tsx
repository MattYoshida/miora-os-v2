"use client";
import { useState, useTransition } from "react";
import { decide } from "./actions";

// Approve = the admin's explicit yes for this one action. Cancel (on an approved one) = reject before the Mac job runs it.
export function ProposalButtons({ id, status, kind }: { id: string; status: string; kind: string }) {
  const [cur, setCur] = useState(status);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (v: "approved" | "rejected") => start(async () => {
    setMsg(null);
    const r = await decide(id, v);
    if (r.error) setMsg(r.error); else setCur(r.status ?? v);
  });
  const approveLabel = kind === "refresh" ? "Queue" : "Approve";
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {cur !== "proposed" && <span className={`pill ${cur === "approved" ? "!bg-ok/15 text-ok" : "!bg-bad/15 text-bad"}`}>{pending ? "saving…" : cur}</span>}
        {cur === "proposed" && (
          <button className="btn !min-h-8 !px-3 text-ok !border-ok hover:!bg-ok hover:!text-bg" disabled={pending} onClick={() => run("approved")}>
            {pending ? "saving…" : approveLabel}
          </button>
        )}
        {(cur === "proposed" || cur === "approved") && (
          <button className="btn btn-bad !min-h-8 !px-3" disabled={pending} onClick={() => run("rejected")}>
            {cur === "approved" ? "Cancel" : "Reject"}
          </button>
        )}
      </div>
      {msg && <p className="text-xs text-bad">{msg}</p>}
    </div>
  );
}
