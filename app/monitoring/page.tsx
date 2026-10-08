"use client";

import Link from "next/link";
import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { usePipeline } from "@/components/PipelineState";
import { Amber, Btn, Card, Note } from "@/components/ui";
import { FAILURE_TYPES, type FailureType, type Stage } from "@/lib/extract";
import { fmtTs } from "@/lib/format";

const ALERTS: Record<FailureType, { stage: Stage; text: string }> = {
  "Incoming email rejection": { stage: "Classify", text: "Sender and content do not match an in-scope vendor." },
  "Email reading failure": { stage: "Intake", text: "Message could not be read from the mailbox." },
  "Attachment extraction failure": { stage: "Extract", text: "Attachment present but no text could be extracted." },
  "Text parsing error": { stage: "Extract", text: "Known vendor layout not matched." },
  "Parquet conversion error": { stage: "Load", text: "Row could not be written to the lake as parquet." },
  "Database ingestion error": { stage: "Load", text: "Row could not be inserted into raw_VendorEmailProcessing." },
};

export default function Monitoring() {
  const { rows, runs, reprocess, reprocessLog } = usePipeline();
  const [open, setOpen] = useState<string | null>("SYN-9001");

  const exceptions = rows.filter((r) => r.email.expect);
  const current = (t: FailureType) => rows.filter((r) => r.failureType === t).length;
  const resolved = (t: FailureType) => rows.filter((r) => r.reprocessed && r.email.expect?.reason === t).length;
  const counts = {
    raw: rows.length,
    loaded: rows.filter((r) => r.outcome === "loaded").length,
    held: rows.filter((r) => r.outcome === "held").length,
    rejected: rows.filter((r) => r.outcome === "rejected").length,
  };

  return (
    <div>
      <PageHeader title="Run history and alerts" sub="Every run, every failure type named in the RFI, and the holding queue." />

      <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-stretch gap-4">
        <Note>
          <span className="font-semibold text-navy">Nothing is discarded.</span> All {counts.raw} messages are stored in the raw zone exactly as received. A message that
          fails is held with its reason and can be reprocessed; a rejected message stays in the lake and is only excluded from the table.
        </Note>
        <div className="flex divide-x divide-line border border-line font-mono text-[12px]">
          {[
            ["Raw zone", counts.raw, false],
            ["In table", counts.loaded, false],
            ["Held", counts.held, counts.held > 0],
            ["Rejected, stored", counts.rejected, counts.rejected > 0],
          ].map(([l, v, a]) => (
            <div key={String(l)} className="px-4 py-1.5">
              <div className={`text-[18px] font-semibold ${a ? "text-amber" : "text-navy"}`}>{String(v)}</div>
              <div className="font-sans text-[11px] text-muted">{String(l)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-6 gap-2">
        {FAILURE_TYPES.map((t) => {
          const n = current(t);
          const fixed = resolved(t);
          return (
            <div key={t} className={`border bg-white px-3 py-2 ${n ? "border-amber border-t-[3px]" : "border-line border-t-[3px] border-t-line"}`}>
              <div className="flex items-baseline justify-between">
                <span className={`font-mono text-[24px] font-semibold ${n ? "text-amber" : "text-muted"}`}>{n}</span>
                <span className="text-[10px] tracking-wide text-muted uppercase">{ALERTS[t].stage}</span>
              </div>
              <div className={`text-[12.5px] leading-tight font-semibold ${n ? "text-amber" : "text-navy"}`}>{t}</div>
              <div className="mt-1 text-[11px] leading-snug text-muted">{ALERTS[t].text}</div>
              {fixed > 0 && <div className="mt-1 text-[11px] text-blue">{fixed} resolved by reprocess</div>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4">
        <Card title="Runs" aside={<span className="text-[11px] text-muted">newest first</span>}>
          <div className="max-h-[470px] overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0">
                <tr className="bg-navy text-left text-white">
                  {["Run", "Type", "Window", "Read", "Loaded", "Held", "Rejected", "Duration"].map((h, i) => (
                    <th key={h} className={`px-2 py-1.5 font-medium ${i >= 3 ? "text-right" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono text-[11.5px]">
                {runs.map((r, i) => (
                  <tr key={r.id} className={`border-b border-line ${r.kind !== "Scheduled poll" ? "bg-card" : i % 2 ? "bg-alt" : ""}`}>
                    <td className="px-2 py-1 text-navy">{r.id}</td>
                    <td className="px-2 py-1 font-sans">{r.kind}</td>
                    <td className="px-2 py-1">{r.at ? r.at.slice(0, 10) : "this session"}</td>
                    <td className="px-2 py-1 text-right">{r.read}</td>
                    <td className="px-2 py-1 text-right">{r.loaded}</td>
                    <td className={`px-2 py-1 text-right ${r.held ? "text-amber" : ""}`}>{r.held}</td>
                    <td className={`px-2 py-1 text-right ${r.rejected ? "text-amber" : ""}`}>{r.rejected}</td>
                    <td className="px-2 py-1 text-right">{(r.durationMs / 1000).toFixed(2)} s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
            Daily polls are reconstructed from the corpus arrival dates. Runs from the <Link href="/" className="text-blue underline">Live run</Link> page and reprocess
            actions appear at the top.
          </p>
        </Card>

        <Card title="Holding queue" aside={<span className="text-[11px] text-muted">{exceptions.length} messages</span>}>
          {exceptions.map((r) => {
            const isOpen = open === r.id;
            const last = reprocessLog.find((l) => l.id === r.id);
            const done = r.outcome === "loaded";
            return (
              <div key={r.id} className="border-b border-line last:border-b-0">
                <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-alt">
                  <span className="w-3 font-mono text-[11px] text-muted">{isOpen ? "-" : "+"}</span>
                  <span className="w-20 font-mono text-[12px] text-navy">{r.id}</span>
                  <span className={`flex-1 text-[12.5px] font-semibold ${done ? "text-blue" : "text-amber"}`}>{r.email.expect!.reason}</span>
                  <span className={`border px-1.5 py-px text-[11px] ${done ? "border-blue text-blue" : "border-amber text-amber"}`}>
                    {done ? "loaded after reprocess" : r.outcome}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-2 px-3 pb-3">
                    <div className="grid grid-cols-[90px_1fr] gap-y-0.5 text-[12px]">
                      <span className="text-muted">From</span>
                      <span className="font-mono text-[11.5px]">{r.email.from_email}</span>
                      <span className="text-muted">Subject</span>
                      <span>{r.email.subject}</span>
                      <span className="text-muted">Received</span>
                      <span className="font-mono text-[11.5px]">{fmtTs(r.email.received)}</span>
                      <span className="text-muted">Stopped at</span>
                      <span>{r.email.expect!.outcome === "rejected" ? "Classify" : "Extract"}</span>
                    </div>
                    {done ? (
                      <Note>{r.detail}</Note>
                    ) : (
                      <Amber kind="failure">
                        <span className="font-semibold">{r.reason}.</span> {r.detail}
                      </Amber>
                    )}
                    <pre className="max-h-[180px] overflow-y-auto border border-line bg-alt px-2 py-1.5 font-mono text-[11px] leading-[1.5] whitespace-pre-wrap text-ink">{r.raw}</pre>
                    <div className="flex items-center gap-3">
                      <Btn primary onClick={() => reprocess(r.id)} disabled={done}>
                        Reprocess
                      </Btn>
                      <Link href={`/messages?id=${r.id}`} className="text-[12px] text-blue underline">
                        Open in message detail
                      </Link>
                    </div>
                    {last && (
                      <div className={`text-[12px] ${last.outcome === "loaded" ? "text-blue" : "text-amber"}`}>
                        Attempt {last.attempt}: {last.message}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}
