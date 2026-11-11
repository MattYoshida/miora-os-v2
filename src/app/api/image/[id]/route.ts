import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getAd, imageOf } from "@/lib/ads";

// Signed link to a native ad's still (media.image, uploaded by ~/example/jobs/tracker/register_natives.py).
const TTL = 60 * 60 * 4;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const ad = await getAd(sb, id);
  const img = ad && imageOf(ad);
  if (!img) return new Response(null, { status: 404 });
  const { data, error } = await sb.storage.from(img.bucket).createSignedUrl(img.path, TTL);
  if (error || !data?.signedUrl) return new Response(null, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "private, max-age=3600" } });
}
