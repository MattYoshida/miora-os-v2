// Review "Request changes" rows (public.ad_revision_requests). Shared by the server page and the card.
// The Mac's oversee.py verdict (raw.oversight, including APPROVE WITH CHANGES) is a different thing.

export type RevisionStatus = "requested" | "in_progress" | "done";
export type RevisionHandler = "grok" | "claude";

export type RevisionRequest = {
  id: string;
  ad_id: string;
  ad_name: string;
  note: string;
  status: RevisionStatus;
  handler: RevisionHandler | null;
  claimed_by: string | null;
  claimed_at: string | null;
  result_note: string | null;
  requested_by: string | null;
  created_at: string;
  updated_at: string;
};

// Still with an editor or writer. `done` means the fixed ad is back in the decide queue.
export const revisionOpen = (status: string) => status === "requested" || status === "in_progress";

const STATUS_LABEL: Record<string, string> = { requested: "Requested", in_progress: "In progress", done: "Done" };
export const revisionStatusLabel = (status: string) => STATUS_LABEL[status] ?? status;

// Fixed UTC text so the server render and the client render match.
export function revisionWhen(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}
