import type { Row } from "./ads";
import { CTA_KEYS, findLander, pathOnly, type Lander } from "./review-copy";

// Same list as ~/example/jobs/tracker/publisher.py APPROVED_CLAIMS and the tracker page.
export const CLAIMS = ["100% cotton", "long-staple Turkish cotton", "OEKO-TEX certified", "plastic-free packaging", "780 GSM",
  "dries in one press", "polyester holds body oil", "softener coats fibers", "free shipping over $75", "no softener"];

const SMALL_URL = /(essential-pair|hand-and-face|skin-set|vanity-set|essential-spa|\/products\/face-towels|\/products\/bath-towels)/;
const SMALL_NAMED = /skin set|essential pair|vanity set|hand (&|and) face set|essential spa/i;
const namedSet = (o: string) => /host\s*(&|and)\s*home/i.test(o) ? "the-host-home-set" : /bath suite/i.test(o) ? "bath-set-12" : /switch/i.test(o) ? "the-switch" : "";

// What the Mac's publisher will refuse (readiness() in publisher.py re-checks before upload). Empty = ready to approve.
// Pass the live landers (registry meta.landers) to also check that the offer matches what the page sells.
export function gateProblems(r: Row, landers?: Lander[]): string[] {
  const out: string[] = [];
  const miss = (["problem", "avatar", "angle", "concept", "hook_type"] as const).filter((k) => !r[k]);
  if (miss.length) out.push(`Missing tags: ${miss.join(", ")}`);
  if (!String(r.hook ?? "").trim()) out.push("No hook text");
  const c = r.copy ?? {};
  const prim = (c.primary ?? []).filter((t) => t.trim()), heads = (c.headline ?? []).filter((t) => t.trim());
  if (!prim.length) out.push("No primary text");
  if (!heads.length) out.push("No headline");
  if (heads.some((h) => h.length > 40)) out.push("A headline is over 40 characters");
  if (prim.length > 5 || heads.length > 5) out.push("Meta takes at most 5 primary texts and 5 headlines");
  if (c.cta && !CTA_KEYS.includes(c.cta)) out.push(`Button ${c.cta} isn't one Meta accepts here`);
  if (r.concept === "native" && !r.native_type) out.push("Missing native type (native statics need one)");
  const bad = (c.claims ?? []).filter((x) => !CLAIMS.includes(x));
  if (bad.length) out.push(`Unapproved claims: ${bad.join(", ")}`);
  const host = String(r.lander ?? "").replace(/^https?:\/\//, "").split("/")[0];
  if (!(String(r.lander ?? "").startsWith("/") || /(^|\.)store\.example\.com$/i.test(host))) out.push("Landing page isn't on store.example.com");
  if (SMALL_URL.test(String(r.lander ?? ""))) out.push("Small-set product page (lead rule: The Switch, Bath Suite or Host & Home)");
  const txt = [r.offer ?? "", ...prim, ...heads].join(" ");
  if (SMALL_NAMED.test(txt)) out.push("A small set is named in the offer or copy (lead rule)");
  const page = landers ? findLander(landers, r.lander) : null, named = namedSet(r.offer ?? "");
  if (page?.sells && named && named !== page.sells) out.push(`Offer names ${named} but ${pathOnly(r.lander)} sells ${page.sells}`);
  if (!r.file?.paths?.length) out.push("No finished file on the Mac");
  return out;
}

export const PROBLEM: Record<string, string> = { SKIN: "Skin & hair", SMELL: "Smell", FEEL: "Feel", HOST: "Hosting", CLEAN: "Clean", VALUE: "Value", GIFT: "Gift" };
export const ANGLE: Record<string, string> = { "native-smell": "It was never you, it was the towel (native)", "native-luxury": "The one thing the richest homes never skimp on (native)", "native-eczema": "Your skin did everything right, your towel didn't (native)", "native-microplastic": "You switched to glass, your towel is still plastic (native)", "native-thinskin": "Your skin got thinner, your towel stayed rough (native)", "native-menopause": "Menopause changed how you smell, your towel made it worse (native)", "native-hair": "The shedding is the shot, the snapping was the towel (native)", "native-fold": "Keep it dry starts with what you dry it with (native)", routine: "Helps your routine", saboteur: "Your towel is the problem", notyou: "It's not you", upgrade: "You deserve the upgrade", money: "The money math" };
export const CONCEPT: Record<string, string> = { "ugc-talk": "Talking UGC", "ugc-story": "Storytime UGC", podcast: "Podcast", vsl: "VSL", drama: "Drama", animation: "Animation", demo: "Demo", static: "Static", native: "Native" };
