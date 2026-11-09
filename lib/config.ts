// Event + school configuration. Everything here can be overridden by env vars
// so the deployed app can be retuned without a code change.

export type SchoolKey = "HBS" | "HLS" | "SOM" | "YLS";

export interface SchoolConfig {
  key: SchoolKey;
  name: string;
  /** Eventbrite inventory tier (section) id for this school's regular tickets. */
  sectionTierId: string;
  /** Section name; ticket display_names start with it (fallback if the tier id is missing). */
  sectionMatch: string;
  /** Contracted ticket allocation for the school. */
  allocation: number;
  /** AASU hold size used only if Eventbrite sections can't be read (normally read from them). */
  fallbackAasuHold: number;
  /** AASU hold shown to the AASU party instead of Eventbrite's (the contracted size). */
  aasuHoldForAasu?: number;
  /** Extra AASU sales per tier shown to the AASU party, for hold tickets moved to the public sale. */
  aasuSoldForAasu?: Record<string, number>;
  /**
   * Tickets allocated to each tier, after redistribution between schools. Eventbrite holds
   * don't respect ticket-type caps (HBS tiers oversold), so the per-tier sizes live here
   * rather than in Eventbrite's capacities, which were adjusted by hand to close tiers.
   */
  tiers: Record<string, number>;
  /** Access code name used by AASU for this school. */
  aasuCode: string;
}

export const EVENT_ID = process.env.EVENTBRITE_EVENT_ID ?? "2003945094723";

const DEFAULT_HOLDS: Record<SchoolKey, number> = { HBS: 140, HLS: 0, SOM: 40, YLS: 20 };

/** Fallback only: parse AASU_HOLDS="HBS=100,HLS=40,SOM=40,YLS=20" if present. */
function holdsFromEnv(): Record<SchoolKey, number> {
  const raw = process.env.AASU_HOLDS;
  if (!raw) return DEFAULT_HOLDS;
  const out = { ...DEFAULT_HOLDS };
  for (const part of raw.split(",")) {
    const [k, v] = part.split("=").map((s) => s.trim());
    if (k && v && k in out && !Number.isNaN(Number(v))) out[k as SchoolKey] = Number(v);
  }
  return out;
}

const holds = holdsFromEnv();

export const SCHOOLS: SchoolConfig[] = [
  // Contract 340/325/235, plus 4 Food Only + 10 2-drink from HLS and 5 2-drink from YLS, minus 19 open bar (14 to HLS, 5 to YLS).
  { key: "HBS", name: "Harvard Business School", sectionTierId: "141738248", sectionMatch: "Harvard Business School", allocation: 900, fallbackAasuHold: holds.HBS, aasuCode: "AASU_HBS_2026",
    tiers: { "Food Only": 344, "Food + 2 Drinks": 340, "Food + Open Bar": 216 } },
  // Contract 100/300/100, minus 4 Food Only and 10 2-drink to HBS, plus 14 VIP from HBS.
  { key: "HLS", name: "Harvard Law School", sectionTierId: "141738249", sectionMatch: "Harvard Law School", allocation: 500, fallbackAasuHold: holds.HLS, aasuCode: "AASU_HLS_2026",
    tiers: { "Food Only": 96, "Food + 2 Drinks": 290, VIP: 114 } },
  { key: "SOM", name: "Yale School of Management", sectionTierId: "141738250", sectionMatch: "Yale School of Management", allocation: 400, fallbackAasuHold: holds.SOM, aasuCode: "AASU_SOM_2026",
    tiers: { "Tailgate Ticket": 400 } },
  // Contract 60/75/65, minus 5 2-drink to HBS, plus 5 VIP from HBS. AASU sees its contracted hold of 20, with the 6 VIP moved to public counted as AASU sales.
  { key: "YLS", name: "Yale Law School", sectionTierId: "141738251", sectionMatch: "Yale Law School", allocation: 200, fallbackAasuHold: holds.YLS, aasuHoldForAasu: 20, aasuSoldForAasu: { VIP: 6 }, aasuCode: "AASU_YLS_2026",
    tiers: { "Food Only": 60, "Food + 2 Drinks": 70, VIP: 70 } },
];

export const AASU_CODE_PREFIX = "AASU_";

/** Display names for non-AASU holds on a school's section (anything else shows its Eventbrite name). */
export const HOLD_LABELS: Record<string, string> = {
  "HBS SA": "Leadership",
  YLS_INCL: "Inclusivity (paid by Yale)",
};

/** HLS's second release reuses the tier names behind this prefix, e.g. "2nd Wave - VIP". */
export const WAVE_PREFIX_RE = /^\s*2nd Wave\s*-\s*/i;

/** AASU hold ticket classes have display_names like "AASU - HBS Food Only". */
export const AASU_DISPLAY_RE = /^AASU\s*-\s*(HBS|HLS|SOM|YLS)\b\s*/i;
