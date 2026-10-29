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
  /** AASU hold size used only if Eventbrite sections can't be read (normally derived from them). */
  fallbackAasuHold: number;
  /** Access code name used by AASU for this school. */
  aasuCode: string;
}

export const EVENT_ID = process.env.EVENTBRITE_EVENT_ID ?? "2003945094723";

const DEFAULT_HOLDS: Record<SchoolKey, number> = { HBS: 125, HLS: 15, SOM: 40, YLS: 20 };

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
  { key: "HBS", name: "Harvard Business School", sectionTierId: "141738248", sectionMatch: "Harvard Business School", allocation: 900, fallbackAasuHold: holds.HBS, aasuCode: "AASU_HBS_2026" },
  { key: "HLS", name: "Harvard Law School", sectionTierId: "141738249", sectionMatch: "Harvard Law School", allocation: 500, fallbackAasuHold: holds.HLS, aasuCode: "AASU_HLS_2026" },
  { key: "SOM", name: "Yale School of Management", sectionTierId: "141738250", sectionMatch: "Yale School of Management", allocation: 400, fallbackAasuHold: holds.SOM, aasuCode: "AASU_SOM_2026" },
  { key: "YLS", name: "Yale Law School", sectionTierId: "141738251", sectionMatch: "Yale Law School", allocation: 200, fallbackAasuHold: holds.YLS, aasuCode: "AASU_YLS_2026" },
];

export const AASU_CODE_PREFIX = "AASU_";

/** AASU hold ticket classes have display_names like "AASU - HBS Food Only". */
export const AASU_DISPLAY_RE = /^AASU\s*-\s*(HBS|HLS|SOM|YLS)\b\s*/i;
