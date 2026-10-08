// Shapes of data/cencora-demo-seed.json, as described in the build brief.
// Confirm against the real file once it is committed.

export type Vendor = "Dematic" | "KNAPP" | "SSI Schaefer";

export interface SeedEmail {
  id: string;
  vendor: string;
  received: string;
  from_name: string;
  from_email: string;
  to: string;
  subject: string;
  body: string;
  has_attachment: boolean;
  attachment: unknown;
  source: "rfi" | "synthesized";
  source_note: string;
  expect?: { outcome: "held" | "rejected"; reason?: string; [k: string]: unknown };
}

export interface Site {
  key: string;
  city: string;
  state: string;
  mailbox: string;
  dematic_customer_id: string | number | null;
  knapp_account: string | null;
}

export interface Ticket {
  ticket_id: string;
  vendor: string;
  site: string;
  subject: string;
}

export type Confidence = 1.0 | 0.9 | 0.75 | 0.55 | null;

export interface ExtractedField {
  column: string;
  value: string | null;
  confidence: Confidence;
  /** Character range in the raw message (subject + body) the value came from. */
  span?: { part: "subject" | "body" | "to"; start: number; end: number };
}
