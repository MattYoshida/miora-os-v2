import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { opsCounts } from "@/lib/ops-data";

// Thin banner for the Shell: open ad alerts (rejected ads, spend spike, spend cap, no delivery …) and proposals
// waiting for a decision, linking to /ops. Renders nothing when there is nothing open or the viewer isn't an admin
// (RLS returns no rows). Server component; safe to mount above <main>.
export async function OpsAlertBanner() {
  const sb = await supabaseServer();
  const { alerts, bad, waiting } = await opsCounts(sb);
  if (!alerts && !waiting) return null;
  const tone = bad ? "border-bad/40 bg-bad/10 text-bad" : alerts ? "border-warn/40 bg-warn/10 text-warn" : "border-line bg-soft text-ink";
  return (
    <Link href="/ops" className={`block border-b px-4 py-2 text-center text-[13px] font-semibold ${tone}`}>
      {alerts > 0 && <>{alerts} open ad alert{alerts > 1 ? "s" : ""}{bad ? ` (${bad} urgent)` : ""}</>}
      {alerts > 0 && waiting > 0 && " · "}
      {waiting > 0 && <>{waiting} proposal{waiting > 1 ? "s" : ""} to approve</>}
      <span className="ml-1 opacity-70">→ Ads</span>
    </Link>
  );
}
