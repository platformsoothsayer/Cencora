"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, Tooltip, XAxis, YAxis } from "recharts";
import PageHeader from "@/components/PageHeader";
import { usePipeline } from "@/components/PipelineState";
import { Card, Note } from "@/components/ui";
import { useMounted } from "@/components/useMounted";
import { VENDOR_LABEL, type VendorKey } from "@/lib/extract";
import { hours } from "@/lib/format";
import { buildTickets, CATEGORIES, type TicketRow } from "@/lib/pipeline";
import { SITES } from "@/lib/seed";

const C = { navy: "#0F2A4C", blue: "#2E7DA8", light: "#4BA1D0", line: "#CBD9E6", muted: "#7A8895", ink: "#2A3138" };
const AXIS = { fontSize: 11, fill: C.ink, fontFamily: "IBM Plex Sans" };
const TIP = { contentStyle: { border: `1px solid ${C.line}`, borderRadius: 0, fontSize: 12, fontFamily: "IBM Plex Sans" }, cursor: { fill: "#EEF4F8" } };

function avgBy<K extends string>(tickets: TicketRow[], key: (t: TicketRow) => K | null) {
  const m = new Map<K, number[]>();
  for (const t of tickets) {
    const k = key(t);
    if (k == null || t.timeToResolveMs == null) continue;
    m.set(k, [...(m.get(k) ?? []), t.timeToResolveMs]);
  }
  return m;
}

export default function Insights() {
  const mounted = useMounted();
  const { rows } = usePipeline();
  const tickets = useMemo(() => buildTickets(rows).filter((t) => !t.ticketId.startsWith("RfC")), [rows]);

  const categories = CATEGORIES.map((c) => ({ category: c, tickets: tickets.filter((t) => t.category === c).length }))
    .filter((d) => d.tickets > 0)
    .sort((a, b) => b.tickets - a.tickets);

  const byVendorMap = avgBy(tickets, (t) => t.vendor);
  const vendorStats = (Object.keys(VENDOR_LABEL) as VendorKey[]).map((v) => {
    const xs = byVendorMap.get(v) ?? [];
    return { name: VENDOR_LABEL[v], hours: xs.length ? hours(xs.reduce((a, b) => a + b, 0) / xs.length) : 0, n: xs.length, open: tickets.filter((t) => t.vendor === v).length - xs.length };
  });
  const byVendor = vendorStats.filter((d) => d.n > 0);
  const bySiteMap = avgBy(tickets, (t) => t.siteKey);
  const bySite = SITES.map((s) => {
    const xs = bySiteMap.get(s.key) ?? [];
    return { name: s.key, hours: xs.length ? hours(xs.reduce((a, b) => a + b, 0) / xs.length) : 0, n: xs.length };
  }).filter((d) => d.n > 0);

  const repeats = SITES.map((s) => {
    const at = tickets.filter((t) => t.siteKey === s.key);
    const counts = new Map<string, TicketRow[]>();
    for (const t of at) counts.set(t.category, [...(counts.get(t.category) ?? []), t]);
    const rep = [...counts.entries()].filter(([, v]) => v.length > 1);
    const repeatN = rep.reduce((a, [, v]) => a + v.length, 0);
    return { name: s.key, repeat: repeatN, other: at.length - repeatN, detail: rep };
  })
    .filter((d) => d.repeat + d.other > 0)
    .sort((a, b) => b.repeat - a.repeat || b.other - a.other);

  return (
    <div>
      <PageHeader title="What the data answers" sub="Examples of what Cencora's own analysts would build from the tables. The RFI keeps reporting on Cencora's side; these charts are not part of the pipeline." />
      <div className="mb-3">
        <Note>
          Built from the {tickets.length} vendor tickets in the demonstration corpus. Issue categories are assigned by a keyword rule on the case subject and description,
          the kind of derived field an analyst would add on top of the table.
        </Note>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Most common issue categories" aside={<span className="text-[11px] text-muted">tickets</span>}>
          <div className="h-[300px] px-2 py-2">
            {mounted && (
              <BarChart width={560} height={290} data={categories} layout="vertical" margin={{ left: 20, right: 30, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} stroke={C.line} />
                <XAxis type="number" allowDecimals={false} tick={AXIS} stroke={C.line} />
                <YAxis type="category" dataKey="category" width={150} tick={AXIS} stroke={C.line} />
                <Tooltip {...TIP} />
                <Bar dataKey="tickets" fill={C.navy} isAnimationActive={false}>
                  <LabelList dataKey="tickets" position="right" style={{ fontSize: 11, fill: C.ink }} />
                </Bar>
              </BarChart>
            )}
          </div>
        </Card>

        <Card title="Repeat faults at the same site" aside={<span className="text-[11px] text-muted">tickets per site</span>}>
          <div className="flex">
            <div className="h-[300px] px-2 py-2">
              {mounted && (
                <BarChart width={330} height={290} data={repeats} layout="vertical" margin={{ left: 0, right: 20, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke={C.line} />
                  <XAxis type="number" allowDecimals={false} tick={AXIS} stroke={C.line} />
                  <YAxis type="category" dataKey="name" width={44} tick={{ ...AXIS, fontFamily: "IBM Plex Mono" }} stroke={C.line} />
                  <Tooltip {...TIP} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="repeat" name="Same category as another ticket" stackId="a" fill={C.navy} isAnimationActive={false} />
                  <Bar dataKey="other" name="Other tickets" stackId="a" fill={C.line} isAnimationActive={false} />
                </BarChart>
              )}
            </div>
            <div className="flex-1 border-l border-line px-3 py-2 text-[12px]">
              <div className="mb-1 text-[11px] tracking-wide text-muted uppercase">Repeats found</div>
              {repeats
                .filter((r) => r.repeat > 0)
                .flatMap((r) =>
                  r.detail.map(([cat, ts]) => (
                    <div key={r.name + cat} className="mb-2">
                      <div>
                        <span className="font-mono text-navy">{r.name}</span> <span className="text-ink">{cat}</span>
                      </div>
                      {ts.map((t) => (
                        <div key={t.key} className="truncate text-[11px] leading-snug text-muted" title={t.subject}>
                          <span className="font-mono">{t.ticketId}</span> {t.subject}
                        </div>
                      ))}
                    </div>
                  )),
                )}
            </div>
          </div>
        </Card>

        <Card title="Average time to resolve, by vendor" aside={<span className="text-[11px] text-muted">hours, resolved tickets only</span>}>
          <div className="h-[230px] px-2 py-2">
            {mounted && (
              <BarChart width={560} height={220} data={byVendor} margin={{ left: 0, right: 20, top: 16, bottom: 4 }}>
                <CartesianGrid vertical={false} stroke={C.line} />
                <XAxis dataKey="name" tick={AXIS} stroke={C.line} />
                <YAxis tick={AXIS} stroke={C.line} />
                <Tooltip {...TIP} />
                <Bar dataKey="hours" fill={C.blue} isAnimationActive={false} maxBarSize={70}>
                  <LabelList dataKey="hours" position="top" style={{ fontSize: 11, fill: C.ink }} />
                </Bar>
              </BarChart>
            )}
          </div>
          <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
            {vendorStats.map((d) => `${d.name}: ${d.n} resolved, ${d.open} open`).join(" · ")}. A vendor with no resolved ticket has no bar.
          </p>
        </Card>

        <Card title="Average time to resolve, by site" aside={<span className="text-[11px] text-muted">hours, resolved tickets only</span>}>
          <div className="h-[230px] px-2 py-2">
            {mounted && (
              <BarChart width={560} height={220} data={bySite} margin={{ left: 0, right: 20, top: 16, bottom: 4 }}>
                <CartesianGrid vertical={false} stroke={C.line} />
                <XAxis dataKey="name" tick={{ ...AXIS, fontFamily: "IBM Plex Mono" }} stroke={C.line} />
                <YAxis tick={AXIS} stroke={C.line} />
                <Tooltip {...TIP} />
                <Bar dataKey="hours" fill={C.light} isAnimationActive={false} maxBarSize={50}>
                  <LabelList dataKey="hours" position="top" style={{ fontSize: 11, fill: C.ink }} />
                </Bar>
              </BarChart>
            )}
          </div>
          <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">Sites with no resolved ticket in the corpus are omitted.</p>
        </Card>
      </div>
    </div>
  );
}
