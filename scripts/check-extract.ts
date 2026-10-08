// Prints every extraction so the parser can be checked against the corpus.
import { extract, displayValue } from "../lib/extract";
import { buildTickets, runAll, summarize } from "../lib/pipeline";
import { COLUMNS, EMAILS } from "../lib/seed";

const only = process.argv[2];
for (const e of EMAILS) {
  if (only && !e.id.startsWith(only)) continue;
  const x = extract(e);
  console.log(`\n== ${x.id} [${x.template}] ${x.outcome}${x.reason ? " - " + x.reason : ""}`);
  for (const c of COLUMNS) {
    const f = x.fields[c];
    const spanText = f.spans.map((s) => JSON.stringify(x.raw.slice(s.start, s.end).slice(0, 40))).join(" + ");
    console.log(`  ${c.padEnd(24)} ${String(f.confidence).padEnd(5)} ${displayValue(f).slice(0, 70).padEnd(70)} ${f.raw ? "(raw " + f.raw + ")" : ""} ${spanText}`);
  }
}
const all = runAll();
console.log("\n", summarize(all));
console.log("accepted:", summarize(runAll({ accepted: { "SYN-9001": true } })));
for (const t of buildTickets(all)) console.log(t.vendor.padEnd(9), t.ticketId.padEnd(9), (t.siteKey ?? "-").padEnd(4), t.category.padEnd(24), t.events.map((e) => e.status ?? "·").join(" > "), "| ttr", t.timeToResolveMs && t.timeToResolveMs / 3600000, "|", t.subject.slice(0, 50));
