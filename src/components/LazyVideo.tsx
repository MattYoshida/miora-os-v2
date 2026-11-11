"use client";
import { useEffect, useRef, useState } from "react";

// Poster first. The <video> (and its src, which 302s to a signed Storage URL) is attached only while
// the card is on screen or just about to be. preload stays "none": a review preview is a few MB, and
// Chrome treats preload="metadata" on a file that small as "download it". Offscreen cards are paused
// and detached so a long scroll does not keep a connection open per card.
export function LazyVideo({ src, poster, className = "" }: { src: string; poster: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setNear(true);
      else {
        video.current?.pause();
        setNear(false);
      }
    }, { rootMargin: "240px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={box} className={`relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-black ${className}`}>
      {near ? (
        <video ref={video} className="h-full w-full object-contain" src={src} poster={poster}
          controls playsInline preload="none" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" />
      )}
    </div>
  );
}
