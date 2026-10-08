"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { usePipeline } from "@/components/PipelineState";
import { Amber, Note, Segmented } from "@/components/ui";
import { VENDOR_LABEL } from "@/lib/extract";
import { fmtDuration, fmtShort } from "@/lib/format";
import { buildTickets, RESOLVED_STATUSES } from "@/lib/pipeline";

const STATUS_STYLE: Record<string, string> = {
  Open: "border-lightblue bg-white text-navy",
  "In progress": "border-blue bg-white text-blue",
  "Waiting on Cencora": "border-blue bg-card text-navy",
  "Pending verification": "border-navy bg-white text-navy",
  Closed: "border-navy bg-navy text-white",
};

function StatusChip({ status, small, empty = "no status" }: { status: string | null; small?: boolean; empty?: string }) {
  return (
    <span className={`inline-block border px-1.5 ${small ? "text-[10.5px]" : "text-[11.5px]"} whitespace-nowrap ${status ? STATUS_STYLE[status] : "border-line text-muted"}`}>
      {status ?? empty}
    </span>
  );
}

export default function Tickets() {
  const { rows } = usePipeline();
  const [mode, setMode] = useState<"ticket" | "email">("ticket");
  const tickets = useMemo(() => buildTickets(rows), [rows]);
  const loadedCount = tickets.reduce((a, t) => a + t.emailIds.length, 0);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  return (
    <div>
      <PageHeader title="Tickets" sub="The same loaded rows, grouped by vendor case: one row per ticket instead of one per email.">
        <Segmented
          options={[
            { value: "email", label: `One row per email (${loadedCount})` },
            { value: "ticket", label: `One row per ticket (${tickets.length})` },
          ]}
          value={mode}
          onChange={setMode}
        />
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <Note>
          The questions in the RFI&apos;s executive summary are about tickets, not individual emails, so they need this view. One ticket arrives as several emails, one
          per status change.
        </Note>
        <Amber kind="decision">
          What counts as resolved. Here a ticket is resolved at its first {RESOLVED_STATUSES.join(" or ")} status. KNAPP&apos;s RECOVERED maps to Pending verification; the
          Final Report closes it.
        </Amber>
      </div>

      <div className="h-[calc(100vh-232px)] min-h-[520px] overflow-auto border border-line">
        {mode === "ticket" ? (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-navy text-left text-white">
                {["Ticket", "Vendor", "Site", "Subject", "Status timeline", "First seen", "Last update", "Time to resolve", "Emails"].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map((t, i) => (
                <tr key={t.key} className={`border-b border-line align-top ${i % 2 ? "bg-alt" : ""}`}>
                  <td className="px-2 py-1.5 font-mono text-navy">{t.ticketId}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{VENDOR_LABEL[t.vendor]}</td>
                  <td className="px-2 py-1.5 font-mono">{t.siteKey}</td>
                  <td className="max-w-[240px] px-2 py-1.5 leading-snug">
                    <span className="line-clamp-2" title={t.subject}>
                      {t.subject}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap items-start gap-x-1 gap-y-1">
                      {t.events.map((e, k) => (
                        <div key={e.id} className="flex items-start gap-1">
                          {k > 0 && <span className="pt-0.5 text-[10px] text-line">&#8212;</span>}
                          <div className="flex flex-col items-start">
                            <StatusChip status={e.status} small empty={e.isReply ? "Cencora reply" : "no status"} />
                            <span className="font-mono text-[9.5px] text-muted">{fmtShort(e.at)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px] whitespace-nowrap">{fmtShort(t.firstSeen)}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] whitespace-nowrap">{fmtShort(t.lastUpdate)}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] whitespace-nowrap">
                    {t.timeToResolveMs != null ? (
                      <span className="text-navy">{fmtDuration(t.timeToResolveMs)}</span>
                    ) : t.firstSeenResolved ? (
                      <span className="font-sans text-muted">first seen resolved</span>
                    ) : (
                      <span className="text-muted">open</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{t.emailIds.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-navy text-left text-white">
                {["Message", "Received", "Vendor", "CaseNumber/TicketID", "Site", "Vendor status", "CaseStatus"].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.flatMap((t, ti) =>
                t.emailIds.map((id, k) => {
                  const r = byId.get(id)!;
                  return (
                    <tr key={id} className={`${k === 0 ? "border-t-2 border-t-line" : ""} ${ti % 2 ? "bg-alt" : ""}`}>
                      <td className="px-2 py-1 font-mono">
                        <Link href={`/messages?id=${id}`} className="text-navy underline">
                          {id}
                        </Link>
                      </td>
                      <td className="px-2 py-1 font-mono text-[11px]">{fmtShort(r.email.received)}</td>
                      <td className="px-2 py-1">{VENDOR_LABEL[t.vendor]}</td>
                      <td className="px-2 py-1 font-mono text-navy">{t.ticketId}</td>
                      <td className="px-2 py-1 font-mono">{t.siteKey}</td>
                      <td className="px-2 py-1 font-mono text-[11px] text-muted">{r.norm.statusRaw ?? (r.isReply ? "Cencora reply" : "not sent by vendor")}</td>
                      <td className="px-2 py-1">
                        <StatusChip status={r.norm.statusLabel} empty={r.isReply ? "Cencora reply" : "no status"} />
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
