"use client";

import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { usePipeline } from "@/components/PipelineState";
import { Amber, Card } from "@/components/ui";
import type { Extraction } from "@/lib/extract";
import { SEED } from "@/lib/seed";

const DOC = SEED.attachment_example;
const F = DOC.fields;

type DocType = "Request for Change" | "Final Report";

interface Signal {
  name: string;
  evidence: string;
  vote: DocType | null;
}

/** Rule-based document-type classifier over the signals available before the PDF is opened. */
function classifyAttachment(r: Extraction): { signals: Signal[]; choice: DocType | null; votes: Record<DocType, number> } {
  const fn = r.email.attachment?.filename ?? "";
  const from = r.email.from_email.toLowerCase();
  const subj = r.email.subject;
  const signals: Signal[] = [
    {
      name: "Filename",
      evidence: /_RfC\d+/i.test(fn) ? "RfC number token" : /FinalReport/i.test(fn) ? "FinalReport token" : "no type token",
      vote: /_RfC\d+/i.test(fn) ? "Request for Change" : /FinalReport/i.test(fn) ? "Final Report" : null,
    },
    {
      name: "Sender",
      evidence: from.split("@")[0],
      vote: from.startsWith("rfc.management") ? "Request for Change" : from.startsWith("servicedesk") ? "Final Report" : null,
    },
    {
      name: "Subject",
      evidence: /_RfC\d+_/.test(subj) ? "RfC subject pattern" : /Attached your Final Report/i.test(subj) ? "“Attached your Final Report”" : "no type phrase",
      vote: /_RfC\d+_/.test(subj) ? "Request for Change" : /Attached your Final Report/i.test(subj) ? "Final Report" : null,
    },
  ];
  const votes = { "Request for Change": 0, "Final Report": 0 } as Record<DocType, number>;
  for (const s of signals) if (s.vote) votes[s.vote]++;
  const choice = votes["Request for Change"] === votes["Final Report"] ? null : votes["Request for Change"] > votes["Final Report"] ? "Request for Change" : "Final Report";
  return { signals, choice, votes };
}

export default function Attachments() {
  const { rows } = usePipeline();
  const withAttachment = rows.filter((r) => r.email.has_attachment);

  return (
    <div>
      <PageHeader title="Attachments" sub="Phase 2. Fields read from the PDF a vendor attaches, kept in a separate table from the Phase 1 email columns.">
        <span className="border border-blue px-2 py-0.5 text-[12px] font-medium text-blue">Phase 2</span>
      </PageHeader>

      <Card title="Document-type classifier" className="mb-4" aside={<span className="text-[11px] text-muted">chooses between Request for Change and Final Report before extraction</span>}>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-alt text-left text-muted">
              <th className="px-3 py-1.5 font-medium">Message</th>
              <th className="px-2 py-1.5 font-medium">Attachment</th>
              <th className="px-2 py-1.5 font-medium">Filename</th>
              <th className="px-2 py-1.5 font-medium">Sender</th>
              <th className="px-2 py-1.5 font-medium">Subject</th>
              <th className="px-2 py-1.5 font-medium">Chosen type</th>
              <th className="px-2 py-1.5 font-medium">Extraction</th>
            </tr>
          </thead>
          <tbody>
            {withAttachment.map((r) => {
              const c = classifyAttachment(r);
              const corrupt = r.email.attachment?.corrupt;
              const isExample = r.email.attachment?.filename === DOC.filename;
              return (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="px-3 py-1.5">
                    <Link href={`/messages?id=${r.id}`} className="font-mono text-navy underline">
                      {r.id}
                    </Link>
                  </td>
                  <td className="max-w-[260px] truncate px-2 py-1.5 font-mono text-[11px]" title={r.email.attachment?.filename}>
                    {r.email.attachment?.filename}
                  </td>
                  {c.signals.map((s) => (
                    <td key={s.name} className="px-2 py-1.5">
                      <div className="text-ink">{s.vote ?? "no vote"}</div>
                      <div className="text-[11px] text-muted">{s.evidence}</div>
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <span className="border border-navy px-1.5 py-px font-medium text-navy">{c.choice ?? "undecided"}</span>
                    <div className="mt-0.5 font-mono text-[11px] text-muted">
                      {c.choice ? c.votes[c.choice] : 0} of {c.signals.length} signals
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-[12px]">
                    {corrupt ? (
                      <span className="text-amber">Failed: no text layer. Held.</span>
                    ) : isExample ? (
                      <span className="text-navy">16 fields extracted</span>
                    ) : c.choice === "Final Report" ? (
                      <span className="text-muted">Classified. Final Report field set not yet defined.</span>
                    ) : (
                      <span className="text-muted">Classified.</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        {/* Document card */}
        <div className="border border-line bg-alt p-4">
          <div className="mx-auto max-w-[560px] border border-line bg-white px-7 py-6 text-[12px] leading-relaxed text-ink">
            <div className="flex items-start justify-between border-b border-navy pb-2">
              <div>
                <div className="text-[10px] tracking-[0.15em] text-muted uppercase">KNAPP AG</div>
                <div className="text-[18px] font-semibold text-navy">Request for Change</div>
              </div>
              <div className="text-right font-mono text-[11px]">
                <div>RfC {F["RfC number"]}</div>
                <div className="text-muted">{F["Creation date"]}</div>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-[130px_1fr] gap-y-1">
              {["Project number", "Installation", "Service request", "Author", "Keyword"].map((k) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className={k === "Keyword" ? "font-mono text-[11px]" : ""}>{F[k]}</dd>
                </div>
              ))}
            </dl>
            {["Description", "Implementation procedure", "Test plan", "Rollback", "Risk"].map((k) => (
              <div key={k} className="mt-3">
                <div className="text-[11px] font-semibold tracking-wide text-blue uppercase">{k}</div>
                <p>{F[k]}</p>
              </div>
            ))}
            <div className="mt-4 grid grid-cols-3 border-t border-line pt-2">
              {["Implementation duration", "Rollback duration", "WCS downtime"].map((k) => (
                <div key={k}>
                  <div className="text-[10px] text-muted uppercase">{k}</div>
                  <div className="font-mono">{F[k]}</div>
                </div>
              ))}
            </div>
            <div className="mt-2">
              <span className="text-[10px] text-muted uppercase">Conditions </span>
              {F["Conditions"]}
            </div>
          </div>
          <p className="mx-auto mt-2 max-w-[560px] text-[11px] text-muted">
            {DOC.filename}. The document card is rendered from the 16 fields extracted from the Request for Change in the RFI appendix (message{" "}
            <Link href="/messages?id=RFI-06" className="font-mono text-blue underline">
              RFI-06
            </Link>
            ).
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Extracted fields" aside={<span className="font-mono text-[11px] text-muted">raw_VendorAttachment_RfC (working name)</span>}>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-navy text-left text-white">
                  <th className="w-8 px-2 py-1.5 font-mono text-[11px] font-medium">#</th>
                  <th className="px-2 py-1.5 font-medium">Field</th>
                  <th className="px-2 py-1.5 font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(F).map(([k, v], i) => (
                  <tr key={k} className={`border-b border-line align-top ${i % 2 ? "bg-alt" : ""}`}>
                    <td className="px-2 py-1 font-mono text-[11px] text-muted">{i + 1}</td>
                    <td className="px-2 py-1 whitespace-nowrap text-navy">{k}</td>
                    <td className="px-2 py-1 font-mono text-[11px] leading-snug">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-2">
              <Amber kind="decision">The RFI defines no schema for this table yet. The field names above are the labels on the document; Cencora decides the table name, column names and types.</Amber>
            </div>
          </Card>
        </div>
      </div>

    </div>
  );
}
