"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { usePipeline } from "@/components/PipelineState";
import { Btn, Card } from "@/components/ui";
import { type Extraction, STAGES, VENDOR_LABEL } from "@/lib/extract";
import { lastStage, runAll, runDurationMs, STAGE_MS } from "@/lib/pipeline";
import { SITES } from "@/lib/seed";

// The live run always replays the corpus from scratch, so it is the same every time.
const ROWS = runAll();
const N = ROWS.length;
const TOTAL_TICKS = runDurationMs(N) / STAGE_MS;
const stopIndex = (r: Extraction) => STAGES.indexOf(lastStage(r));

function mailboxOf(r: Extraction) {
  const to = r.email.to.toLowerCase();
  return SITES.find((s) => to.includes(`${s.mailbox.toLowerCase()}@`))?.key ?? null;
}
const MAILBOX = ROWS.map(mailboxOf);

function logLine(r: Extraction) {
  const f = r.fields;
  const id = f["CaseNumber/TicketID"].value;
  if (r.outcome === "rejected") return `rejected  ${r.reason}: sender not an in-scope vendor`;
  if (r.outcome === "held") return `held      ${r.reason}: ${r.failureType === "Text parsing error" ? "known layout not matched" : "PDF has no text layer"}`;
  const vendor = r.vendor ? VENDOR_LABEL[r.vendor] : "";
  return `loaded    ${vendor.padEnd(12)} ${(id ?? "").padEnd(9)} ${(r.norm.siteKey ?? "").padEnd(4)} ${(r.norm.priorityLabel?.slice(0, 2) ?? "--").padEnd(3)} ${r.norm.statusLabel ?? (r.isReply ? "reply" : "")}`;
}

export default function LiveRun() {
  const { recordLiveRun } = usePipeline();
  // tick -1: idle. 0..TOTAL_TICKS: running / finished.
  const [tick, setTick] = useState(-1);
  const [runNo, setRunNo] = useState(0);
  const recorded = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const running = tick >= 0 && tick < TOTAL_TICKS;
  const done = tick >= TOTAL_TICKS;

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setTick((x) => x + 1), STAGE_MS);
    return () => clearTimeout(t);
  }, [tick, running]);

  useEffect(() => {
    if (done && recorded.current !== runNo) {
      recorded.current = runNo;
      recordLiveRun(ROWS, runDurationMs(N));
    }
  }, [done, runNo, recordLiveRun]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [tick]);

  const start = () => {
    setRunNo((n) => n + 1);
    setTick(0);
  };

  const view = useMemo(() => {
    const t = tick;
    const inStage: Extraction[][] = STAGES.map(() => []);
    const passed = STAGES.map(() => 0);
    const finished: Extraction[] = [];
    const unread: Record<string, number> = Object.fromEntries(SITES.map((s) => [s.key, 0]));
    ROWS.forEach((r, i) => {
      const stop = stopIndex(r);
      if (t < 0 || t < i) {
        const mb = MAILBOX[i];
        if (mb) unread[mb]++;
        return;
      }
      const s = t - i;
      for (let k = 0; k <= Math.min(s, stop); k++) passed[k]++;
      if (s <= stop) inStage[s].push(r);
      else finished.push(r);
    });
    // Log in completion order: a message that stops early finishes early.
    finished.sort((a, b) => ROWS.indexOf(a) + stopIndex(a) - (ROWS.indexOf(b) + stopIndex(b)));
    return {
      inStage,
      passed,
      finished,
      unread,
      loaded: finished.filter((r) => r.outcome === "loaded"),
      held: finished.filter((r) => r.outcome === "held"),
      rejected: finished.filter((r) => r.outcome === "rejected"),
    };
  }, [tick]);

  const elapsed = tick < 0 ? 0 : Math.min(tick, TOTAL_TICKS) * STAGE_MS;
  const totalUnread = Object.values(view.unread).reduce((a, b) => a + b, 0);

  return (
    <div>
      <PageHeader title="Live run" sub="Replays the 46-message demonstration corpus through the pipeline, one stage every 120 ms.">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[12px] text-muted">{running ? "running" : done ? `run ${runNo} complete` : "idle"}</span>
          <Btn primary onClick={start} disabled={running} className="px-5 py-2">
            {done ? "Run pipeline again" : "Run pipeline"}
          </Btn>
        </div>
      </PageHeader>

      <div className="grid grid-cols-[210px_minmax(0,1fr)_270px] gap-4">
        {/* Mailboxes */}
        <Card title="Mailboxes" aside={<span className="font-mono text-[11px] text-muted">{totalUnread} unread</span>}>
          <ul>
            {SITES.map((s) => (
              <li key={s.key} className="flex items-center justify-between border-b border-line px-3 py-[7px] last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12px] text-navy">{s.mailbox}</div>
                  <div className="text-[11px] text-muted">
                    {s.city}, {s.state}
                  </div>
                </div>
                <span
                  className={`min-w-7 border px-1.5 text-center font-mono text-[12px] ${
                    view.unread[s.key] ? "border-navy bg-navy text-white" : "border-line text-muted"
                  }`}
                >
                  {view.unread[s.key]}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-3 py-2 text-[11px] leading-snug text-muted">Demonstration corpus loaded from the seed file. No live mailbox is connected.</p>
        </Card>

        {/* Stages, counters, log */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-5 border border-line">
            {STAGES.map((st, k) => (
              <div key={st} className={`${k > 0 ? "border-l border-line" : ""}`}>
                <div className="flex items-baseline justify-between bg-navy px-2.5 py-1.5 text-white">
                  <span className="text-[12px] font-semibold">
                    <span className="mr-1.5 font-mono text-[10px] text-white/60">{k + 1}</span>
                    {st}
                  </span>
                  <span className="font-mono text-[12px]">{view.passed[k]}</span>
                </div>
                <div className="h-[64px] bg-alt px-2 py-1.5">
                  {view.inStage[k].map((r) => (
                    <div
                      key={r.id}
                      className={`mb-1 truncate border px-1.5 py-0.5 font-mono text-[11px] ${
                        r.failStage === st ? "border-amber bg-white text-amber" : "border-lightblue bg-white text-navy"
                      }`}
                    >
                      {r.id} <span className="text-muted">{r.vendor ? VENDOR_LABEL[r.vendor] : "unknown sender"}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-5 divide-x divide-line border border-line">
            <Counter label="Read" value={view.passed[0]} />
            <Counter label="Loaded" value={view.loaded.length} />
            <Counter label="Held" value={view.held.length} amber={view.held.length > 0} />
            <Counter label="Rejected" value={view.rejected.length} amber={view.rejected.length > 0} />
            <Counter label="Elapsed" value={`${(elapsed / 1000).toFixed(1)} s`} />
          </div>

          <Card title="Run log" aside={<span className="font-mono text-[11px] text-muted">one line per message</span>}>
            <div ref={logRef} className="h-[384px] overflow-y-auto px-3 py-2 font-mono text-[11.5px] leading-[1.6]">
              {tick < 0 && <div className="text-muted">Press Run pipeline to start. 46 messages are waiting in ten mailboxes.</div>}
              {view.finished.map((r) => {
                const i = ROWS.indexOf(r);
                const at = (i + stopIndex(r) + 1) * STAGE_MS;
                return (
                  <div key={r.id} className={`whitespace-pre ${r.outcome === "loaded" ? "text-ink" : "text-amber"}`}>
                    <span className="text-muted">+{(at / 1000).toFixed(2)}s </span>
                    {r.id.padEnd(9)} {logLine(r)}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Exceptions */}
        <div className="flex flex-col gap-3">
          <Card title="Holding queue" aside={<span className="font-mono text-[11px] text-muted">{view.held.length}</span>}>
            <div className="min-h-[150px]">
              {view.held.length === 0 && <p className="px-3 py-3 text-[12px] text-muted">Nothing held yet.</p>}
              {view.held.map((r) => (
                <Exception key={r.id} r={r} />
              ))}
            </div>
          </Card>
          <Card title="Rejected" aside={<span className="font-mono text-[11px] text-muted">{view.rejected.length}</span>}>
            <div className="min-h-[90px]">
              {view.rejected.length === 0 && <p className="px-3 py-3 text-[12px] text-muted">Nothing rejected yet.</p>}
              {view.rejected.map((r) => (
                <Exception key={r.id} r={r} />
              ))}
            </div>
          </Card>
          <p className="text-[11px] leading-snug text-muted">
            Held and rejected messages are stored as received. Open them on the <Link href="/monitoring" className="text-blue underline">Monitoring</Link> page to reprocess.
          </p>
        </div>
      </div>

      <div className={`mt-4 border ${done ? "border-navy" : "border-line"} bg-white`}>
        <div className="flex items-center justify-between">
          <div className="flex divide-x divide-line">
            <Summary label="read" value={done ? view.passed[0] : "-"} />
            <Summary label="loaded" value={done ? view.loaded.length : "-"} />
            <Summary label="held" value={done ? view.held.length : "-"} amber={done} />
            <Summary label="rejected" value={done ? view.rejected.length : "-"} amber={done} />
            <Summary label="elapsed" value={done ? `${(elapsed / 1000).toFixed(1)} s` : "-"} />
          </div>
          <div className="flex items-center gap-2 px-4">
            {done ? (
              <>
                <Link href="/table" className="border border-line px-3 py-1.5 text-[12px] text-navy hover:bg-card">
                  Open the output table
                </Link>
                <Link href="/monitoring" className="border border-line px-3 py-1.5 text-[12px] text-navy hover:bg-card">
                  Review the holding queue
                </Link>
              </>
            ) : (
              <span className="text-[12px] text-muted">Summary appears when the run completes.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Counter({ label, value, amber }: { label: string; value: React.ReactNode; amber?: boolean }) {
  return (
    <div className="px-3 py-1.5">
      <div className={`font-mono text-[20px] font-semibold leading-tight ${amber ? "text-amber" : "text-navy"}`}>{value}</div>
      <div className="text-[11px] tracking-wide text-muted uppercase">{label}</div>
    </div>
  );
}

function Summary({ label, value, amber }: { label: string; value: React.ReactNode; amber?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 px-5 py-2.5">
      <span className={`font-mono text-[22px] font-semibold ${amber ? "text-amber" : "text-navy"}`}>{value}</span>
      <span className="text-[13px] text-muted">{label}</span>
    </div>
  );
}

function Exception({ r }: { r: Extraction }) {
  return (
    <div className="border-b border-line px-3 py-2 last:border-b-0">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[12px] text-navy">{r.id}</span>
        <span className="text-[11px] text-muted">at {r.failStage}</span>
      </div>
      <div className="text-[12px] font-semibold text-amber">{r.reason}</div>
      <div className="mt-0.5 line-clamp-3 text-[11px] leading-snug text-ink">{r.detail}</div>
    </div>
  );
}
