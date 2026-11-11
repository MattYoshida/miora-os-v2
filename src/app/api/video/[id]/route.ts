import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getAd, videoOf } from "@/lib/ads";

// Signed link to the file videoOf() picks (the review preview when it exists). The signature lasts
// four hours and is reused for that path so a scroll that re-attaches the same card does not mint a
// new URL on every request. The browser may cache the redirect itself for an hour; the object in
// Storage already carries its own Cache-Control (previews are max-age=86400).
const TTL = 60 * 60 * 4;
const signedCache = new Map<string, { url: string; exp: number }>();

async function signedUrl(sb: Awaited<ReturnType<typeof supabaseServer>>, bucket: string, path: string) {
  const key = `${bucket}/${path}`;
  const now = Date.now();
  const hit = signedCache.get(key);
  if (hit && hit.exp - now > 5 * 60 * 1000) return hit.url;
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, TTL);
  if (error || !data?.signedUrl) return null;
  signedCache.set(key, { url: data.signedUrl, exp: now + TTL * 1000 });
  return data.signedUrl;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const ad = await getAd(sb, id);
  const v = ad && videoOf(ad);
  if (!v) return new Response(null, { status: 404 });
  const url = await signedUrl(sb, v.bucket, v.path);
  if (!url) return new Response(null, { status: 404 });
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=3600" } });
}
