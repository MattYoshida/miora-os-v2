import type { Ad } from "@/lib/ads";

// The native still, as the 4:5 image Facebook shows under the story.
export function NativeImage({ ad, className = "" }: { ad: Ad; className?: string }) {
  return (
    <div className={`relative aspect-[4/5] w-full overflow-hidden rounded-xl bg-chip ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/image/${encodeURIComponent(ad.id)}`} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">Native · 4:5</span>
    </div>
  );
}

// The story is the ad: what shows above "See more", then the whole text as Facebook prints it.
export function NativeStory({ ad }: { ad: Ad }) {
  const text = String(ad.raw.copy?.primary?.[0] ?? "");
  const words = text.split(/\s+/).filter(Boolean).length;
  const fold = text.split("\n").filter((l) => l.trim()).slice(0, 2).join("\n");
  const pl = ad.raw.placements?.publisher_platforms;
  return (
    <details className="rounded-xl border border-line bg-bg p-3 text-sm">
      <summary className="cursor-pointer">
        <span className="whitespace-pre-line font-medium">{fold}</span>
        <span className="mt-1 block text-[12px] text-muted">
          … Read the whole story · {words.toLocaleString()} words · ~{Math.max(1, Math.round(words / 230))} min
          {pl?.length ? ` · placements: ${pl.join(", ")} feed only` : ""}
        </span>
      </summary>
      <div className="mt-3 max-h-[70vh] overflow-y-auto whitespace-pre-line pr-2 text-[14px] leading-relaxed">{text}</div>
    </details>
  );
}
