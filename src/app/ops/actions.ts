"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";

// Approve / reject a proposal. This only updates ops_proposals (as the signed-in admin, RLS); the app never calls Meta.
// An approved pause / archive / budget is picked up by the Mac's execute_approved.py (every 10 min), which re-checks
// that Meta is still in the state the proposal saw before it writes anything. Activation is never executed by a job.
// Approve works only on a 'proposed' row; reject also cancels an approved one the job hasn't run yet.
// A database trigger keeps the action itself (kind, entity, from/to) unchangeable.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function decide(id: string, decision: "approved" | "rejected") {
  const { sb, user } = await requireAdmin();
  if (!UUID.test(id)) return { error: "Unknown proposal." };
  if (decision !== "approved" && decision !== "rejected") return { error: "Unknown choice." };
  const from = decision === "approved" ? ["proposed"] : ["proposed", "approved"];
  const { data, error } = await sb.from("ops_proposals")
    .update({ status: decision, approved_by: user.email ?? user.id, approved_at: new Date().toISOString() })
    .eq("id", id).in("status", from).select("id,status");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "It changed meanwhile (already decided or executed). Reload." };
  revalidatePath("/ops");
  return { ok: true, status: data[0].status as string };
}
