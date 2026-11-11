import { Logo } from "@/components/Logo";
import { MfaForm } from "./form";

export const metadata = { title: "Two-factor · MIORA OS" };

export default function Mfa() {
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-3"><Logo className="h-8" /></div>
        <h1 className="mb-2 font-serif text-3xl tracking-tight">Two-factor code</h1>
        <p className="mb-6 text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
        <MfaForm />
      </div>
    </main>
  );
}
