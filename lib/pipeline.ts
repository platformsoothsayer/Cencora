// Corpus-level views built on top of extract(): run order, run summaries,
// tickets, and the analyst-side categorization used on the insights page.

import { extract, STAGES, type ExtractOptions, type Extraction, type FailureType, type Stage, VENDOR_LABEL, type VendorKey } from "./extract";
import { EMAILS, SEED } from "./seed";

export const STAGE_MS = 120;

/** Messages in the order the mailbox poll picks them up. */
export const RUN_ORDER = [...EMAILS].sort((a, b) => a.received.localeCompare(b.received) || a.id.localeCompare(b.id));

export function runAll(opts: ExtractOptions & { accepted?: Record<string, boolean> } = {}): Extraction[] {
  return RUN_ORDER.map((e) => extract(e, { ...opts, acceptFallback: opts.accepted?.[e.id] ?? false }));
}

/** Pipelined schedule: one message enters per tick and advances one stage per tick. */
export function runDurationMs(n: number) {
  return (n + STAGES.length - 1) * STAGE_MS;
}

/** The stage a message stops at: the last stage for a loaded message. */
export function lastStage(x: Extraction): Stage {
  return x.failStage ?? "Load";
}

export interface RunSummary {
  id: string;
  label: string;
  kind: "Scheduled poll" | "Live run" | "Reprocess";
  at: string;
  read: number;
  loaded: number;
  held: number;
  rejected: number;
  durationMs: number;
  failures: Partial<Record<FailureType, number>>;
}

export function summarize(rows: Extraction[]) {
  const failures: Partial<Record<FailureType, number>> = {};
  for (const r of rows) if (r.failureType) failures[r.failureType] = (failures[r.failureType] ?? 0) + 1;
  return {
    read: rows.length,
    loaded: rows.filter((r) => r.outcome === "loaded").length,
    held: rows.filter((r) => r.outcome === "held").length,
    rejected: rows.filter((r) => r.outcome === "rejected").length,
    failures,
  };
}

/** Scheduled polls reconstructed from the corpus: one run per UTC day of arrival. */
export const SCHEDULED_RUNS: RunSummary[] = (() => {
  const rows = runAll();
  const byDay = new Map<string, Extraction[]>();
  for (const r of rows) {
    const day = r.email.received.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), r]);
  }
  return [...byDay.entries()]
    .map(([day, rs]) => ({
      id: `R-${day.replace(/-/g, "")}`,
      label: `Daily poll ${day}`,
      kind: "Scheduled poll" as const,
      at: `${day}T23:55:00Z`,
      durationMs: runDurationMs(rs.length),
      ...summarize(rs),
    }))
    .reverse();
})();

// ---------------------------------------------------------------------------
// Tickets: one row per vendor case rather than per email

export interface TicketEvent {
  id: string;
  at: string;
  status: string | null;
  statusRaw: string | null;
  isReply: boolean;
}

export interface TicketRow {
  key: string;
  ticketId: string;
  vendor: VendorKey;
  siteKey: string | null;
  subject: string;
  category: string;
  firstSeen: string;
  lastUpdate: string;
  resolvedAt: string | null;
  timeToResolveMs: number | null;
  /** The first email seen already carried a resolved status, so no duration can be measured. */
  firstSeenResolved: boolean;
  currentStatus: string | null;
  events: TicketEvent[];
  emailIds: string[];
}

/** A ticket counts as resolved at its first Pending verification or Closed status. */
export const RESOLVED_STATUSES = ["Pending verification", "Closed"];

const CATEGORY_RULES: [string, RegExp][] = [
  ["Scanners and reads", /scanner|no reads|barcode/i],
  ["Sorter and diverts", /sorter|divert|jackpot/i],
  ["Lifts and shuttles", /\blift\b|shuttle/i],
  ["Pick stations", /pick it easy|pick station/i],
  ["Controls and software", /parameter|software|frozen|process|host|order start|firmware|java|exception/i],
  ["Sensors and indicators", /photo eye|indicator|light gate|75%/i],
  ["Drives and motors", /motor|drive/i],
  ["Totes and lids", /tote|\blids?\b/i],
  ["Packaging", /carton|erector/i],
];

export const CATEGORIES = CATEGORY_RULES.map(([c]) => c).concat("Other");

export function categorize(text: string) {
  return CATEGORY_RULES.find(([, re]) => re.test(text))?.[0] ?? "Other";
}

export function buildTickets(rows: Extraction[]): TicketRow[] {
  const loaded = rows.filter((r) => r.outcome === "loaded" && r.vendor);
  const groups = new Map<string, Extraction[]>();
  for (const r of loaded) {
    const id = r.fields["CaseNumber/TicketID"].value;
    if (!id) continue;
    const key = `${r.vendor}:${id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const seedSubject = new Map(SEED.tickets.map((t) => [t.ticket_id, t.subject]));
  return [...groups.entries()]
    .map(([key, rs]) => {
      rs.sort((a, b) => a.email.received.localeCompare(b.email.received));
      const ticketId = rs[0].fields["CaseNumber/TicketID"].value!;
      const events = rs.map((r) => ({ id: r.id, at: r.email.received, status: r.norm.statusLabel, statusRaw: r.norm.statusRaw, isReply: r.isReply }));
      const resolved = events.find((e) => e.status && RESOLVED_STATUSES.includes(e.status));
      const firstSeen = rs[0].email.received;
      const subject =
        seedSubject.get(ticketId) ?? rs.map((r) => r.fields.CaseSubject.value).find(Boolean) ?? rs.map((r) => r.fields.IssueDescription.value).find(Boolean) ?? "";
      const text = rs
        .flatMap((r) => [r.fields.CaseSubject.value, r.fields.IssueDescription.value, r.isReply ? r.fields["CaseComment/TicketType"].value : null])
        .filter(Boolean)
        .join(" ");
      return {
        key,
        ticketId,
        vendor: rs[0].vendor!,
        siteKey: rs.map((r) => r.norm.siteKey).find(Boolean) ?? null,
        subject,
        // The subject names the fault most directly; the description is the fallback.
        category: categorize(subject) !== "Other" ? categorize(subject) : categorize(text),
        firstSeen,
        lastUpdate: rs[rs.length - 1].email.received,
        resolvedAt: resolved?.at ?? null,
        timeToResolveMs: resolved && resolved !== events[0] ? Date.parse(resolved.at) - Date.parse(firstSeen) : null,
        firstSeenResolved: resolved === events[0],
        currentStatus: [...events].reverse().find((e) => e.status)?.status ?? null,
        events,
        emailIds: rs.map((r) => r.id),
      };
    })
    .sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
}

export const vendorName = (v: VendorKey | null) => (v ? VENDOR_LABEL[v] : "Unknown");
