"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { usePipeline } from "@/components/PipelineState";
import { Amber, ConfidenceChip, FieldValue, Segmented, SourceBadge } from "@/components/ui";
import { COLUMN_KIND, type Extraction, type Field, KIND_LABEL, VENDOR_LABEL, type VendorKey } from "@/lib/extract";
import { fmtShort } from "@/lib/format";
import { COLUMNS } from "@/lib/seed";

type Tab = "all" | VendorKey | "exceptions";
const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "dematic", label: "Dematic" },
  { value: "knapp", label: "KNAPP" },
  { value: "schaefer", label: "SSI Schaefer" },
  { value: "exceptions", label: "Exceptions" },
];

interface Seg {
  start: number;
  end: number;
  cols: string[];
}

function segment(x: Extraction): Seg[] {
  const cuts = new Set([0, x.raw.length]);
  for (const c of COLUMNS) for (const s of x.fields[c].spans) if (s.end > s.start) cuts.add(s.start).add(s.end);
  const pts = [...cuts].sort((a, b) => a - b);
  const segs: Seg[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const cols = COLUMNS.filter((c) => x.fields[c].spans.some((s) => s.start <= a && s.end >= b));
    // Innermost field first, so hovering picks the most specific one.
    const len = (c: string) => Math.min(...x.fields[c].spans.filter((s) => s.start <= a && s.end >= b).map((s) => s.end - s.start));
    cols.sort((p, q) => len(p) - len(q));
    segs.push({ start: a, end: b, cols });
  }
  return segs;
}

export default function Messages() {
  const { rows } = usePipeline();
  const [tab, setTab] = useState<Tab>("all");
  const [selId, setSelId] = useState("RFI-01");
  const [hover, setHover] = useState<{ col: string; from: "raw" | "field" } | null>(null);
  const [pinned, setPinned] = useState<string | null>("AB_Location");
  const rawRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id && rows.some((r) => r.id === id)) setSelId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = useMemo(() => {
    const sorted = [...rows].sort((a, b) => (a.email.source === b.email.source ? a.email.received.localeCompare(b.email.received) : a.email.source === "rfi" ? -1 : 1));
    if (tab === "all") return sorted;
    if (tab === "exceptions") return sorted.filter((r) => r.outcome !== "loaded" || r.reprocessed);
    return sorted.filter((r) => r.vendor === tab);
  }, [rows, tab]);

  const x = rows.find((r) => r.id === selId) ?? rows[0];
  const segs = useMemo(() => segment(x), [x]);
  const active = hover?.col ?? pinned;

  const switchTab = (t: Tab) => {
    setTab(t);
    if (t === "dematic" || t === "knapp" || t === "schaefer") {
      const first = rows.find((r) => r.vendor === t && r.email.source === "rfi" && !r.isReply) ?? rows.find((r) => r.vendor === t);
      if (first) setSelId(first.id);
    }
  };

  // Keep the counterpart of whatever is hovered in view.
  useEffect(() => {
    if (!hover) return;
    const root = hover.from === "field" ? rawRef.current : fieldRef.current;
    const el = root?.querySelector<HTMLElement>(hover.from === "field" ? "[data-hot='1']" : `[data-col='${CSS.escape(hover.col)}']`);
    el?.scrollIntoView({ block: "nearest" });
  }, [hover]);

  // When following a column, bring it into view on each message.
  useEffect(() => {
    if (!pinned || hover) return;
    rawRef.current?.querySelector<HTMLElement>("[data-hot='1']")?.scrollIntoView({ block: "nearest" });
    fieldRef.current?.querySelector<HTMLElement>(`[data-col='${CSS.escape(pinned)}']`)?.scrollIntoView({ block: "nearest" });
  }, [selId, pinned, hover]);

  const pinnedField = pinned ? x.fields[pinned] : null;
  let firstHot = true;

  return (
    <div>
      <PageHeader title="Message detail" sub="Raw message as received on the left, the 21 extracted fields on the right. Hover either side to see where a value came from.">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted">Vendor</span>
          <Segmented options={TABS} value={tab} onChange={switchTab} />
        </div>
      </PageHeader>

      <div className="grid h-[calc(100vh-148px)] min-h-[620px] grid-cols-[230px_minmax(0,1fr)_470px] gap-3">
        {/* Message list */}
        <div className="flex min-h-0 flex-col border border-line">
          <div className="border-b border-line bg-alt px-3 py-1.5 text-[11px] tracking-wide text-muted uppercase">{list.length} messages</div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {list.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelId(r.id)}
                  className={`block w-full border-b border-l-[3px] border-b-line px-2.5 py-1.5 text-left ${r.id === x.id ? "border-l-blue bg-card" : "border-l-transparent hover:bg-alt"}`}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[12px] text-navy">{r.id}</span>
                    <span className={`text-[11px] ${r.outcome === "loaded" ? "text-muted" : "text-amber"}`}>
                      {r.outcome === "loaded" ? (r.vendor ? VENDOR_LABEL[r.vendor] : "") : r.outcome}
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-ink">{r.email.subject}</div>
                  <div className="text-[10px] text-muted">
                    {r.email.source === "rfi" ? "RFI appendix" : "Synthesized"} · {fmtShort(r.email.received)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Raw message */}
        <div className="flex min-h-0 flex-col border border-line">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-alt px-3 py-1.5">
            <span className="text-[12px] font-semibold tracking-wide text-blue uppercase">Raw message, as received</span>
            <SourceBadge source={x.email.source} />
          </div>
          <div className="border-b border-line px-3 py-1 text-[11px] text-muted">
            {x.email.source_note} · classified as <span className="text-navy">{x.template}</span>
          </div>
          <div ref={rawRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-[1.55] break-words whitespace-pre-wrap text-ink">
            {segs.map((s) => {
              const text = x.raw.slice(s.start, s.end);
              if (!s.cols.length) return <span key={s.start}>{text}</span>;
              const hot = !!active && s.cols.includes(active);
              const mark = hot && firstHot;
              if (mark) firstHot = false;
              return (
                <span
                  key={s.start}
                  data-hot={mark ? "1" : undefined}
                  onMouseEnter={() => setHover({ col: s.cols[0], from: "raw" })}
                  onMouseLeave={() => setHover(null)}
                  className={`cursor-default ${hot ? "bg-lightblue/35 outline outline-1 outline-lightblue" : "underline decoration-line decoration-dotted underline-offset-2 hover:bg-card"}`}
                >
                  {text}
                </span>
              );
            })}
          </div>
        </div>

        {/* Extracted fields */}
        <div className="flex min-h-0 flex-col border border-line">
          <div className="flex items-center justify-between border-b border-line bg-alt px-3 py-1.5">
            <span className="text-[12px] font-semibold tracking-wide text-blue uppercase">Extracted fields</span>
            <span className="text-[11px] text-muted">click a field to follow it across messages</span>
          </div>
          {x.outcome !== "loaded" && (
            <div className="border-b border-line p-2">
              <Amber kind="failure">
                <span className="font-semibold">
                  {x.outcome === "held" ? "Held" : "Rejected"} at {x.failStage}: {x.reason}.
                </span>{" "}
                {x.detail}
              </Amber>
            </div>
          )}
          {x.reprocessed && <div className="border-b border-line bg-card px-3 py-1.5 text-[11px] text-ink">{x.detail}</div>}
          {pinned && pinnedField && (
            <div className="border-b border-line bg-card px-3 py-1.5 text-[11px]">
              <span className="text-muted">Following </span>
              <span className="font-mono text-navy">{pinned}</span>
              <span className="text-muted"> in this {x.vendor ? VENDOR_LABEL[x.vendor] : ""} message: </span>
              <span className="text-ink">{pinnedField.source}</span>
              <button type="button" onClick={() => setPinned(null)} className="ml-2 text-blue underline">
                stop
              </button>
            </div>
          )}
          <div ref={fieldRef} className="min-h-0 flex-1 overflow-y-auto">
            {COLUMNS.map((c, i) => (
              <FieldRow
                key={c}
                col={c}
                f={x.fields[c]}
                x={x}
                alt={i % 2 === 1}
                active={active === c}
                pinned={pinned === c}
                onEnter={() => setHover({ col: c, from: "field" })}
                onLeave={() => setHover(null)}
                onClick={() => setPinned((p) => (p === c ? null : c))}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  col,
  f,
  x,
  alt,
  active,
  pinned,
  onEnter,
  onLeave,
  onClick,
}: {
  col: string;
  f: Field;
  x: Extraction;
  alt: boolean;
  active: boolean;
  pinned: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
}) {
  const kind = COLUMN_KIND[col];
  const k = x.norm.knapp;
  return (
    <div
      data-col={col}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onClick}
      className={`cursor-pointer border-b border-l-[3px] border-b-line px-3 py-1.5 ${active ? "border-l-lightblue bg-lightblue/15" : pinned ? "border-l-blue" : "border-l-transparent"} ${!active && alt ? "bg-alt" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-navy">
          {col}
          <span className="ml-1.5 border border-line px-1 text-[9px] text-muted" title={KIND_LABEL[kind]}>
            {kind}
          </span>
        </span>
        <ConfidenceChip value={f.confidence} />
      </div>
      <div className="mt-0.5 line-clamp-3 text-[12.5px] leading-snug break-words text-ink">
        <FieldValue f={f} />
      </div>
      {col === "AB_CaseContact" && (x.norm.contact.phone || x.norm.contact.email) && (
        <div className="mt-0.5 font-mono text-[11px] text-ink">
          phone {x.norm.contact.phone ?? "-"} · email {x.norm.contact.email ?? "-"}
        </div>
      )}
      {f.raw && col !== "AB_Location" && <div className="mt-0.5 font-mono text-[11px] text-muted">vendor value: {f.raw}</div>}
      {col === "AB_Location" && f.raw && <div className="mt-0.5 font-mono text-[11px] text-muted">site_key {f.raw}</div>}
      {col === "CasePriority" && k && k.customerRank !== k.vendorRank && (
        <div className="mt-1">
          <Amber kind="decision">
            Customer rated {k.customerRaw}, KNAPP rated {k.vendorRaw}. Both are kept; this row is normalized on the customer rating.
          </Amber>
        </div>
      )}
      <div className="mt-0.5 text-[11px] leading-snug text-muted">{f.source}</div>
    </div>
  );
}
