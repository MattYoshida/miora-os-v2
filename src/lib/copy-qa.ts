// Copy quality gate + recommended button, mirrored from ~/example/brand/Ads/AD_COPY_SPEC.md (§2 lengths per ad type,
// §4 button by lander × concept, §6–7 banned list, price and returns rules). copy-qa.json is the spec's `copy_qa:` block,
// exported by `python3 ~/example/jobs/tracker/suggest_copy.py --export-qa ~/example/app/src/lib/copy-qa.json`; the Mac's
// generator runs the same checks (suggest_copy.py qa()) before it saves a draft. Client-safe (no server imports).
import Q from "./copy-qa.json";
import { HOLIDAY, pathOnly, type Lander } from "./review-copy";

type Band = { min: number; max: number; alt_min: number; alt_max: number; emoji_max: number; cta: string };
type Cfg = {
  headline_max: number; description_max: number; line1_max: number; primary: Record<string, Band>;
  cta_never: string[]; cta_story_concepts: string[]; line1_must_not_start_with: string[]; banned: string[];
  case_sensitive_banned?: string[]; warn?: string[]; angle_tags: string[]; description_default: string;
  price_rules: { allowed_prices: string[]; set_price_pairs: Record<string, string>; per_towel_phrase: string; per_towel_max_per_text: number;
    forbid_together: [string, string][]; returns_exact: string; returns_trigger: string };
  ctas: string[];
  live_sales?: { name: string; ends: string; discount?: string; compare_at?: Record<string, string> }[];
  sale_exempt?: string[]; sale_event_end_regex?: string;
};
export const QA = Q as unknown as Cfg;

const len = (s: string) => [...(s ?? "").normalize("NFC")].length;
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿⭐⬆✅❌]/gu;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Ad = { concept?: string; native_type?: unknown; lander?: string; offer?: string; copy?: { event?: unknown } };

// Live, dated sale the ad is tied to (spec "Live sales", the admin 2026-10-30): its copy.event / offer / text names an event in
// live_sales that hasn't ended, or copy.event carries its own "ends Nov 19" date that hasn't passed. While it holds,
// "(was $X)", "% off" and "save $" are allowed; evergreen copy still fails on them.
export type Sale = { name: string; ends: string; compare_at?: Record<string, string> };
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export const todayPT = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
export function liveSale(r: Ad, texts: string[] = [], today = todayPT()): Sale | null {
  const event = typeof r.copy?.event === "string" ? r.copy.event : "";
  const hay = [event, r.offer ?? "", ...texts].join("\n").toLowerCase();
  for (const s of QA.live_sales ?? []) if (s.ends >= today && hay.includes(s.name.toLowerCase())) return s;
  const m = event.match(new RegExp(QA.sale_event_end_regex ?? "$^", "i"));
  if (m) {
    const [y, mo] = today.split("-").map(Number), month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const year = month < mo - 6 ? y + 1 : y;
    const ends = `${year}-${String(month).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
    if (ends >= today) return { name: event, ends };
  }
  return null;
}

export function conceptKey(r: Ad): string {
  const c = r.concept || "ugc-talk";
  if (c === "native" && /story/i.test(String(r.native_type ?? ""))) return "native-story";
  if (c === "native" && /long/i.test(String(r.native_type ?? ""))) return "native-longcaption";
  return c in QA.primary ? c : "ugc-talk";
}
export const bandOf = (r: Ad) => QA.primary[conceptKey(r)];

export function landerType(l: Lander | null | undefined, url?: string): string {
  const path = pathOnly(url ?? l?.path);
  if (!l) return path.startsWith("/products/") ? "product" : "angle";
  const k = l.kind ?? "";
  if (k === "research" || k === "article") return "research";
  if (k === "advertorial" || k === "listicle" || k === "product") return k;
  return HOLIDAY.test(path.split("/").pop() ?? "") ? "holiday" : "angle";
}

// Spec §4: button by lander type × concept (same as suggest_copy.cta_rule).
export function ctaRule(r: Ad, l?: Lander | null): { cta: string; why: string } {
  const lt = landerType(l, r.lander), ck = conceptKey(r), story = QA.cta_story_concepts.includes(ck);
  if (lt === "research" || lt === "advertorial") return { cta: "LEARN_MORE", why: `${lt === "research" ? "Research page (no buy box)" : "Story advertorial"} reads before it sells → Learn More only` };
  if (lt === "listicle") return story ? { cta: "LEARN_MORE", why: "Story-led ad on a “5 reasons” listicle → Learn More" } : { cta: "SHOP_NOW", why: "Product-led ad on a “5 reasons” listicle → Shop Now" };
  if (lt === "angle") return story && ck !== "ugc-story"
    ? { cta: "LEARN_MORE", why: `${ck} is story-led → Learn More (Lymphoria 10/10, AI dramas 8/14 run it)` }
    : { cta: "SHOP_NOW", why: "Angle lander with a big-set buy box → Shop Now, the Sales default" };
  if (lt === "holiday") return { cta: "SHOP_NOW", why: "Holiday page: Shop Now; Order Now only when the copy states a real order-by date" };
  return { cta: "SHOP_NOW", why: "Product page → Shop Now" };
}

export function qaText(t: string, sale: Sale | null = null): string[] {
  const out: string[] = [];
  for (const pat of QA.banned) {
    if (sale && (QA.sale_exempt ?? []).includes(pat)) continue;
    const m = t.match(new RegExp(pat, "i"));
    if (m) out.push(`banned phrase “${m[0]}”`);
  }
  for (const w of QA.case_sensitive_banned ?? []) if (new RegExp(esc(w) + "(?!\\.us)").test(t)) out.push(`write MIORA in caps (found “${w.trim()}”)`);
  const pr = QA.price_rules;
  for (const [a, b] of pr.forbid_together) if (t.includes(a) && new RegExp(b, "i").test(t)) out.push(`“${b.replace(/\\/g, "")}” in the same text as ${a}`);
  if ((t.match(/\$18\.74/g) ?? []).length > pr.per_towel_max_per_text) out.push("per-towel price more than once");
  const saleOk = (p: string) => !!sale && (!sale.compare_at || Object.values(sale.compare_at).includes(p));
  for (const p of t.match(/\$\d[\d,]*\.95\b/g) ?? []) if (!pr.allowed_prices.includes(p) && !saleOk(p)) out.push(`price ${p} isn't a live MIORA price${sale ? ` or a ${sale.name} compare-at price` : ""}`);
  for (const p of Object.values(pr.set_price_pairs)) { const k = t.split(p).length - 1; if (k > 1) out.push(`${p} appears ${k} times in one text (one price line)`); }
  for (const line of t.split("\n")) for (const [name, price] of Object.entries(pr.set_price_pairs)) {
    if (!line.toLowerCase().includes(name.toLowerCase()) || line.includes(price)) continue;
    const other = Object.entries(pr.set_price_pairs).find(([nm, p]) => nm !== name && line.includes(p));
    if (other) out.push(`${name} shown with ${other[1]}`);
  }
  if (new RegExp(pr.returns_trigger, "i").test(t) && !t.toLowerCase().includes(pr.returns_exact.toLowerCase())) out.push(`returns must read exactly “${pr.returns_exact}”`);
  return [...new Set(out)];
}

// Failures for the copy that goes to Meta. primary[0] is held to the recommended band for the ad type, the rest to the
// alternative band. Shown on the Review card; hard publisher rules (headline ≤40, 5 max) also sit in gateProblems().
export function copyQA(r: Ad, primary: string[], headline: string[], description: string, cta: string): string[] {
  const ck = conceptKey(r), b = QA.primary[ck], out: string[] = [];
  const sale = liveSale(r, [...primary, ...headline]);
  primary.forEach((t, i) => {
    const [lo, hi] = i === 0 ? [b.min, b.max] : [b.alt_min, b.alt_max], tag = i === 0 ? "Main text" : `Text ${i + 1}`;
    if (len(t) < lo || len(t) > hi) out.push(`${tag} is ${len(t)} chars; a ${ck} ad needs ${lo}–${hi}`);
    const l1 = t.split("\n")[0];
    if (len(l1) > QA.line1_max) out.push(`${tag}: first line is ${len(l1)} chars (≤${QA.line1_max} shows before “See more”)`);
    if (QA.line1_must_not_start_with.some((w) => l1.trim().toLowerCase().startsWith(w.toLowerCase()))) out.push(`${tag}: open with the hook, not a brand/slogan word`);
    const e = (t.match(EMOJI) ?? []).length;
    if (e > b.emoji_max) out.push(`${tag}: ${e} emoji (max ${b.emoji_max} for ${ck})`);
    const rep = (b as { price_repeat_max?: number }).price_repeat_max ?? 1;
    const ok = ((b as { banned_ok?: string[] }).banned_ok ?? []).map((w) => `banned phrase “${w}”`.toLowerCase());
    out.push(...qaText(t, sale).filter((x) => { const m = x.match(/appears (\d+) times in one text/); return (!m || Number(m[1]) > rep) && !ok.includes(x.toLowerCase()); }).map((x) => `${tag}: ${x}`));
  });
  for (const h of headline) {
    if (len(h) > QA.headline_max) out.push(`Headline “${h}” is ${len(h)} chars (max ${QA.headline_max})`);
    out.push(...qaText(h, sale).map((x) => `Headline: ${x}`));
  }
  if (len(description) > QA.description_max) out.push(`Description is ${len(description)} chars (max ${QA.description_max})`);
  out.push(...qaText(description, sale).map((x) => `Description: ${x}`));
  if (!QA.ctas.includes(cta) || QA.cta_never.includes(cta)) out.push(`Button ${cta || "(none)"} isn't allowed (spec §4: never See More)`);
  return [...new Set(out)];
}
