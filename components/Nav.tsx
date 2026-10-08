"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PAGES = [
  { href: "/", label: "Live run", n: 1 },
  { href: "/messages", label: "Message detail", n: 2 },
  { href: "/table", label: "Output table", n: 3 },
  { href: "/normalize", label: "Normalization", n: 4 },
  { href: "/monitoring", label: "Monitoring", n: 5 },
  { href: "/attachments", label: "Attachments", n: 6, tag: "Phase 2" },
  { href: "/tickets", label: "Tickets", n: 7 },
  { href: "/insights", label: "Insights", n: 8 },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="sticky top-12 h-[calc(100vh-3rem)] w-52 shrink-0 border-r border-line bg-alt py-3">
      <ul>
        {PAGES.map((p) => {
          const active = p.href === "/" ? path === "/" : path.startsWith(p.href);
          return (
            <li key={p.href}>
              <Link
                href={p.href}
                className={`flex items-center gap-2.5 border-l-[3px] px-4 py-2 text-[13px] ${
                  active
                    ? "border-blue bg-card font-semibold text-navy"
                    : "border-transparent text-ink hover:bg-card"
                }`}
              >
                <span className="w-3 font-mono text-[11px] text-muted">{p.n}</span>
                <span className="flex-1">{p.label}</span>
                {p.tag && <span className="font-mono text-[10px] text-muted">{p.tag}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
