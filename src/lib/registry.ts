import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Avatar = { slug: string; nickname?: string; who?: string; problem?: string; lander?: string; default_offer?: string };
export type Lander = { path: string; kind?: string; title?: string; sells?: string; sells_name?: string; price?: string; small_set?: boolean };

// Registry meta (avatars + live landers synced from Shopify by the Mac's lander_sync.py).
export async function registryMeta(sb: SupabaseClient): Promise<{ avatars: Avatar[]; landers: Lander[] }> {
  const { data } = await sb.from("registry_docs").select("value").eq("key", "meta").maybeSingle();
  const v = (data?.value ?? {}) as { avatars?: Avatar[]; landers?: Lander[] };
  return { avatars: v.avatars ?? [], landers: v.landers ?? [] };
}

// Enums from ~/example/research/research/creative_framework/schema.json (same lists as the tracker page).
export const E = {
  status: ["script", "draft", "production", "qa", "ready", "live", "winner", "loser", "killed", "parked"],
  problem: ["SKIN", "SMELL", "FEEL", "HOST", "CLEAN", "VALUE", "GIFT"],
  angle: ["routine", "saboteur", "notyou", "upgrade", "money"],
  awareness: ["unaware", "problem", "solution", "product"],
  concept: ["ugc-talk", "ugc-story", "podcast", "vsl", "drama", "animation", "demo", "static", "native", "lander-image"],
  speaker: ["customer", "witness", "expert", "pair", "character", "none"],
  hook_type: ["confession", "callout", "question", "fact", "conflict", "visual"],
  cta: ["SHOP_NOW", "LEARN_MORE", "ORDER_NOW", "GET_OFFER", "BUY_NOW", "SEE_MORE"], // = review-copy CTAS (validated 2026-10-30)
} as const;
