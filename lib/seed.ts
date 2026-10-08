import raw from "@/data/cencora-demo-seed.json";
import type { Seed } from "./types";

export const SEED = raw as unknown as Seed;
export const EMAILS = SEED.emails;
export const SITES = SEED.sites;
export const COLUMNS: readonly string[] = SEED.target_columns;

export function siteByKey(key: string | null | undefined) {
  return SITES.find((s) => s.key === key) ?? null;
}

export function siteLabel(key: string | null | undefined) {
  const s = siteByKey(key);
  return s ? `${s.city}, ${s.state}` : "Unresolved";
}
