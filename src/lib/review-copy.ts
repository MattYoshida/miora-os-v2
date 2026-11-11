// Review-screen helpers shared by the server page and the client editor (no server-only imports).
// Copy rules (lengths, CTA, QA) live in copy-qa.ts (mirror of ~/example/brand/Ads/AD_COPY_SPEC.md). Live landers: the registry
// (registry_docs.meta.landers, synced read-only from Shopify by ~/example/jobs/tracker/lander_sync.py), checked
// against store_pages (gone_at is null).

export type Lander = { path: string; kind?: string; title?: string; sells?: string; sells_name?: string; price?: string; small_set?: boolean };
export type CopyFields = { primary: string[]; headline: string[]; description: string; cta: string };

// Meta call_to_action types that fit a Shopify DTC sales ad. All six passed Meta validate_only (Graph v25, existing
// ad set, adpipe validate, 2026-10-30). The Mac publisher (~/example/jobs/tracker/publisher.py CTAS) accepts the same list.
// AD_COPY_SPEC §4: SHOP_NOW default, LEARN_MORE story/advertorial, ORDER_NOW only with a real order-by date, GET_OFFER only
// with a live dated event offer, BUY_NOW only for product-page closers, SEE_MORE never.
export const CTAS: [string, string][] = [
  ["SHOP_NOW", "Shop Now"],
  ["LEARN_MORE", "Learn More"],
  ["ORDER_NOW", "Order Now"],
  ["GET_OFFER", "Get Offer"],
  ["BUY_NOW", "Buy Now"],
  ["SEE_MORE", "See More"],
];
export const CTA_KEYS = CTAS.map(([k]) => k);
export const ctaLabel = (k?: string) => CTAS.find(([x]) => x === k)?.[1] ?? k ?? "";

export const SITE = "https://store.example.com";
export const SMALL_SETS = ["face-towels", "hand-and-face-set", "the-essential-pair", "the-skin-set", "the-vanity-set", "the-essential-spa-set", "bath-towels"];
export const HOLIDAY = /(^|-)(sale|black-friday|cyber|thanksgiving|gift|christmas|holiday|white-sale|galentines|valentines?|mothers-day|fathers-day|new-year)(-|$)/;

// "/pages/feel?view=x" from any store.example.com URL or path.
export function pathOnly(u?: string | null): string {
  const x = String(u ?? "").trim().replace(/^https?:\/\/(www\.)?store\.example\.com/i, "");
  return (x.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/").toLowerCase();
}
export const toUrl = (p: string) => (p.startsWith("http") ? p : SITE + p);
export const descOf = (d: unknown): string => (Array.isArray(d) ? String(d.find((x) => String(x).trim()) ?? "") : String(d ?? "")).trim();

// Lead rule (publisher readiness): ads sell The Switch, Bath Suite or Host & Home. A page whose buy box defaults to a
// small set can't take an ad.
export const blocked = (l: Lander) => !!(l.small_set || (l.sells && SMALL_SETS.includes(l.sells)));

const GROUPS: [string, (l: Lander) => boolean][] = [
  ["Angle landers", (l) => l.kind === "lander" && !HOLIDAY.test(l.path.split("/").pop() ?? "")],
  ["“5 reasons” listicles", (l) => l.kind === "listicle"],
  ["Story advertorials", (l) => l.kind === "advertorial"],
  ["Holiday / sale pages", (l) => l.kind === "lander"],
  ["Product pages", (l) => l.kind === "product"],
  ["Research and articles (no buy box)", (l) => l.kind === "research" || l.kind === "article"],
];

export type LanderOpt = { url: string; path: string; label: string; disabled: boolean; sells?: string; kind?: string; title?: string };
export type LanderGroup = { label: string; opts: LanderOpt[] };

const short = (s?: string) => (s ?? "").split(" — ")[0].trim();
export function sellsLabel(l?: Lander | null) {
  return l?.sells ? `${short(l.sells_name) || l.sells}${l.price ? ` $${l.price}` : ""}` : "";
}

// Every live lander, grouped; small-set buy boxes last and disabled (the publisher refuses them).
export function landerGroups(landers: Lander[]): LanderGroup[] {
  const left = [...landers].sort((a, b) => a.path.localeCompare(b.path));
  const out: LanderGroup[] = [];
  const opt = (l: Lander): LanderOpt => ({
    url: SITE + l.path, path: l.path, kind: l.kind, title: l.title, sells: l.sells, disabled: blocked(l),
    label: `${l.path.replace(/^\/(pages|products)\//, "")} · ${short(l.title)}${l.sells ? ` → ${sellsLabel(l)}` : ""}`,
  });
  for (const [label, test] of GROUPS) {
    const mine = left.filter((l) => !blocked(l) && test(l));
    for (const l of mine) left.splice(left.indexOf(l), 1);
    if (mine.length) out.push({ label, opts: mine.map(opt) });
  }
  const rest = left.filter((l) => !blocked(l));
  if (rest.length) out.push({ label: "Other pages", opts: rest.map(opt) });
  const small = left.filter(blocked);
  if (small.length) out.push({ label: "Small-set buy box (lead rule: can't take ads)", opts: small.map(opt) });
  return out;
}

export function findLander(landers: Lander[], url?: string | null) {
  const p = pathOnly(url);
  return landers.find((l) => l.path === p) ?? null;
}

// Router offer for a page ("The Switch — 8-Piece … $149.95"), same format as landers.offer_for(); "" when no buy box.
export function offerFor(l?: Lander | null) {
  return l?.sells ? `${l.sells_name || l.sells} $${l.price}` : "";
}

const PROBLEM_LABEL: Record<string, string> = { SKIN: "Skin", SMELL: "Smell", FEEL: "Feel", HOST: "Hosting", CLEAN: "Clean", VALUE: "Value", GIFT: "Gift" };

// One-line why for the router's pick (landers.py route(): story continuation → avatar lander → symptom door → problem default).
export function landerWhy(r: { problem?: string; avatar?: string; angle?: string }, routed: string | undefined, l?: Lander | null): string {
  const base = String(routed ?? "").trim();
  const human = base
    .replace(/^avatar lander/, `page written for the ${r.avatar ?? "?"} avatar`)
    .replace(/^problem default/, `${PROBLEM_LABEL[r.problem ?? ""] ?? r.problem ?? "?"} problem default page`);
  const page = l ? `“${short(l.title)}”${l.sells ? ` sells ${sellsLabel(l)}` : ""}` : "";
  return [human || "router pick", page, r.angle ? `angle ${r.angle}` : ""].filter(Boolean).join(" · ");
}

// Overseer verdict colours (raw.oversight.verdict), shared by the Review page (server) and the card (client).
export const VERDICT_STYLE: Record<string, string> = {
  APPROVE: "border-ok/50 bg-ok/10 text-ok",
  "APPROVE WITH CHANGES": "border-brand/50 bg-brand/10 text-brand-t",
  HOLD: "border-warn/50 bg-warn/10 text-warn",
  REJECT: "border-bad/50 bg-bad/10 text-bad",
};
