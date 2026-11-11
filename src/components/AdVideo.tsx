import type { Ad } from "@/lib/ads";
import { videoOf } from "@/lib/ads";
import { LazyVideo } from "./LazyVideo";

export function AdVideo({ ad, className = "" }: { ad: Ad; className?: string }) {
  const thumb = `/api/thumb/${encodeURIComponent(ad.id)}`;
  if (videoOf(ad))
    return <LazyVideo className={className} src={`/api/video/${encodeURIComponent(ad.id)}`} poster={thumb} />;
  return (
    <div className={`relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-chip ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={thumb} alt="" loading="lazy" decoding="async" className={`h-full w-full object-cover ${ad.raw.file?.kind === "image" ? "" : "opacity-80"}`} />
      {ad.raw.file?.kind !== "image" && (
        <span className="absolute inset-x-2 bottom-2 rounded-lg bg-black/60 px-2 py-1 text-center text-xs text-white">Preview being made</span>
      )}
    </div>
  );
}
