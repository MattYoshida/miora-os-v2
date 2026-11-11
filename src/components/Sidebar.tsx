"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut } from "@/app/login/actions";
import { Logo } from "./Logo";

const GROUPS: [string, [string, string][]][] = [
  ["Review", [["/review", "Ad review"]]],
  ["Media buying", [["/ops", "Ads manager"]]],
];
const KEY = "miora-os-sidebar";

// ☰ sidebar: stays open on wide screens until closed (remembered per browser), slides over the page on phones.
export function Sidebar({ active, count, children }: { active: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setWide(mq.matches);
    sync(); mq.addEventListener("change", sync);
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch {}
    setOpen(saved ? saved === "open" : mq.matches);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const toggle = () => setOpen((o) => { const n = !o; try { if (wide) localStorage.setItem(KEY, n ? "open" : "closed"); } catch {} return n; });
  const docked = open && wide;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur">
        <button onClick={toggle} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}
          className="grid h-9 w-9 place-items-center rounded-lg hover:bg-chip">
          <span className="flex w-5 flex-col gap-[5px]">
            <span className="h-[2px] rounded bg-ink" /><span className="h-[2px] rounded bg-ink" /><span className="h-[2px] rounded bg-ink" />
          </span>
        </button>
        <Link href="/review" className="flex items-end gap-1.5" aria-label="MIORA OS home"><Logo className="h-6" /><span className="pb-[1px] text-sm font-medium text-muted">OS</span></Link>
      </header>

      {open && !wide && <div className="fixed inset-0 z-30 bg-black/30" onClick={() => setOpen(false)} />}
      <aside className={`fixed bottom-0 left-0 top-[61px] z-40 w-60 overflow-y-auto border-r border-line bg-bg px-3 py-4 transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}
        aria-hidden={!open}>
        <nav className="space-y-5">
          {GROUPS.map(([group, items]) => (
            <div key={group}>
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-t">{group}</p>
              {items.map(([href, label]) => (
                <Link key={href} href={href} onClick={() => !wide && setOpen(false)} tabIndex={open ? 0 : -1}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${active.startsWith(href) ? "bg-ink text-bg" : "text-ink/80 hover:bg-chip"}`}>
                  {label}
                  {href === "/review" && count ? <span className="text-xs opacity-70">{count}</span> : null}
                </Link>
              ))}
            </div>
          ))}
          <form action={signOut} className="border-t border-line pt-3">
            <button tabIndex={open ? 0 : -1} className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-chip hover:text-ink">Sign out</button>
          </form>
        </nav>
      </aside>

      <div className={`transition-[padding] duration-200 ${docked ? "lg:pl-60" : ""}`}>{children}</div>
    </div>
  );
}
