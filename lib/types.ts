// Shapes of data/cencora-demo-seed.json.

export interface SeedAttachment {
  filename: string;
  doc_type: string;
  corrupt?: boolean;
}

export interface SeedExpect {
  outcome: "held" | "rejected";
  reason: string;
  detail: string;
}

export interface SeedEmail {
  id: string;
  source: "rfi" | "synthesized";
  source_note: string;
  vendor: string;
  received: string;
  from_name: string;
  from_email: string;
  to: string;
  subject: string;
  body: string;
  has_attachment: boolean;
  attachment: SeedAttachment | null;
  expect?: SeedExpect;
}

export interface Site {
  key: string;
  city: string;
  state: string;
  mailbox: string;
  dematic_customer_id: string;
  knapp_account: string;
}

export interface SeedTicket {
  ticket_id: string;
  vendor: "dematic" | "knapp" | "schaefer";
  site_key: string;
  subject: string;
}

export interface PriorityMapRow {
  normalized: string;
  rank: number;
  dematic: string;
  knapp: string;
  schaefer: string;
}

export interface StatusMapRow {
  normalized: string;
  dematic: string;
  knapp: string;
  schaefer: string;
}

export interface Seed {
  generated: string;
  emails: SeedEmail[];
  sites: Site[];
  tickets: SeedTicket[];
  priority_map: PriorityMapRow[];
  status_map: StatusMapRow[];
  target_columns: string[];
  attachment_example: { filename: string; doc_type: string; fields: Record<string, string> };
}
