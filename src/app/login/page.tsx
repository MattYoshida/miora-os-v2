import { Logo } from "@/components/Logo";
import { LoginForm } from "./form";

export const metadata = { title: "Sign in · MIORA OS" };

export default async function Login({ searchParams }: { searchParams: Promise<{ denied?: string; link?: string }> }) {
  const { denied, link } = await searchParams;
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-3"><Logo className="h-8" /></div>
        <h1 className="font-serif text-3xl tracking-tight mb-6">Creative OS</h1>
        {denied && <p className="mb-4 text-sm text-bad">This account isn&apos;t on the MIORA admin list.</p>}
        {link && <p className="mb-4 text-sm text-bad">That sign-in link didn&apos;t work (they expire after an hour and work once). Request a new one below.</p>}
        <LoginForm />
      </div>
    </main>
  );
}
