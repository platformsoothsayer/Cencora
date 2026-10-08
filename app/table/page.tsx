"use client";

import { useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { usePipeline } from "@/components/PipelineState";
import { Btn, Card, FieldValue, Segmented, Select } from "@/components/ui";
import { COLUMN_KIND, type Extraction, KIND_LABEL, STATUS_ORDER, VENDOR_LABEL } from "@/lib/extract";
import { COLUMNS, SEED, SITES } from "@/lib/seed";

const WIDE: Record<string, number> = {
  EmailToAddress: 260,
  EmailSubjectLine: 300,
  EmailPreamble: 300,
  "CaseComment/TicketType": 300,
  IssueDescription: 360,
  EmailFilename: 290,
  AttachmentFilename: 300,
  CaseSubject: 240,
  "EmailFrom address": 220,
};

const SQL_TYPES: Record<string, string> = {
  Vendor: "VARCHAR(32)",
  EmailReceivedTimestamp: "TIMESTAMP",
  "EmailFrom address": "VARCHAR(320)",
  EmailToAddress: "VARCHAR(2000)",
  EmailSubjectLine: "VARCHAR(998)",
  EmailPreamble: "TEXT",
  "CaseNumber/TicketID": "VARCHAR(32)",
  "CaseComment/TicketType": "TEXT",
  ReportedOnDate: "VARCHAR(32)",
  AB_ReferenceNumber: "VARCHAR(64)",
  CaseSubject: "VARCHAR(500)",
  AB_CaseContact: "VARCHAR(200)",
  AB_Location: "VARCHAR(100)",
  AB_ServiceTechnician: "VARCHAR(200)",
  CasePriority: "VARCHAR(20)",
  CaseStatus: "VARCHAR(40)",
  IssueDescription: "TEXT",
  EmailFilename: "VARCHAR(260)",
  CreatedTimestamp: "TIMESTAMP",
  "Attachment(Y/N)": "CHAR(1)",
  AttachmentFilename: "VARCHAR(260)",
};

const q = (c: string) => `"${c}"`;

const CREATE = [
  "CREATE TABLE raw_VendorEmailProcessing (",
  ...COLUMNS.map((c, i) => {
    const type = `${SQL_TYPES[c]}${i < COLUMNS.length - 1 ? "," : ""}`;
    return `    ${q(c).padEnd(26)} ${type.padEnd(15)} -- ${KIND_LABEL[COLUMN_KIND[c]].toLowerCase()}`;
  }),
  ");",
].join("\n");

const SELECT = `SELECT ${q("Vendor")}, ${q("CaseNumber/TicketID")}, ${q("AB_Location")},
       ${q("CasePriority")}, ${q("CaseStatus")}, ${q("EmailReceivedTimestamp")}
FROM   raw_VendorEmailProcessing
WHERE  ${q("CasePriority")} IN ('P1 Critical', 'P2 High')
  AND  ${q("CaseStatus")} <> 'Closed'
ORDER  BY ${q("EmailReceivedTimestamp")} DESC
LIMIT  10;`;

const SELECT_COLS = ["Vendor", "CaseNumber/TicketID", "AB_Location", "CasePriority", "CaseStatus", "EmailReceivedTimestamp"];

function csv(rows: Extraction[]) {
  const cell = (v: string | null) => (v == null ? "" : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [COLUMNS.map(cell).join(","), ...rows.map((r) => COLUMNS.map((c) => cell(r.fields[c].value)).join(","))].join("\r\n");
}

export default function TablePage() {
  const { rows } = usePipeline();
  const loaded = useMemo(() => rows.filter((r) => r.outcome === "loaded"), [rows]);
  const [vendor, setVendor] = useState("all");
  const [site, setSite] = useState("all");
  const [prio, setPrio] = useState("all");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState<"table" | "sql">("table");

  const shown = loaded.filter(
    (r) =>
      (vendor === "all" || r.vendor === vendor) &&
      (site === "all" || r.norm.siteKey === site) &&
      (prio === "all" || (prio === "none" ? !r.norm.priorityLabel : r.norm.priorityLabel === prio)) &&
      (status === "all" || (status === "none" ? !r.norm.statusLabel : r.norm.statusLabel === status)),
  );

  const result = loaded
    .filter((r) => r.norm.priorityRank != null && r.norm.priorityRank <= 2 && r.norm.statusLabel !== "Closed")
    .sort((a, b) => b.email.received.localeCompare(a.email.received))
    .slice(0, 10);

  const download = () => {
    const blob = new Blob([csv(shown)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "raw_VendorEmailProcessing.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader title="Output table" sub="raw_VendorEmailProcessing: the 21 columns in Cencora's order and spelling, one row per loaded message.">
        <div className="flex items-center gap-2">
          <Segmented
            options={[
              { value: "table", label: "Rows" },
              { value: "sql", label: "SQL" },
            ]}
            value={view}
            onChange={setView}
          />
          <Btn onClick={download}>Export CSV</Btn>
        </div>
      </PageHeader>

      {view === "sql" ? (
        <div className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-4">
          <Card title="Table definition">
            <pre className="overflow-x-auto px-4 py-3 font-mono text-[12px] leading-[1.6] text-navy">{CREATE}</pre>
            <p className="border-t border-line px-4 py-2 text-[11px] text-muted">Column names and order reproduced exactly as specified. Data types are illustrative.</p>
          </Card>
          <div className="flex flex-col gap-4">
            <Card title="Sample query">
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[12px] leading-[1.6] text-navy">{SELECT}</pre>
            </Card>
            <Card title="Result" aside={<span className="font-mono text-[11px] text-muted">{result.length} rows</span>}>
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-[11.5px]">
                  <thead>
                    <tr className="bg-navy text-left text-white">
                      {SELECT_COLS.map((c) => (
                        <th key={c} className="px-2 py-1.5 font-medium whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.map((r, i) => (
                      <tr key={r.id} className={i % 2 ? "bg-alt" : ""}>
                        {SELECT_COLS.map((c) => (
                          <td key={c} className="border-b border-line px-2 py-1 whitespace-nowrap text-ink">
                            {r.fields[c].value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-4">
            <Select
              label="Vendor"
              value={vendor}
              onChange={setVendor}
              options={[{ value: "all", label: "All vendors" }, ...Object.entries(VENDOR_LABEL).map(([value, label]) => ({ value, label }))]}
            />
            <Select label="Site" value={site} onChange={setSite} options={[{ value: "all", label: "All sites" }, ...SITES.map((s) => ({ value: s.key, label: `${s.key} ${s.city}, ${s.state}` }))]} />
            <Select
              label="Priority"
              value={prio}
              onChange={setPrio}
              options={[{ value: "all", label: "All priorities" }, ...SEED.priority_map.map((p) => ({ value: p.normalized, label: p.normalized })), { value: "none", label: "Not sent" }]}
            />
            <Select
              label="Status"
              value={status}
              onChange={setStatus}
              options={[{ value: "all", label: "All statuses" }, ...STATUS_ORDER.map((s) => ({ value: s, label: s })), { value: "none", label: "Not sent" }]}
            />
            <span className="ml-auto font-mono text-[12px] text-muted">
              {shown.length} of {loaded.length} rows
            </span>
          </div>
          <div className="mb-2 flex gap-4 text-[11px] text-muted">
            {(["E", "D", "G"] as const).map((k) => (
              <span key={k}>
                <span className="mr-1 border border-white/0 bg-blue px-1 font-mono text-[9px] text-white">{k}</span>
                {KIND_LABEL[k]}
              </span>
            ))}
            <span>Fields a vendor does not send read “not sent by vendor” here and export as empty (SQL NULL).</span>
          </div>
          <div className="h-[calc(100vh-196px)] min-h-[560px] overflow-auto border border-line">
            <table className="border-separate border-spacing-0 text-[12px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="sticky left-0 z-20 border-r border-b border-white/20 bg-navy px-2 py-2 text-left font-mono text-[11px] font-medium text-white/70">#</th>
                  {COLUMNS.map((c) => (
                    <th key={c} style={{ minWidth: WIDE[c] ?? 150 }} className="border-r border-b border-white/20 bg-navy px-2 py-2 text-left font-mono text-[11px] font-medium whitespace-nowrap text-white">
                      {c}
                      <span title={KIND_LABEL[COLUMN_KIND[c]]} className="ml-1.5 bg-blue px-1 text-[9px]">
                        {COLUMN_KIND[c]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.id} className={i % 2 ? "bg-alt" : "bg-white"}>
                    <td className={`sticky left-0 border-r border-b border-line px-2 py-1 font-mono text-[11px] whitespace-nowrap text-muted ${i % 2 ? "bg-alt" : "bg-white"}`}>{r.id}</td>
                    {COLUMNS.map((c) => {
                      const f = r.fields[c];
                      return (
                        <td key={c} title={f.value ?? "not sent by vendor"} className="max-w-[360px] truncate border-r border-b border-line px-2 py-1 text-ink" style={{ minWidth: WIDE[c] ?? 150 }}>
                          <FieldValue f={f} className={c.includes("Timestamp") || c === "EmailFilename" ? "font-mono text-[11px]" : ""} />
                          {f.confidence !== null && f.confidence < 0.75 && <span className="ml-1 font-mono text-[10px] text-amber">{f.confidence.toFixed(2)}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
