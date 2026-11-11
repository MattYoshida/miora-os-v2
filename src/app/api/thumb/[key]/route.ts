import { supabaseServer } from "@/lib/supabase/server";

// Thumbnails live base64 in ad_thumbs, keyed by Meta ad id or registry id; pass the registry id. RLS limits them to admins.
const EMPTY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><rect width="400" height="500" fill="#ebe7e4"/><text x="200" y="255" text-anchor="middle" font-family="Inter,sans-serif" font-size="20" letter-spacing="3" fill="#5b6370">NO MEDIA YET</text></svg>`;

export async function GET(_: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const sb = await supabaseServer();
  const { data: ad } = await sb.from("ads").select("meta_ad_id").eq("id", key).maybeSingle();
  const keys = [ad?.meta_ad_id, key].filter(Boolean) as string[];
  const { data } = await sb.from("ad_thumbs").select("key,data").in("key", keys);
  const hit = keys.map((k) => data?.find((d) => d.key === k)).find(Boolean);
  if (!hit?.data)
    return new Response(EMPTY, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=600" } });
  return new Response(Buffer.from(hit.data, "base64"), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
  });
}
