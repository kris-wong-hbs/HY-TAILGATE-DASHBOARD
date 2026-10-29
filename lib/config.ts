// Event + school configuration. Everything here can be overridden by env vars
// so the deployed app can be retuned without a code change.

export type SchoolKey = "HBS" | "HLS" | "SOM" | "YLS";

export interface SchoolConfig {
  key: SchoolKey;
  name: string;
  /** Substring that identifies this school's Eventbrite section (inventory tier). */
  sectionMatch: string;
  /** Substring that identifies this school's ticket types by name (fallback if sections are unavailable). */
  ticketMatch: string;
  /** Contracted ticket allocation for the school (used if the section capacity can't be read). */
  allocation: number;
  /** Current AASU hold size for this school. */
  aasuHold: number;
  /** Access code name used by AASU for this school. */
  aasuCode: string;
}

export const EVENT_ID = process.env.EVENTBRITE_EVENT_ID ?? "2003945094723";

const DEFAULT_HOLDS: Record<SchoolKey, number> = { HBS: 100, HLS: 40, SOM: 40, YLS: 20 };

/** Parse AASU_HOLDS="HBS=100,HLS=40,SOM=40,YLS=20" if present. */
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
  { key: "HBS", name: "Harvard Business School", sectionMatch: "Harvard Business School", ticketMatch: "HBS:", allocation: 900, aasuHold: holds.HBS, aasuCode: "AASU_HBS_2026" },
  { key: "HLS", name: "Harvard Law School", sectionMatch: "Harvard Law School", ticketMatch: "HLS:", allocation: 500, aasuHold: holds.HLS, aasuCode: "AASU_HLS_2026" },
  { key: "SOM", name: "Yale School of Management", sectionMatch: "Yale School of Management", ticketMatch: "Yale SOM:", allocation: 400, aasuHold: holds.SOM, aasuCode: "AASU_SOM_2026" },
  { key: "YLS", name: "Yale Law School", sectionMatch: "Yale Law School", ticketMatch: "Yale Law School:", allocation: 200, aasuHold: holds.YLS, aasuCode: "AASU_YLS_2026" },
];

export const AASU_CODE_PREFIX = "AASU_";
