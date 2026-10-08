// Deterministic formatting. Everything is UTC and derived from the data,
// never from the viewer's clock or locale.

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

export function parseIso(iso: string) {
  return Date.parse(iso);
}

/** 2026-09-16T09:14:00Z -> "2026-09-16 09:14 UTC" */
export function fmtTs(iso: string | null | undefined, seconds = false) {
  if (!iso) return "";
  const d = new Date(iso);
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return seconds ? `${base}:${pad(d.getUTCSeconds())} UTC` : `${base} UTC`;
}

/** "16 Sep 09:14" */
export function fmtShort(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function fmtDay(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function isoPlusMinutes(iso: string, minutes: number) {
  return new Date(Date.parse(iso) + minutes * 60000).toISOString().replace(".000Z", "Z");
}

export function compactStamp(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/** Milliseconds -> "1d 4h", "6h 12m", "24m" */
export function fmtDuration(ms: number | null | undefined) {
  if (ms == null) return "";
  const mins = Math.round(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${m}m`;
}

export function hours(ms: number) {
  return Math.round((ms / 3600000) * 10) / 10;
}
