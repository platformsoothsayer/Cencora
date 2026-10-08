import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Nav from "@/components/Nav";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Hotline Email Processing",
  description: "Soothsayer demonstration: vendor hotline email to structured warehouse data.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between bg-navy px-5 text-white">
          <div className="flex items-baseline gap-4">
            <span className="text-[15px] font-semibold tracking-wide">Soothsayer</span>
            <span className="h-4 w-px self-center bg-white/30" />
            <span className="text-[15px] font-medium">Hotline Email Processing</span>
          </div>
          <span className="rounded-full border border-lightblue bg-white px-3 py-0.5 text-[12px] font-medium text-navy">
            Demonstration environment. Synthesized data.
          </span>
        </header>
        <div className="flex">
          <Nav />
          <main className="min-w-0 flex-1 px-6 py-5">{children}</main>
        </div>
      </body>
    </html>
  );
}
