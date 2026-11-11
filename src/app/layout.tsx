import type { Metadata, Viewport } from "next";
import { Inter, Lora } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const lora = Lora({ variable: "--font-lora", subsets: ["latin"], weight: ["500", "600"] });

export const metadata: Metadata = {
  title: "MIORA OS",
  description: "Review, publish and learn from MIORA ads.",
  appleWebApp: { capable: true, title: "MIORA OS", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f3f0" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1417" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${lora.variable}`}>{children}</body>
    </html>
  );
}
