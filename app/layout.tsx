import type { Metadata } from "next";
import Image from "next/image";
import Nav from "@/components/Nav";
import { PipelineProvider } from "@/components/PipelineState";
// Fonts are bundled rather than fetched from Google at build time, so the
// build has no network dependency and the demo renders identically offline.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hotline Email Processing",
  description: "Soothsayer demonstration: vendor hotline email to structured warehouse data.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between bg-navy px-5 text-white">
          <div className="flex items-center gap-4">
            <Image src="/soothsayer-logo.png" alt="Soothsayer Analytics" width={146} height={40} priority />
            <span className="h-5 w-px bg-white/30" />
            <span className="text-[15px] font-medium">Hotline Email Processing</span>
          </div>
          <span className="rounded-full border border-lightblue bg-white px-3 py-0.5 text-[12px] font-medium text-navy">
            Demonstration environment. Synthesized data.
          </span>
        </header>
        <PipelineProvider>
          <div className="flex">
            <Nav />
            <main className="min-w-0 flex-1 px-6 py-4">{children}</main>
          </div>
        </PipelineProvider>
      </body>
    </html>
  );
}
