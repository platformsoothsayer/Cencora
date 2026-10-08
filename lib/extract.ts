// Turns one hotline email from the seed corpus into the 21 columns Cencora
// specified, with a confidence score per field and the character spans each
// value was read from. Everything here parses the message text itself:
// no field is looked up from a precomputed answer.
//
// Confidence rules
//   1.0   read from a labeled match (or a mail header)
//   0.9   parsed out of the subject line
//   0.75  resolved from the recipient mailbox rather than the message
//   0.55  recovered by the fallback extractor on a drifted template
//   null  the vendor does not send this field

import { compactStamp, isoPlusMinutes } from "./format";
import { COLUMNS, SEED, SITES } from "./seed";
import type { SeedEmail, Site } from "./types";

export type VendorKey = "dematic" | "knapp" | "schaefer";
export const VENDOR_LABEL: Record<VendorKey, string> = {
  dematic: "Dematic",
  knapp: "KNAPP",
  schaefer: "SSI Schaefer",
};

export type Method = "header" | "label" | "subject" | "mailbox" | "fallback" | "generated" | "absent";

export interface Span {
  start: number;
  end: number;
}

export interface Field {
  /** null means the vendor does not send this field. "" means the label was sent with no value. */
  value: string | null;
  confidence: number | null;
  method: Method;
  /** Where the value came from, in words the room can follow. */
  source: string;
  spans: Span[];
  /** The vendor's own value before normalization, where it differs. */
  raw?: string;
}

export const STAGES = ["Intake", "Classify", "Extract", "Normalize", "Load"] as const;
export type Stage = (typeof STAGES)[number];

export const FAILURE_TYPES = [
  "Incoming email rejection",
  "Email reading failure",
  "Attachment extraction failure",
  "Text parsing error",
  "Parquet conversion error",
  "Database ingestion error",
] as const;
export type FailureType = (typeof FAILURE_TYPES)[number];

export type Outcome = "loaded" | "held" | "rejected";

export type SitePath = "dematic_customer_id" | "knapp_account" | "mailbox" | "fallback_text";

export interface Extraction {
  id: string;
  email: SeedEmail;
  /** The message as received: headers then body. Spans index into this. */
  raw: string;
  vendor: VendorKey | null;
  template: string;
  isReply: boolean;
  outcome: Outcome;
  failStage: Stage | null;
  failureType: FailureType | null;
  reason: string | null;
  detail: string | null;
  reprocessed: boolean;
  fields: Record<string, Field>;
  norm: {
    siteKey: string | null;
    sitePath: SitePath | null;
    siteIdentifier: string | null;
    priorityRank: number | null;
    priorityLabel: string | null;
    statusLabel: string | null;
    statusRaw: string | null;
    knapp: { customerRank: number; customerRaw: string; vendorRank: number; vendorRaw: string; headline: string } | null;
    contact: { name: string | null; phone: string | null; email: string | null };
  };
}

export interface ExtractOptions {
  /** Reprocess: accept the fallback extractor's output for a drifted template. */
  acceptFallback?: boolean;
  /** Which KNAPP rating drives normalization. A decision for Cencora; customer by default. */
  knappBasis?: "customer" | "knapp";
}

// ---------------------------------------------------------------------------
// Raw message assembly

interface Header {
  raw: string;
  fromSpan: Span;
  toSpan: Span;
  subjectSpan: Span;
  receivedSpan: Span;
  attachmentSpan: Span | null;
  bodyStart: number;
}

function assemble(e: SeedEmail): Header {
  let raw = "";
  const put = (label: string, value: string, valueOffset = 0, valueLen = value.length) => {
    const start = raw.length + label.length + valueOffset;
    raw += label + value + "\n";
    return { start, end: start + valueLen };
  };
  put("From: ", `${e.from_name} <${e.from_email}>`);
  const fromSpan = { start: raw.length - e.from_email.length - 2, end: raw.length - 2 };
  const toSpan = put("To: ", e.to);
  const subjectSpan = put("Subject: ", e.subject);
  const receivedSpan = put("Received: ", e.received);
  const attachmentSpan = e.attachment ? put("Attachment: ", e.attachment.filename) : null;
  raw += "\n";
  const bodyStart = raw.length;
  raw += e.body;
  return { raw, fromSpan, toSpan, subjectSpan, receivedSpan, attachmentSpan, bodyStart };
}

// ---------------------------------------------------------------------------
// Text helpers

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Hit {
  value: string;
  span: Span;
}

/** Trimmed hit for a capture that starts at absolute offset `at`. */
function trimmed(text: string, at: number): Hit {
  const lead = text.length - text.trimStart().length;
  const value = text.trim();
  return { value, span: { start: at + lead, end: at + lead + value.length } };
}

/**
 * A labeled line: `Label: value` or KNAPP's `- Label:\t value\t `.
 * Returns "" (not null) when the label is present with no value.
 */
function labeled(raw: string, from: number, label: string): Hit | null {
  const re = new RegExp(`^[ \\t]*(?:- )?${esc(label)}:([^\\n]*)`, "m");
  const m = re.exec(raw.slice(from));
  if (!m) return null;
  const valueAt = from + m.index + m[0].length - m[1].length;
  const hit = trimmed(m[1], valueAt);
  if (!hit.value) return { value: "", span: { start: valueAt, end: valueAt } };
  return hit;
}

/** Label whose value may sit on the same line or the next non-empty line. */
function labeledLoose(raw: string, from: number, label: string): Hit | null {
  const re = new RegExp(`^[ \\t]*${esc(label)}:[ \\t]*([^\\n]*)`, "m");
  const m = re.exec(raw.slice(from));
  if (!m) return null;
  if (m[1].trim()) return trimmed(m[1], from + m.index + m[0].length - m[1].length);
  const after = from + m.index + m[0].length;
  const rest = /\n(?:[ \t]*\n)*[ \t]*([^\n]*\S)/.exec(raw.slice(after));
  if (!rest) return null;
  return trimmed(rest[1], after + rest.index + rest[0].length - rest[1].length);
}

/** A block of text after `label:` up to the next stop pattern (or the end). */
function block(raw: string, from: number, label: string, stop?: RegExp): Hit | null {
  const re = new RegExp(`^[ \\t]*${esc(label)}:`, "m");
  const m = re.exec(raw.slice(from));
  if (!m) return null;
  const start = from + m.index + m[0].length;
  let end = raw.length;
  if (stop) {
    const s = stop.exec(raw.slice(start));
    if (s) end = start + s.index;
  }
  const h = trimmed(raw.slice(start, end), start);
  return h.value ? h : null;
}

const tidy = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");

/** Where the vendor's own text starts, after the gateway's CAUTION banner. */
function afterBanner(raw: string, bodyStart: number) {
  const m = /^CAUTION:[^\n]*\n/.exec(raw.slice(bodyStart));
  return m ? bodyStart + m[0].length : bodyStart;
}

function preamble(raw: string, bodyStart: number, stop: RegExp): Hit | null {
  const from = afterBanner(raw, bodyStart);
  const s = stop.exec(raw.slice(from));
  const end = s ? from + s.index : raw.length;
  const h = trimmed(raw.slice(from, end), from);
  return h.value ? h : null;
}

function find(raw: string, needle: string, from = 0): Span | null {
  const i = raw.indexOf(needle, from);
  return i < 0 ? null : { start: i, end: i + needle.length };
}

// ---------------------------------------------------------------------------
// Normalization tables, built from priority_map and status_map

interface PriorityRule {
  rank: number;
  label: string;
}

const P_LABEL = new Map(SEED.priority_map.map((r) => [r.rank, r.normalized]));

const PRIORITY: Record<VendorKey, Map<string, PriorityRule>> = { dematic: new Map(), knapp: new Map(), schaefer: new Map() };
for (const r of SEED.priority_map) {
  const rule = { rank: r.rank, label: r.normalized };
  for (const v of r.dematic.split(",").map((s) => s.trim())) if (v && v !== "not used") PRIORITY.dematic.set(v, rule);
  // KNAPP is keyed on the leading number: the label text varies (Medium, Normal).
  const kn = /^(\d)/.exec(r.knapp);
  if (kn) PRIORITY.knapp.set(kn[1], rule);
  if (r.schaefer !== "not used") PRIORITY.schaefer.set(r.schaefer.toUpperCase(), rule);
}

function priorityFor(vendor: VendorKey, raw: string): PriorityRule | null {
  return PRIORITY[vendor].get(vendor === "schaefer" ? raw.toUpperCase() : raw) ?? null;
}

interface StatusRule {
  phrase: string;
  label: string;
}

const STATUS: Record<VendorKey, StatusRule[]> = { dematic: [], knapp: [], schaefer: [] };
for (const r of SEED.status_map) {
  for (const v of ["dematic", "knapp", "schaefer"] as VendorKey[]) {
    const cell = r[v];
    if (!cell || cell === "not sent") continue;
    const phrases = v === "dematic" ? cell.split(",") : [cell.replace(/\(subject line\)/i, "")];
    for (const p of phrases) STATUS[v].push({ phrase: p.trim().toLowerCase(), label: r.normalized });
  }
}
export const STATUS_ORDER = SEED.status_map.map((r) => r.normalized);

function statusFor(vendor: VendorKey, raw: string): string | null {
  const k = raw.trim().toLowerCase();
  return STATUS[vendor].find((s) => s.phrase === k)?.label ?? null;
}

// ---------------------------------------------------------------------------
// Site resolution against the site master

function siteByCustomerId(id: string) {
  return SITES.find((s) => s.dematic_customer_id === id) ?? null;
}
function siteByAccount(acct: string) {
  return SITES.find((s) => s.knapp_account.toUpperCase() === acct.toUpperCase()) ?? null;
}
function siteByText(text: string): Site | null {
  const t = text.toLowerCase();
  return SITES.find((s) => t.includes(s.city.toLowerCase()) && new RegExp(`\\b${s.state.toLowerCase()}\\b`).test(t)) ?? null;
}

/** The first monitored mailbox in the To header, with its span. */
function mailboxSite(raw: string, toSpan: Span): { site: Site; span: Span } | null {
  const to = raw.slice(toSpan.start, toSpan.end);
  const re = /<?([A-Za-z0-9._-]+)@[A-Za-z0-9.-]+>?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(to))) {
    const site = SITES.find((s) => s.mailbox.toLowerCase() === m![1].toLowerCase());
    if (site) {
      const at = toSpan.start + m.index + m[0].indexOf(m[1]);
      return { site, span: { start: at, end: at + m[1].length } };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Field builders

const NOT_SENT = (why = "This vendor's template has no such field"): Field => ({
  value: null,
  confidence: null,
  method: "absent",
  source: why,
  spans: [],
});

const CONF: Record<Exclude<Method, "absent">, number> = {
  header: 1,
  label: 1,
  generated: 1,
  subject: 0.9,
  mailbox: 0.75,
  fallback: 0.55,
};

function F(method: Exclude<Method, "absent">, value: string, source: string, spans: (Span | null | undefined)[], raw?: string): Field {
  return { value, confidence: CONF[method], method, source, spans: spans.filter(Boolean) as Span[], raw };
}

function fromHit(method: Exclude<Method, "absent">, h: Hit | null, source: string, clean = false): Field {
  if (!h) return NOT_SENT();
  return F(method, clean ? tidy(h.value) : h.value, source, [h.span]);
}

/** dd.mm.yyyy HH:MM:SS UTC -> yyyy-mm-dd HH:MM:SS UTC */
function europeanToIso(s: string) {
  const m = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2}:\d{2})\s*UTC/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]} UTC` : null;
}

/** m/d/yyyy -> yyyy-mm-dd */
function usToIso(s: string) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

// ---------------------------------------------------------------------------
// Classification

interface Classified {
  vendor: VendorKey | null;
  template: string;
  isReply: boolean;
  reject?: string;
}

const DEMATIC_SUBJECT = /Customer ID (\d+); Site:(.*?); Ticket (\d+); Update/;
const KNAPP_SUBJECT = /KNAPP \[ Ticket: (\d+) \] - (US\d+) - (.+?) - ##/;
const KNAPP_REPLY_SUBJECT = /\[ Ticket: (\d+) \] (US\d+)\s+(.*)$/;
const RFC_SUBJECT = /^(US\d+)_RfC(\d+)_(\d{4}-\d{2}-\d{2})_(.*)$/;

export function classify(e: SeedEmail): Classified {
  const domain = e.from_email.split("@")[1]?.toLowerCase() ?? "";
  const body = e.body;
  if (domain.endsWith("dematic.com")) {
    const known = /^Case Number:/m.test(body) && /^Case Priority:/m.test(body) && /^Case Status:/m.test(body);
    return { vendor: "dematic", template: known ? "Dematic case update" : "Dematic, layout not recognized", isReply: false };
  }
  if (domain.endsWith("knapp.com")) {
    if (RFC_SUBJECT.test(e.subject)) return { vendor: "knapp", template: "KNAPP Request for Change notice", isReply: false };
    return { vendor: "knapp", template: "KNAPP ticket notification", isReply: false };
  }
  if (domain.endsWith("ssi-schaefer.com") || (domain === "salesforce.com" && /^Ticket-ID:/m.test(body) && /^Prio:/m.test(body))) {
    return { vendor: "schaefer", template: "SSI Schaefer case notification", isReply: false };
  }
  // A Cencora user replying inside a vendor thread keeps the vendor's reference in the subject.
  if (/^RE:/i.test(e.subject)) {
    if (DEMATIC_SUBJECT.test(e.subject)) return { vendor: "dematic", template: "Cencora reply in a Dematic thread", isReply: true };
    if (KNAPP_REPLY_SUBJECT.test(e.subject)) return { vendor: "knapp", template: "Cencora reply in a KNAPP thread", isReply: true };
  }
  return {
    vendor: null,
    template: "Not a vendor message",
    isReply: false,
    reject: `Sender ${e.from_email} does not match any in-scope vendor and the subject carries no vendor ticket reference.`,
  };
}

// ---------------------------------------------------------------------------
// Vendor parsers. Each returns the vendor-specific columns plus raw values
// that normalization needs.

interface Parsed {
  cols: Partial<Record<string, Field>>;
  priorityRaw: { value: string; span: Span | null; method: Exclude<Method, "absent">; source: string } | null;
  knapp?: Extraction["norm"]["knapp"];
  statusRaw: { value: string; span: Span | null; method: Exclude<Method, "absent">; source: string } | null;
  site: { site: Site; spans: Span[]; method: Exclude<Method, "absent">; path: SitePath; identifier: string; source: string } | null;
  contact: Extraction["norm"]["contact"];
  /** KNAPP's (Customer / KNAPP) rating pair, highlighted with the priority. */
  pairSpans?: Span[];
}

function parseDematic(raw: string, h: Header, e: SeedEmail): Parsed {
  const b = h.bodyStart;
  const caseNo = labeled(raw, b, "Case Number");
  const subj = labeled(raw, b, "Case Subject");
  const contact = labeled(raw, b, "Case Contact");
  const loc = labeled(raw, b, "Customer Location");
  const prio = labeled(raw, b, "Case Priority");
  const status = labeled(raw, b, "Case Status");
  const comment = block(raw, b, "Case Comment", /^Case Number:/m);
  const desc = block(raw, b, "Call Description");

  const sm = DEMATIC_SUBJECT.exec(e.subject);
  let site: Parsed["site"] = null;
  if (sm) {
    const idSpan = find(raw, sm[1], h.subjectSpan.start);
    const s = siteByCustomerId(sm[1]);
    if (s) {
      const confirmed = loc && siteByText(loc.value)?.key === s.key;
      site = {
        site: s,
        spans: [idSpan, confirmed ? loc!.span : null].filter(Boolean) as Span[],
        method: confirmed ? "label" : "subject",
        path: "dematic_customer_id",
        identifier: sm[1],
        source: confirmed
          ? `Customer ID ${sm[1]} in the subject, matched in the site master and confirmed by the Customer Location label`
          : `Customer ID ${sm[1]} in the subject, matched in the site master`,
      };
    }
  }

  return {
    cols: {
      "CaseNumber/TicketID": fromHit("label", caseNo, "Labeled line Case Number:"),
      "CaseComment/TicketType": fromHit("label", comment, "Case Comment: block, up to Case Number:", true),
      ReportedOnDate: NOT_SENT("Dematic's case update carries no reported-on date"),
      AB_ReferenceNumber: NOT_SENT("Dematic does not send a customer reference number"),
      CaseSubject: fromHit("label", subj, "Labeled line Case Subject:"),
      AB_CaseContact: fromHit("label", contact, "Labeled line Case Contact:"),
      AB_ServiceTechnician: NOT_SENT("Dematic does not name a service technician"),
      IssueDescription: fromHit("label", desc, "Call Description: block", true),
    },
    priorityRaw: prio ? { value: prio.value, span: prio.span, method: "label", source: "Labeled line Case Priority: (a bare number)" } : null,
    statusRaw: status ? { value: status.value, span: status.span, method: "label", source: "Labeled line Case Status:" } : null,
    site,
    contact: { name: contact?.value ?? null, phone: null, email: null },
  };
}

/** Synonyms the fallback extractor tries when a known layout is not matched. */
const FALLBACK_LABELS: Record<string, string[]> = {
  case: ["Reference", "Case", "Ticket"],
  subject: ["Summary", "Subject", "Title"],
  contact: ["Reported by", "Contact", "Requester"],
  location: ["Facility", "Site", "Location"],
  priority: ["Severity", "Priority", "Prio"],
  status: ["Workflow state", "State", "Status"],
  description: ["Notes", "Description", "Details"],
};

function firstLabel(raw: string, from: number, labels: string[]) {
  for (const l of labels) {
    const h = labeled(raw, from, l);
    if (h && h.value) return { hit: h, label: l };
  }
  return null;
}

function parseFallback(raw: string, h: Header): Parsed {
  const b = h.bodyStart;
  const got = (k: string) => firstLabel(raw, b, FALLBACK_LABELS[k]);
  const caseNo = got("case");
  const subj = got("subject");
  const contact = got("contact");
  const loc = got("location");
  const prio = got("priority");
  const status = got("status");
  let desc: Hit | null = null;
  for (const l of FALLBACK_LABELS.description) {
    desc = block(raw, b, l);
    if (desc) break;
  }
  const via = (x: { label: string } | null, col: string) => (x ? `Fallback: label "${x.label}:" taken as ${col}` : "");
  const fb = (x: { hit: Hit; label: string } | null, col: string): Field => (x ? F("fallback", x.hit.value, via(x, col), [x.hit.span]) : NOT_SENT("Not found by the fallback extractor"));
  const site = loc ? siteByText(loc.hit.value) : null;
  return {
    cols: {
      "CaseNumber/TicketID": fb(caseNo, "Case Number"),
      "CaseComment/TicketType": NOT_SENT("No Case Comment block in this layout"),
      ReportedOnDate: NOT_SENT("Dematic's case update carries no reported-on date"),
      AB_ReferenceNumber: NOT_SENT("Dematic does not send a customer reference number"),
      CaseSubject: fb(subj, "Case Subject"),
      AB_CaseContact: fb(contact, "Case Contact"),
      AB_ServiceTechnician: NOT_SENT("Dematic does not name a service technician"),
      IssueDescription: desc ? F("fallback", tidy(desc.value), 'Fallback: block "Notes:" taken as Call Description', [desc.span]) : NOT_SENT(),
    },
    priorityRaw: prio ? { value: prio.hit.value, span: prio.hit.span, method: "fallback", source: via(prio, "Case Priority") } : null,
    statusRaw: status ? { value: status.hit.value, span: status.hit.span, method: "fallback", source: via(status, "Case Status") } : null,
    site:
      site && loc
        ? {
            site,
            spans: [loc.hit.span],
            method: "fallback",
            path: "fallback_text",
            identifier: loc.hit.value,
            source: `Fallback: "${loc.label}:" text matched to the site master by city and state`,
          }
        : null,
    contact: { name: contact?.hit.value ?? null, phone: null, email: null },
  };
}

function parseKnappTicket(raw: string, h: Header, e: SeedEmail): Parsed {
  const b = h.bodyStart;
  const summary = raw.indexOf("TICKET SUMMARY", b);
  const from = summary >= 0 ? summary : b;
  const id = labeled(raw, from, "KNAPP Ticket ID");
  const type = labeled(raw, from, "Ticket Type");
  const reported = labeled(raw, from, "Reported On");
  const ref = labeled(raw, from, "Your Reference Number");
  const desc = labeled(raw, from, "Issue Description");
  const acct = labeled(raw, from, "Customer Account");
  const by = labeled(raw, from, "Issue Reported By");
  const phone = labeled(raw, from, "Phone Number");
  const mail = labeled(raw, from, "Mail Address");
  const tech = labeled(raw, from, "Service Technician (if applicable)");
  const prio = labeled(raw, from, "Priority");

  // Second priority line: (Customer: 1 - Immediate / KNAPP: 2 - Urgent)
  let knapp: Parsed["knapp"] = null;
  const pm = /\(Customer:\s*((\d)\s*-\s*[^/]+?)\s*\/\s*KNAPP:\s*((\d)\s*-\s*[^)]+?)\s*\)/.exec(raw.slice(from));
  let pairSpans: Span[] = [];
  if (pm && prio) {
    const at = from + pm.index;
    const c = at + pm[0].indexOf(pm[1]);
    const k = at + pm[0].lastIndexOf(pm[3]);
    pairSpans = [
      { start: c, end: c + pm[1].length },
      { start: k, end: k + pm[3].length },
    ];
    knapp = { customerRank: Number(pm[2]), customerRaw: pm[1], vendorRank: Number(pm[4]), vendorRaw: pm[3], headline: prio.value };
  }

  const sm = KNAPP_SUBJECT.exec(e.subject);
  const phoneClean = phone?.value.replace(/\s*\/\s*$/, "") ?? null;
  const reportedIso = reported ? europeanToIso(reported.value) : null;

  const site = acct && acct.value ? siteByAccount(acct.value) : null;
  return {
    cols: {
      "CaseNumber/TicketID": fromHit("label", id, "Tab-separated pair KNAPP Ticket ID: under TICKET SUMMARY"),
      "CaseComment/TicketType": fromHit("label", type, "Tab-separated pair Ticket Type:"),
      ReportedOnDate:
        reported && reportedIso
          ? F("label", reportedIso, "Tab-separated pair Reported On:, European dd.mm.yyyy in UTC, reordered", [reported.span], reported.value)
          : NOT_SENT(),
      AB_ReferenceNumber: fromHit("label", ref, "Tab-separated pair Your Reference Number:"),
      CaseSubject: NOT_SENT("KNAPP notifications carry no case subject"),
      AB_CaseContact: by
        ? F("label", by.value, "Issue Reported By: block, split into name, phone and email", [by.span, phone && phoneClean ? { start: phone.span.start, end: phone.span.start + phoneClean.length } : null, mail?.span])
        : NOT_SENT(),
      AB_ServiceTechnician: fromHit("label", tech, "Tab-separated pair Service Technician (if applicable):"),
      IssueDescription: fromHit("label", desc, "Tab-separated pair Issue Description:"),
    },
    priorityRaw: prio ? { value: prio.value, span: prio.span, method: "label", source: "Tab-separated pair Priority: and the (Customer / KNAPP) line under it" } : null,
    knapp,
    statusRaw: sm
      ? { value: sm[3], span: find(raw, sm[3], h.subjectSpan.start), method: "subject", source: "Status token in the subject line (KNAPP sends no status field)" }
      : null,
    site:
      site && acct
        ? { site, spans: [acct.span], method: "label", path: "knapp_account", identifier: acct.value, source: `Customer Account ${acct.value}, matched in the site master` }
        : null,
    contact: { name: by?.value ?? null, phone: phoneClean || null, email: mail?.value || null },
    pairSpans,
  };
}

function parseKnappRfc(raw: string, h: Header, e: SeedEmail): Parsed {
  const m = RFC_SUBJECT.exec(e.subject)!;
  const s = h.subjectSpan.start;
  const acctSpan = { start: s, end: s + m[1].length };
  const rfcSpan = find(raw, `RfC${m[2]}`, s);
  const dateSpan = find(raw, m[3], s);
  const kwSpan = find(raw, m[4], s);
  // The keyword part names the customer first; the issue follows it.
  const keyword = m[4].replace(/^(ABC )?(AMERISOURCE ?BERGEN|CENCORA)_?/i, "").trim();
  const kwStart = kwSpan ? kwSpan.start + m[4].indexOf(keyword) : null;
  const site = siteByAccount(m[1]);
  return {
    cols: {
      "CaseNumber/TicketID": F("subject", `RfC${m[2]}`, "RfC number in the subject line", [rfcSpan]),
      "CaseComment/TicketType": F("subject", "Request for Change", "RfC marker in the subject line", [rfcSpan]),
      ReportedOnDate: F("subject", m[3], "Creation date in the subject line", [dateSpan]),
      AB_ReferenceNumber: NOT_SENT("The RfC notice carries no customer reference"),
      CaseSubject: F("subject", keyword, "Keyword segment of the subject line", [kwStart != null ? { start: kwStart, end: kwStart + keyword.length } : null]),
      AB_CaseContact: NOT_SENT("The RfC notice names no Cencora contact"),
      AB_ServiceTechnician: NOT_SENT("The RfC notice names no technician"),
      IssueDescription: NOT_SENT("The description is inside the PDF (Phase 2)"),
    },
    priorityRaw: null,
    statusRaw: null,
    site: site
      ? { site, spans: [acctSpan], method: "subject", path: "knapp_account", identifier: m[1], source: `Project number ${m[1]} in the subject line, matched in the site master` }
      : null,
    contact: { name: null, phone: null, email: null },
  };
}

function parseSchaefer(raw: string, h: Header, e: SeedEmail): Parsed {
  const b = h.bodyStart;
  const id = labeled(raw, b, "Ticket-ID");
  const contact = labeled(raw, b, "Contact");
  const prio = labeled(raw, b, "Prio");
  const desc = labeled(raw, b, "Description");
  // Subject: "A new Case was submitted (01278974)" or "Case 01290119 has been updated"
  const phrase = e.subject.replace(/\s*\(?\b\d{6,}\b\)?/, "").replace(/\s+/g, " ").trim();
  const mb = mailboxSite(raw, h.toSpan);
  return {
    cols: {
      "CaseNumber/TicketID": fromHit("label", id, "Labeled line Ticket-ID:"),
      "CaseComment/TicketType": NOT_SENT("SSI Schaefer sends five fields only"),
      ReportedOnDate: NOT_SENT("SSI Schaefer sends five fields only"),
      AB_ReferenceNumber: NOT_SENT("SSI Schaefer sends five fields only"),
      CaseSubject: NOT_SENT("SSI Schaefer sends five fields only"),
      AB_CaseContact: fromHit("label", contact, "Labeled line Contact:"),
      AB_ServiceTechnician: NOT_SENT("SSI Schaefer sends five fields only"),
      IssueDescription: fromHit("label", desc, "Labeled line Description:"),
    },
    priorityRaw: prio ? { value: prio.value, span: prio.span, method: "label", source: "Labeled line Prio: (a letter)" } : null,
    statusRaw: { value: phrase, span: h.subjectSpan, method: "subject", source: "Derived from the subject line (SSI Schaefer sends no status)" },
    site: mb
      ? {
          site: mb.site,
          spans: [mb.span],
          method: "mailbox",
          path: "mailbox",
          identifier: mb.site.mailbox,
          source: `No site in the message. Resolved from recipient mailbox ${mb.site.mailbox} against the site master`,
        }
      : null,
    contact: { name: contact?.value ?? null, phone: null, email: null },
  };
}

function parseReply(raw: string, h: Header, e: SeedEmail, vendor: VendorKey): Parsed {
  const b = h.bodyStart;
  const s = h.subjectSpan.start;
  // The reply text runs to the sign-off or the quoted original.
  const reply = preamble(raw, b, /^(Thanks,|Best regards|From: )/m);
  const cols: Parsed["cols"] = {
    "CaseComment/TicketType": reply ? F("label", tidy(reply.value), "Reply text above the sign-off", [reply.span]) : NOT_SENT(),
    ReportedOnDate: NOT_SENT("Not carried on a reply"),
    AB_ReferenceNumber: NOT_SENT("Not carried on a reply"),
    AB_CaseContact: NOT_SENT("Not carried on a reply"),
    AB_ServiceTechnician: NOT_SENT("Not carried on a reply"),
    IssueDescription: NOT_SENT("Not carried on a reply"),
  };
  let site: Parsed["site"] = null;
  let priorityRaw: Parsed["priorityRaw"] = null;
  let contact: Parsed["contact"] = { name: null, phone: null, email: null };

  if (vendor === "dematic") {
    const m = DEMATIC_SUBJECT.exec(e.subject)!;
    cols["CaseNumber/TicketID"] = F("subject", m[3], "Ticket number in the quoted subject line", [find(raw, m[3], s)]);
    cols.CaseSubject = F("subject", m[2], "Site: segment of the subject line", [find(raw, m[2], s)]);
    const st = siteByCustomerId(m[1]);
    if (st) site = { site: st, spans: [find(raw, m[1], s)!], method: "subject", path: "dematic_customer_id", identifier: m[1], source: `Customer ID ${m[1]} in the subject, matched in the site master` };
    // The quoted Dematic new-case notice keeps its labels.
    const q = raw.indexOf("Dematic Technical Support", b);
    if (q >= 0) {
      const cc = labeledLoose(raw, q, "Customer Contact");
      const created = labeledLoose(raw, q, "Created By");
      const pr = labeledLoose(raw, q, "Priority");
      const desc = block(raw, q, "Call Description", /\n[ \t]*\n[ \t]*\n/);
      if (cc) {
        cols.AB_CaseContact = F("label", cc.value, "Customer Contact: in the quoted Dematic notice", [cc.span]);
        contact = { name: cc.value, phone: null, email: null };
      }
      const iso = created ? usToIso(created.value) : null;
      if (created && iso) cols.ReportedOnDate = F("label", iso, "Created By: in the quoted Dematic notice, US date reordered", [created.span], created.value);
      if (desc) cols.IssueDescription = F("label", tidy(desc.value), "Call Description: in the quoted Dematic notice", [desc.span]);
      if (pr) priorityRaw = { value: pr.value, span: pr.span, method: "label", source: "Priority: in the quoted Dematic notice" };
    }
  } else {
    const m = KNAPP_REPLY_SUBJECT.exec(e.subject)!;
    cols["CaseNumber/TicketID"] = F("subject", m[1], "Ticket reference in the subject line", [find(raw, m[1], s)]);
    cols.CaseSubject = F("subject", m[3].replace(/\s+/g, " ").trim(), "Subject text after the account code", [find(raw, m[3], s)]);
    const st = siteByAccount(m[2]);
    if (st) site = { site: st, spans: [find(raw, m[2], s)!], method: "subject", path: "knapp_account", identifier: m[2], source: `Account ${m[2]} in the subject, matched in the site master` };
  }
  return { cols, priorityRaw, statusRaw: null, site, contact };
}

// ---------------------------------------------------------------------------
// The pipeline for one message

export function extract(e: SeedEmail, opts: ExtractOptions = {}): Extraction {
  const h = assemble(e);
  const raw = h.raw;
  const cls = classify(e);

  const base: Record<string, Field> = {};
  for (const c of COLUMNS) base[c] = NOT_SENT();

  const mailbox = mailboxSite(raw, h.toSpan);
  const fileName = `${compactStamp(e.received)}_${mailbox?.site.mailbox ?? "unrouted"}_${e.id}.eml`;
  const created = isoPlusMinutes(e.received, 2);

  base["EmailReceivedTimestamp"] = F("header", e.received, "Received header", [h.receivedSpan]);
  base["EmailFrom address"] = F("header", e.from_email, "From header", [h.fromSpan]);
  base["EmailToAddress"] = F("header", e.to, "To header", [h.toSpan]);
  base["EmailSubjectLine"] = F("header", e.subject, "Subject header", [h.subjectSpan]);
  base["EmailFilename"] = F("generated", fileName, "Generated: received time, mailbox and message id", []);
  base["CreatedTimestamp"] = F("generated", created, "Generated: row created at the mailbox poll after receipt", []);
  base["Attachment(Y/N)"] = F("header", e.has_attachment ? "Y" : "N", "MIME structure of the message", h.attachmentSpan ? [h.attachmentSpan] : []);
  base["AttachmentFilename"] = e.attachment
    ? F("header", e.attachment.filename, "MIME attachment part", [h.attachmentSpan])
    : NOT_SENT("No attachment on this message");

  const result: Extraction = {
    id: e.id,
    email: e,
    raw,
    vendor: cls.vendor,
    template: cls.template,
    isReply: cls.isReply,
    outcome: "loaded",
    failStage: null,
    failureType: null,
    reason: null,
    detail: null,
    reprocessed: false,
    fields: base,
    norm: {
      siteKey: null,
      sitePath: null,
      siteIdentifier: null,
      priorityRank: null,
      priorityLabel: null,
      statusLabel: null,
      statusRaw: null,
      knapp: null,
      contact: { name: null, phone: null, email: null },
    },
  };

  // Classify
  if (!cls.vendor) {
    return {
      ...result,
      outcome: "rejected",
      failStage: "Classify",
      failureType: "Incoming email rejection",
      reason: "Incoming email rejection",
      detail: `${cls.reject} Stored in the lake as received and excluded from the table.`,
    };
  }
  base["Vendor"] = F("header", VENDOR_LABEL[cls.vendor], cls.isReply ? "Vendor named by the thread reference in the subject" : `Sender domain ${e.from_email.split("@")[1]}`, [h.fromSpan]);

  // Extract
  let p: Parsed;
  let drifted = false;
  if (cls.isReply) p = parseReply(raw, h, e, cls.vendor);
  else if (cls.vendor === "dematic") {
    if (cls.template === "Dematic case update") p = parseDematic(raw, h, e);
    else {
      drifted = true;
      p = parseFallback(raw, h);
    }
  } else if (cls.vendor === "knapp") p = cls.template.includes("Request for Change") ? parseKnappRfc(raw, h, e) : parseKnappTicket(raw, h, e);
  else p = parseSchaefer(raw, h, e);

  const pre =
    cls.vendor === "dematic" && !drifted && !cls.isReply
      ? preamble(raw, h.bodyStart, /^Case Comment:/m)
      : cls.vendor === "knapp" && !cls.isReply
        ? preamble(raw, h.bodyStart, cls.template.includes("Request") ? /^(Mit freundlichen|Best regards)/m : /^TICKET SUMMARY/m)
        : cls.vendor === "schaefer"
          ? preamble(raw, h.bodyStart, /^Ticket-ID:/m)
          : drifted
            ? preamble(raw, h.bodyStart, /^[A-Z][A-Za-z ]+:/m)
            : preamble(raw, h.bodyStart, /\n[ \t]*\n/);
  base["EmailPreamble"] = cls.isReply
    ? NOT_SENT("A reply has no vendor preamble; its text is in CaseComment/TicketType")
    : pre ? F(drifted ? "fallback" : "label", tidy(pre.value), "Text between the gateway banner and the first field", [pre.span]) : NOT_SENT();

  for (const [k, v] of Object.entries(p.cols)) if (v) base[k] = v;
  result.norm.contact = p.contact;

  // Normalize: priority
  if (p.priorityRaw) {
    let rule: PriorityRule | null = null;
    let rawShown = p.priorityRaw.value;
    if (cls.vendor === "knapp" && p.knapp) {
      result.norm.knapp = p.knapp;
      const rank = opts.knappBasis === "knapp" ? p.knapp.vendorRank : p.knapp.customerRank;
      rule = priorityFor("knapp", String(rank));
      rawShown = `${p.knapp.headline} (Customer: ${p.knapp.customerRaw} / KNAPP: ${p.knapp.vendorRaw})`;
    } else if (drifted) {
      const m = /(\d)/.exec(p.priorityRaw.value);
      const rank = m ? Number(m[1]) : null;
      rule = rank && P_LABEL.has(rank) ? { rank, label: P_LABEL.get(rank)! } : null;
    } else {
      rule = priorityFor(cls.vendor, p.priorityRaw.value);
    }
    if (rule) {
      result.norm.priorityRank = rule.rank;
      result.norm.priorityLabel = rule.label;
      const spans = [p.priorityRaw.span, ...(p.pairSpans ?? [])];
      base["CasePriority"] = F(p.priorityRaw.method, rule.label, `${p.priorityRaw.source}, mapped with priority_map`, spans, rawShown);
    }
  } else {
    base["CasePriority"] = NOT_SENT(cls.isReply ? "Not carried on this reply" : "This vendor's template has no priority");
  }

  // Normalize: status
  if (p.statusRaw) {
    let label: string | null = statusFor(cls.vendor, p.statusRaw.value);
    if (!label && drifted) label = STATUS_ORDER.find((s) => s.toLowerCase() === p.statusRaw!.value.toLowerCase()) ?? null;
    result.norm.statusRaw = p.statusRaw.value;
    if (label) {
      result.norm.statusLabel = label;
      base["CaseStatus"] = F(p.statusRaw.method, label, `${p.statusRaw.source}, mapped with status_map`, [p.statusRaw.span], p.statusRaw.value);
    }
  } else {
    base["CaseStatus"] = NOT_SENT(cls.isReply ? "Not carried on this reply" : "This vendor's template has no status");
  }

  // Normalize: site
  if (p.site) {
    result.norm.siteKey = p.site.site.key;
    result.norm.sitePath = p.site.path;
    result.norm.siteIdentifier = p.site.identifier;
    base["AB_Location"] = F(p.site.method, `${p.site.site.city}, ${p.site.site.state}`, p.site.source, p.site.spans, p.site.site.key);
  }

  // Failure checks, in pipeline order
  if (drifted && !opts.acceptFallback) {
    return {
      ...result,
      outcome: "held",
      failStage: "Extract",
      failureType: "Text parsing error",
      reason: "Text parsing error",
      detail:
        "Known Dematic layout not matched: labels Case Number, Case Priority and Case Status were not found. The fallback extractor recovered the fields at reduced confidence, so the row is held for review instead of loaded.",
    };
  }
  if (e.attachment?.corrupt) {
    return {
      ...result,
      outcome: "held",
      failStage: "Extract",
      failureType: "Attachment extraction failure",
      reason: "Attachment extraction failure",
      detail: `${e.attachment.filename} has no extractable text layer. The message and the file are stored unchanged and queued for review.`,
    };
  }
  if (drifted) {
    result.reprocessed = true;
    result.detail = "Reprocessed. Fallback field mapping accepted; values carry 0.55 confidence.";
  }
  return result;
}

/** A display value for a field, never blank or zero for a missing field. */
export function displayValue(f: Field) {
  if (f.value === null) return "not sent by vendor";
  if (f.value === "") return "label sent, no value";
  return f.value;
}

export const COLUMN_KIND: Record<string, "E" | "D" | "G"> = {
  Vendor: "D",
  EmailReceivedTimestamp: "E",
  "EmailFrom address": "E",
  EmailToAddress: "E",
  EmailSubjectLine: "E",
  EmailPreamble: "E",
  "CaseNumber/TicketID": "E",
  "CaseComment/TicketType": "E",
  ReportedOnDate: "E",
  AB_ReferenceNumber: "E",
  CaseSubject: "E",
  AB_CaseContact: "E",
  AB_Location: "D",
  AB_ServiceTechnician: "E",
  CasePriority: "D",
  CaseStatus: "D",
  IssueDescription: "E",
  EmailFilename: "G",
  CreatedTimestamp: "G",
  "Attachment(Y/N)": "E",
  AttachmentFilename: "E",
};

export const KIND_LABEL = { E: "Extracted", D: "Derived", G: "Processing-generated" } as const;
