import { PROBLEM, ANGLE, CONCEPT } from "./gate";

// Labels shared by /learnings, /next, /avatars and /framework. Mirrors the Creative Tracker's constants.
export const PROBLEM_ORDER = ["SKIN", "SMELL", "FEEL", "HOST", "CLEAN", "VALUE", "GIFT"];
export const ANGLE_ORDER = ["routine", "saboteur", "notyou", "upgrade", "money"];

// The tracker's Framework tab uses the longer problem names.
export const PROBLEM_LONG: Record<string, string> = {
  SKIN: "Skin & hair", SMELL: "Smell / never fresh", FEEL: "Feel / hotel luxury", HOST: "Hosting & pride",
  CLEAN: "Clean / non-toxic", VALUE: "Cheap towels wear out", GIFT: "Gift",
};
export const PROBLEM_WHY: Record<string, string> = {
  SKIN: "Skin or hair condition; skincare that isn't working.", SMELL: "Sour, musty, 'old-person' or gym smell.",
  FEEL: "Hotel nostalgia, plush, softness.", HOST: "What guests and family see.",
  CLEAN: "Polyester, softener, finishes, plastic, labels.", VALUE: "Replacing towels, disposables, burned by a premium brand.",
  GIFT: "Buying for someone else.",
};
export const ANGLE_WHY: Record<string, string> = {
  routine: "“My routine is good. This makes it work.”", saboteur: "“My towel has been undoing it.”",
  notyou: "“It's not my fault, it's the towel.”", upgrade: "“I'm allowed to have the good one.”", money: "“I've been wasting money.”",
};

export const LAYER: Record<string, string> = {
  problem: "Problem", angle: "Angle", concept: "Concept", hook_type: "Hook type", speaker: "Speaker", awareness: "Awareness",
  avatar: "Avatar", hook: "Hook", offer: "Offer", beat: "Beat", ad: "Single ad", production: "Production",
};
export const METRIC: Record<string, string> = { hookrate: "3-s view rate", ctr: "click-through rate", cpa: "cost per sale" };
export const FLAG: Record<string, string> = {
  winner: "Winner: iterate hooks", kill: "Kill candidate", "new-hooks": "Needs new hooks", "new-concept": "Needs a new concept",
  "new-angle": "Needs a new angle", "fix-lander": "Fix lander / offer", anomaly: "Bad data",
};
export const FLAG_ORDER = ["winner", "kill", "fix-lander", "new-angle", "new-concept", "new-hooks", "anomaly"];

export const ORIGIN: Record<string, string> = { own_ads: "Own ads", beats: "Beats (retention curves)", production: "Production", competitor: "Competitor ads", research: "Research" };
export const ORIGIN_WHY: Record<string, string> = {
  own_ads: "Comparisons and flags computed from MIORA's own Meta results.",
  beats: "Where viewers leave, from Meta retention curves laid over each script's timeline.",
  production: "What we learned making the ads.",
  competitor: "Patterns from scaling AI brands' ads (Relilia, Lymphoria, BioRoot…). Observed when 2+ brands show it; ranks above research.",
  research: "From the research brain and swipe files. Stays a hypothesis until an ad proves it.",
};
export const ORIGIN_ORDER = ["own_ads", "beats", "production", "competitor", "research"];
export const STATUS_ORDER = ["proven", "observed", "hypothesis", "doctrine", "retired"];

// Pill colours, like the tracker: green = proven / winner / approved, amber = observed / needs work, red = kill / rejected.
export function tone(v: string | null | undefined): string {
  switch (v) {
    case "proven": case "winner": case "approved": return "!bg-ok/15 text-ok";
    case "observed": case "new-hooks": case "new-concept": case "new-angle": case "fix-lander": return "!bg-warn/15 text-warn";
    case "kill": case "rejected": return "!bg-bad/15 text-bad";
    case "doctrine": return "!bg-brand/15 text-brand-t";
    case "retired": case "anomaly": return "text-muted line-through decoration-1";
    default: return "";
  }
}

export function valName(layer: string, v: string, avatars?: Map<string, string>): string {
  if (layer === "problem") return PROBLEM[v] ?? v;
  if (layer === "angle") return ANGLE[v] ?? v;
  if (layer === "concept") return CONCEPT[v] ?? v;
  if (layer === "avatar") return avatars?.get(v) ?? v;
  return v;
}

// "20261027T143849Z" or ISO → "2026-10-27 14:38 UTC"
export function when(t: unknown): string {
  const s = String(t ?? "");
  const m = s.match(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]} UTC`;
  return s.slice(0, 16).replace("T", " ");
}

export const money = (v: unknown) => {
  const n = Number(v);
  if (!n) return "·";
  return "$" + (n >= 100 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2).replace(/\.00$/, ""));
};

export const adHref = (id: string) => `/ads/${encodeURIComponent(id)}`;
