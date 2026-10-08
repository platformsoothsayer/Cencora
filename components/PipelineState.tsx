"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Extraction } from "@/lib/extract";
import { runAll, type RunSummary, SCHEDULED_RUNS, STAGE_MS, summarize } from "@/lib/pipeline";
import { EMAILS } from "@/lib/seed";

export interface ReprocessResult {
  id: string;
  attempt: number;
  outcome: Extraction["outcome"];
  message: string;
}

interface State {
  /** Current state of every message, including reprocessed ones. */
  rows: Extraction[];
  /** Messages whose fallback output was accepted on reprocess. */
  accepted: Record<string, boolean>;
  runs: RunSummary[];
  reprocessLog: ReprocessResult[];
  recordLiveRun: (rows: Extraction[], durationMs: number) => void;
  reprocess: (id: string) => ReprocessResult;
}

const Ctx = createContext<State | null>(null);

export function PipelineProvider({ children }: { children: React.ReactNode }) {
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [sessionRuns, setSessionRuns] = useState<RunSummary[]>([]);
  const [reprocessLog, setReprocessLog] = useState<ReprocessResult[]>([]);

  const rows = useMemo(() => runAll({ accepted }), [accepted]);

  const recordLiveRun = useCallback((rs: Extraction[], durationMs: number) => {
    setSessionRuns((prev) => {
      const n = prev.filter((r) => r.kind === "Live run").length + 1;
      const run: RunSummary = {
        id: `L-${String(n).padStart(3, "0")}`,
        label: `Corpus replay ${n}`,
        kind: "Live run",
        at: "",
        durationMs,
        ...summarize(rs),
      };
      return [run, ...prev];
    });
  }, []);

  const reprocess = useCallback(
    (id: string): ReprocessResult => {
      const email = EMAILS.find((e) => e.id === id)!;
      const attempt = reprocessLog.filter((r) => r.id === id).length + 1;
      const next = runAll({ accepted: { ...accepted, [id]: true } }).find((r) => r.id === id)!;
      let message: string;
      if (next.outcome === "loaded") {
        message = "Loaded. The fallback field mapping was accepted and the row is now in the table at 0.55 confidence.";
        setAccepted((a) => ({ ...a, [id]: true }));
      } else if (next.failureType === "Attachment extraction failure") {
        message = `Still held. ${email.attachment?.filename} has no text layer on a second read. It needs OCR or a readable copy from the vendor.`;
      } else {
        message = "Still rejected. The sender is out of scope. The message stays in the lake as received.";
      }
      const result = { id, attempt, outcome: next.outcome, message };
      setReprocessLog((l) => [result, ...l]);
      setSessionRuns((prev) => [
        {
          id: `P-${String(prev.filter((r) => r.kind === "Reprocess").length + 1).padStart(3, "0")}`,
          label: `Reprocess ${id}`,
          kind: "Reprocess",
          at: "",
          durationMs: 5 * STAGE_MS,
          ...summarize([next]),
        },
        ...prev,
      ]);
      return result;
    },
    [accepted, reprocessLog],
  );

  const value = useMemo(
    () => ({ rows, accepted, runs: [...sessionRuns, ...SCHEDULED_RUNS], reprocessLog, recordLiveRun, reprocess }),
    [rows, accepted, sessionRuns, reprocessLog, recordLiveRun, reprocess],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePipeline() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePipeline outside PipelineProvider");
  return v;
}
