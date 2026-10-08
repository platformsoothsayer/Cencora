"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { usePipeline } from "@/components/PipelineState";
import { Amber, Card, ConfidenceChip, Segmented } from "@/components/ui";
import { type Extraction, VENDOR_LABEL, type VendorKey } from "@/lib/extract";
import { SEED, SITES } from "@/lib/seed";

type Basis = "customer" | "knapp";

interface Node {
  vendor: VendorKey;
  key: string;
  label: string;
  rank: number;
}

const P = SEED.priority_map;

const NODES: Node[] = [
  ...P.flatMap((r) =>
    r.dematic
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "not used")
      .map((s) => ({ vendor: "dematic" as const, key: s, label: `Case Priority ${s}`, rank: r.rank })),
  ),
  ...P.filter((r) => r.knapp !== "not used").map((r) => ({ vendor: "knapp" as const, key: r.knapp.slice(0, 1), label: r.knapp, rank: r.rank })),
  ...P.filter((r) => r.schaefer !== "not used").map((r) => ({ vendor: "schaefer" as const, key: r.schaefer, label: `Prio ${r.schaefer}`, rank: r.rank })),
];

function nodeKey(r: Extraction, basis: Basis): string | null {
  if (!r.vendor || r.norm.priorityRank == null) return null;
  if (r.vendor === "knapp" && r.norm.knapp) return String(basis === "knapp" ? r.norm.knapp.vendorRank : r.norm.knapp.customerRank);
  const raw = r.fields.CasePriority.raw ?? "";
  return NODES.some((n) => n.vendor === r.vendor && n.key === raw) ? raw : null;
}

export default function Normalize() {
  const { rows } = usePipeline();
  const loaded = useMemo(() => rows.filter((r) => r.outcome === "loaded"), [rows]);
  const [basis, setBasis] = useState<Basis>("customer");
  const [hover, setHover] = useState<{ type: "src"; node: Node } | { type: "dst"; rank: number } | null>(null);
  const [siteKey, setSiteKey] = useState("ROM");

  const paths = useMemo(() => {
    const m = new Map<string, Extraction[]>();
    for (const r of loaded) {
      const k = nodeKey(r, basis);
      if (k == null) continue;
      const id = `${r.vendor}:${k}`;
      m.set(id, [...(m.get(id) ?? []), r]);
    }
    return m;
  }, [loaded, basis]);

  const disagreements = loaded.filter((r) => r.norm.knapp && r.norm.knapp.customerRank !== r.norm.knapp.vendorRank);
  const unmapped = loaded.filter((r) => r.norm.priorityRank != null && nodeKey(r, basis) == null);

  // Layout
  const W = 720;
  const ROW = 25;
  const GROUP = 26;
  let y = 6;
  const pos: { n: Node; y: number }[] = [];
  const groupY: Record<string, number> = {};
  for (const v of ["dematic", "knapp", "schaefer"] as VendorKey[]) {
    groupY[v] = y;
    y += GROUP;
    for (const n of NODES.filter((x) => x.vendor === v)) {
      pos.push({ n, y });
      y += ROW;
    }
    y += 8;
  }
  const H = y;
  const dstY = (rank: number) => 30 + ((rank - 1) * (H - 70)) / 4;
  const rankTotal = (rank: number) => [...paths.entries()].filter(([k]) => NODES.find((n) => `${n.vendor}:${n.key}` === k)?.rank === rank).reduce((a, [, v]) => a + v.length, 0);

  const isHot = (n: Node) => !hover || (hover.type === "src" ? hover.node === n : n.rank === hover.rank);
  const hotRows: Extraction[] = hover
    ? hover.type === "src"
      ? (paths.get(`${hover.node.vendor}:${hover.node.key}`) ?? [])
      : NODES.filter((n) => n.rank === hover.rank).flatMap((n) => paths.get(`${n.vendor}:${n.key}`) ?? [])
    : [];

  // Site panel
  const site = SITES.find((s) => s.key === siteKey)!;
  const atSite = loaded.filter((r) => r.norm.siteKey === siteKey);
  const byPath = (path: string) => atSite.filter((r) => r.norm.sitePath === path);

  return (
    <div>
      <PageHeader title="Making the vendors agree" sub="Three vendor priority scales onto one P1 to P5 scale, and three ways of naming a site onto one site_key." />

      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4">
        {/* Priority */}
        <Card
          title="Priority"
          aside={
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted">KNAPP normalized on</span>
              <Segmented
                options={[
                  { value: "customer", label: "Customer rating" },
                  { value: "knapp", label: "KNAPP rating" },
                ]}
                value={basis}
                onChange={setBasis}
              />
            </div>
          }
        >
          <div className="px-3 pt-2">
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block" onMouseLeave={() => setHover(null)}>
              {(["dematic", "knapp", "schaefer"] as VendorKey[]).map((v) => (
                <text key={v} x={0} y={groupY[v] + 16} className="fill-blue text-[12px] font-semibold uppercase" style={{ letterSpacing: "0.05em" }}>
                  {VENDOR_LABEL[v]}
                </text>
              ))}
              {pos.map(({ n, y: ny }) => {
                const list = paths.get(`${n.vendor}:${n.key}`) ?? [];
                const y1 = ny + 10;
                const y2 = dstY(n.rank);
                const hot = isHot(n);
                const wgt = list.length ? Math.min(2 + list.length * 0.9, 12) : 1;
                return (
                  <g key={`${n.vendor}${n.key}`} opacity={hot ? 1 : 0.18}>
                    <path
                      d={`M 196 ${y1} C 380 ${y1}, 380 ${y2}, 560 ${y2}`}
                      fill="none"
                      stroke={list.length ? "#4BA1D0" : "#CBD9E6"}
                      strokeWidth={wgt}
                      strokeDasharray={list.length ? undefined : "3 3"}
                    />
                    <g onMouseEnter={() => setHover({ type: "src", node: n })} className="cursor-pointer">
                      <rect x={0} y={ny} width={196} height={20} fill={hover?.type === "src" && hover.node === n ? "#EEF4F8" : "#FFFFFF"} stroke="#CBD9E6" />
                      <text x={8} y={ny + 14} className="fill-ink font-mono text-[11px]">
                        {n.label}
                      </text>
                      <text x={188} y={ny + 14} textAnchor="end" className={`font-mono text-[11px] ${list.length ? "fill-navy font-semibold" : "fill-muted"}`}>
                        {list.length}
                      </text>
                    </g>
                  </g>
                );
              })}
              {P.map((p) => {
                const yy = dstY(p.rank);
                const hot = !hover || (hover.type === "dst" ? hover.rank === p.rank : hover.node.rank === p.rank);
                return (
                  <g key={p.rank} onMouseEnter={() => setHover({ type: "dst", rank: p.rank })} className="cursor-pointer" opacity={hot ? 1 : 0.35}>
                    <rect x={560} y={yy - 16} width={W - 560} height={32} fill="#0F2A4C" />
                    <text x={572} y={yy + 4} className="fill-white text-[13px] font-semibold">
                      {p.normalized}
                    </text>
                    <text x={W - 10} y={yy + 4} textAnchor="end" className="fill-white font-mono text-[13px]">
                      {rankTotal(p.rank)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="min-h-[52px] border-t border-line px-3 py-2 text-[12px]">
            {hover ? (
              <>
                <span className="text-muted">{hotRows.length} messages on this path: </span>
                <span className="font-mono text-[11px] text-navy">{hotRows.map((r) => r.id).join("  ")}</span>
              </>
            ) : (
              <span className="text-muted">
                Hover a vendor value or a normalized level to list the messages on that path. Line weight is the live message count. Dashed paths are in the map but unused in
                this corpus.
              </span>
            )}
          </div>
          <div className="space-y-2 border-t border-line px-3 py-2">
            <Amber kind="decision">
              KNAPP sends two ratings and they can disagree. Both are kept on every row. {disagreements.length} messages in this corpus disagree:{" "}
              {disagreements.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && ", "}
                  <Link href={`/messages?id=${r.id}`} className="font-mono text-navy underline">
                    {r.id}
                  </Link>{" "}
                  <span className="text-muted">
                    (Customer {r.norm.knapp!.customerRaw} / KNAPP {r.norm.knapp!.vendorRaw})
                  </span>
                </span>
              ))}
              . Toggle the rating above to see the counts move.
            </Amber>
            {unmapped.length > 0 && (
              <p className="text-[11px] text-muted">
                {unmapped.map((r) => r.id).join(", ")} carries a priority outside the vendor scale (recovered by the fallback extractor) and is mapped directly onto its P level.
              </p>
            )}
          </div>
        </Card>

        {/* Site */}
        <Card title="Site">
          <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
            {SITES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSiteKey(s.key)}
                className={`border px-2 py-0.5 font-mono text-[11px] ${s.key === siteKey ? "border-navy bg-navy text-white" : "border-line text-navy hover:bg-card"}`}
              >
                {s.key}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_56px_170px] items-center gap-0 px-3 py-3">
            <div className="flex flex-col gap-2">
              <SourceCard
                vendor="Dematic"
                identifier={`Customer ID ${site.dematic_customer_id}`}
                where="Subject line: Customer ID {n}; Site:…; confirmed by the Customer Location label"
                rows={byPath("dematic_customer_id")}
              />
              <SourceCard
                vendor="KNAPP"
                identifier={`Customer Account ${site.knapp_account}`}
                where="Labeled pair Customer Account: under CUSTOMER INFORMATION"
                rows={byPath("knapp_account")}
              />
              <SourceCard
                vendor="SSI Schaefer"
                identifier="No site in the message"
                where={`Mailbox-resolved: the message was addressed to ${site.mailbox}`}
                rows={byPath("mailbox")}
                mailbox
              />
            </div>
            <svg viewBox="0 0 56 300" preserveAspectRatio="none" className="h-full w-full">
              {[50, 150, 250].map((y0) => (
                <path key={y0} d={`M 0 ${y0} C 28 ${y0}, 28 150, 56 150`} fill="none" stroke="#4BA1D0" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
            <div className="border border-navy bg-navy px-3 py-3 text-white">
              <div className="text-[11px] tracking-wide text-white/70 uppercase">site_key</div>
              <div className="font-mono text-[26px] leading-tight font-semibold">{site.key}</div>
              <div className="text-[13px]">
                {site.city}, {site.state}
              </div>
              <div className="mt-2 font-mono text-[11px] text-white/80">{atSite.length} loaded messages</div>
            </div>
          </div>
          <div className="border-t border-line">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="bg-alt text-left text-muted">
                  <th className="px-3 py-1 font-medium">site_key</th>
                  <th className="px-2 py-1 font-medium">Dematic ID</th>
                  <th className="px-2 py-1 font-medium">KNAPP account</th>
                  <th className="px-2 py-1 font-medium">Mailbox</th>
                  <th className="px-2 py-1 text-right font-medium">Msgs</th>
                </tr>
              </thead>
              <tbody>
                {SITES.map((s) => {
                  const rs = loaded.filter((r) => r.norm.siteKey === s.key);
                  const n = (p: string) => rs.filter((r) => r.norm.sitePath === p).length;
                  return (
                    <tr key={s.key} onClick={() => setSiteKey(s.key)} className={`cursor-pointer border-t border-line font-mono ${s.key === siteKey ? "bg-card" : "hover:bg-alt"}`}>
                      <td className="px-3 py-[3px] text-navy">{s.key}</td>
                      <td className="px-2 py-[3px]">
                        {s.dematic_customer_id} <span className="text-muted">·{n("dematic_customer_id")}</span>
                      </td>
                      <td className="px-2 py-[3px]">
                        {s.knapp_account} <span className="text-muted">·{n("knapp_account")}</span>
                      </td>
                      <td className="px-2 py-[3px]">
                        {s.mailbox} <span className="text-muted">·{n("mailbox")}</span>
                      </td>
                      <td className="px-2 py-[3px] text-right text-navy">{rs.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function SourceCard({ vendor, identifier, where, rows, mailbox }: { vendor: string; identifier: string; where: string; rows: Extraction[]; mailbox?: boolean }) {
  const ex = rows[0];
  return (
    <div className={`border bg-white px-2.5 py-2 ${mailbox ? "border-dashed border-blue" : "border-line"}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-blue uppercase">{vendor}</span>
        {ex ? <ConfidenceChip value={ex.fields.AB_Location.confidence} /> : null}
      </div>
      <div className="font-mono text-[13px] text-navy">{identifier}</div>
      <div className="text-[11px] leading-snug text-muted">{where}</div>
      <div className="mt-1 text-[11px]">
        {ex ? (
          <>
            <span className="text-ink">{rows.length} messages, e.g. </span>
            <Link href={`/messages?id=${ex.id}`} className="font-mono text-navy underline">
              {ex.id}
            </Link>
          </>
        ) : (
          <span className="text-muted">Identifier from the site master. No {vendor} message to this site in the corpus.</span>
        )}
      </div>
    </div>
  );
}
