import { OpsAlertBanner } from "./ops-banner";
import { Sidebar } from "./Sidebar";

// Shell for this slice: ad review and the ads manager. Helpdesk counts are not included.
export function Shell({ active, children, count }: { active: string; children: React.ReactNode; count?: number }) {
  return (
    <Sidebar active={active} count={count}>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <OpsAlertBanner />
        {children}
      </main>
    </Sidebar>
  );
}
