// The "miora." wordmark (2026-10-23 logo set): ink on light, white in dark mode.
export function Logo({ className = "h-6" }: { className?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/miora-logo-ink.png" alt="miora." className={`${className} w-auto dark:hidden`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/miora-logo-white.png" alt="" aria-hidden className={`${className} hidden w-auto dark:block`} />
    </>
  );
}
