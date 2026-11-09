import { AASU_CODE_PREFIX, AASU_DISPLAY_RE, EVENT_ID, HOLD_LABELS, WAVE_PREFIX_RE, SCHOOLS, SchoolConfig, SchoolKey } from "./config";

const API = "https://www.eventbriteapi.com/v3";

function token(): string {
  const t = process.env.EVENTBRITE_TOKEN;
  if (!t) throw new Error("EVENTBRITE_TOKEN is not set");
  return t;
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token()}` },
    // Vercel data cache: re-fetch at most once a minute.
    next: { revalidate: 60 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Eventbrite ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

/** Walk Eventbrite's continuation-based pagination and concatenate `key`. */
async function getAll<T>(path: string, key: string, params: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = [];
  let continuation: string | undefined;
  for (let i = 0; i < 200; i++) {
    const page = await get<any>(path, continuation ? { ...params, continuation } : params);
    out.push(...(page[key] ?? []));
    if (page.pagination?.has_more_items && page.pagination?.continuation) {
      continuation = page.pagination.continuation;
    } else break;
  }
  return out;
}

// ---- Eventbrite shapes (only the fields we read) ----

interface Money { value: number; major_value: string; currency: string }

interface TicketClass {
  id: string;
  name: string;
  display_name?: string;
  quantity_total: number;
  quantity_sold: number;
  /** The tier's share of the school allocation, shared by its regular and AASU classes. */
  capacity?: number;
  cost: Money | null;
  fee: Money | null;
  inventory_tier_id?: string | null;
}

interface Hold {
  /** "I" + the inventory_tier_id its ticket classes point at. */
  id: string;
  name: string;
  quantity_total: number;
  quantity_sold: number;
}

interface InventoryTier {
  id: string;
  name: string;
  quantity_total: number;
  quantity_sold: number;
  holds?: Hold[];
}

interface Attendee {
  id: string;
  ticket_class_id: string;
  ticket_class_name: string;
  cancelled: boolean;
  refunded: boolean;
  status: string;
  promotional_code?: { code?: string } | null;
  costs?: {
    base_price?: Money;
    eventbrite_fee?: Money;
    payment_fee?: Money;
    tax?: Money;
    gross?: Money;
  };
}

// ---- Output shapes ----

export interface TierStat {
  name: string;
  sold: number;
  /** Portion of `sold` that came from AASU hold tickets. */
  aasuSold: number;
  total: number;
  price: number;
}

/** A non-AASU hold on a school's section, e.g. HBS SA leadership tickets. */
export interface HoldStat {
  name: string;
  label: string;
  hold: number;
  sold: number;
  remaining: number;
}

export interface SchoolStat {
  key: SchoolKey;
  name: string;
  allocation: number;
  sold: number;
  sortedTiers: TierStat[];
  /** Sold via the school's regular access code (non-AASU). */
  publicSold: number;
  /** Sold via the AASU hold code for this school. */
  aasuSold: number;
  aasuHold: number;
  aasuRemaining: number;
  /** Allocation minus the AASU hold and other holds. */
  publicCapacity: number;
  publicRemaining: number;
  otherHolds: HoldStat[];
  totalRemaining: number;
  /** Ticket face value (what the SA receives before any processing deductions). */
  baseRevenue: number;
  /** What buyers actually paid, including passed-through fees. */
  grossRevenue: number;
  feesCollected: number;
}

export interface Stats {
  eventId: string;
  generatedAt: string;
  schools: SchoolStat[];
  totals: {
    allocation: number;
    sold: number;
    publicSold: number;
    aasuSold: number;
    aasuHold: number;
    aasuRemaining: number;
    publicRemaining: number;
    otherHold: number;
    otherSold: number;
    totalRemaining: number;
    baseRevenue: number;
    grossRevenue: number;
    feesCollected: number;
  };
  notes: string[];
}

function cents(m?: Money | null): number {
  return m?.value ?? 0;
}

interface TicketMapping {
  school: SchoolConfig;
  /** public: the school's own ticket types; aasu: AASU hold; hold: any other hold on the section. */
  channel: "public" | "aasu" | "hold";
  /** Eventbrite name of the hold, for channel "hold". */
  holdName?: string;
  /** Tier label shared by every channel, e.g. "Food Only". */
  tierName: string;
}

interface HoldOwner {
  school: SchoolConfig;
  hold: Hold;
}

const isAasuHold = (name: string) => /^AASU\b/i.test(name.trim());

function mapTicket(tc: TicketClass, holdOwners: Map<string, HoldOwner>): TicketMapping | undefined {
  const display = tc.display_name ?? "";
  const tierName = tc.name.replace(AASU_DISPLAY_RE, "").replace(WAVE_PREFIX_RE, "").trim();
  const bySection = SCHOOLS.find((s) => tc.inventory_tier_id === s.sectionTierId);
  if (bySection) return { school: bySection, channel: "public", tierName };
  // Hold ticket classes point at the hold's own tier id; the section that owns the hold is the school.
  const owner = tc.inventory_tier_id ? holdOwners.get(tc.inventory_tier_id) : undefined;
  if (owner) {
    const aasu = isAasuHold(owner.hold.name);
    return { school: owner.school, channel: aasu ? "aasu" : "hold", holdName: aasu ? undefined : owner.hold.name, tierName };
  }
  const aasuKey = display.match(AASU_DISPLAY_RE)?.[1]?.toUpperCase();
  const byAasu = aasuKey ? SCHOOLS.find((s) => s.key === aasuKey) : undefined;
  if (byAasu) return { school: byAasu, channel: "aasu", tierName };
  // Tier id missing on the class: fall back to the section name prefix of display_name.
  const byName = SCHOOLS.find((s) => display.startsWith(s.sectionMatch));
  if (byName) return { school: byName, channel: "public", tierName };
  return undefined;
}

/** Raw ticket classes and sections, for checking mappings and caps (`/api/stats?debug=1`). */
export async function fetchDebug() {
  const [ticketClasses, tiers] = await Promise.all([
    getAll<any>(`/events/${EVENT_ID}/ticket_classes/`, "ticket_classes"),
    getAll<any>(`/events/${EVENT_ID}/inventory_tiers/`, "inventory_tiers"),
  ]);
  const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
  return {
    inventoryTiers: tiers,
    ticketClasses: ticketClasses.map((tc) =>
      pick(tc, ["id", "name", "display_name", "inventory_tier_id", "quantity_total", "quantity_sold", "capacity", "hidden", "on_sale_status", "cost"]),
    ),
  };
}

export async function fetchStats(): Promise<Stats> {
  const notes: string[] = [];

  let tiersFailed = false;
  const [ticketClasses, tiers, attendees] = await Promise.all([
    getAll<TicketClass>(`/events/${EVENT_ID}/ticket_classes/`, "ticket_classes"),
    getAll<InventoryTier>(`/events/${EVENT_ID}/inventory_tiers/`, "inventory_tiers").catch((e) => {
      tiersFailed = true;
      notes.push(`Sections unavailable (${String(e.message).slice(0, 80)}); using AASU_HOLDS fallback.`);
      return [] as InventoryTier[];
    }),
    getAll<Attendee>(`/events/${EVENT_ID}/attendees/`, "attendees", { status: "attending", expand: "promotional_code" }),
  ]);

  const tiersById = new Map(tiers.map((t) => [t.id, t]));
  const holdOwners = new Map<string, HoldOwner>();
  for (const s of SCHOOLS) {
    for (const hold of tiersById.get(s.sectionTierId)?.holds ?? []) holdOwners.set(hold.id.replace(/^I/, ""), { school: s, hold });
  }
  const ticketMap = new Map<string, TicketMapping>();
  for (const tc of ticketClasses) {
    const m = mapTicket(tc, holdOwners);
    if (m) ticketMap.set(tc.id, m);
    else notes.push(`Unmapped ticket type: ${tc.display_name ?? tc.name}`);
  }

  // Per-school accumulators
  const acc = new Map<SchoolKey, SchoolStat>();
  for (const s of SCHOOLS) {
    const allocation = s.allocation;
    const section = tiersById.get(s.sectionTierId);
    if (!section && !tiersFailed) notes.push(`Section ${s.sectionTierId} (${s.key}) not found; using AASU_HOLDS fallback.`);
    const sectionHolds = section?.holds ?? [];
    const aasuHold = section
      ? sectionHolds.filter((h) => isAasuHold(h.name)).reduce((n, h) => n + h.quantity_total, 0)
      : s.fallbackAasuHold;
    const otherHolds: HoldStat[] = sectionHolds
      .filter((h) => !isAasuHold(h.name))
      .map((h) => ({ name: h.name, label: HOLD_LABELS[h.name] ?? h.name, hold: h.quantity_total, sold: 0, remaining: 0 }));

    // One row per tier name, combining every channel (public, AASU, other holds, later waves).
    // Tier sizes come from config; a tier missing there falls back to its public classes' capacity.
    const sortedTiers: TierStat[] = Object.entries(s.tiers).map(([name, total]) => ({ name, sold: 0, aasuSold: 0, total, price: 0 }));
    for (const tc of ticketClasses) {
      const m = ticketMap.get(tc.id);
      if (m?.school.key !== s.key) continue;
      let row = sortedTiers.find((t) => t.name === m.tierName);
      if (!row) {
        row = { name: m.tierName, sold: 0, aasuSold: 0, total: 0, price: 0 };
        sortedTiers.push(row);
        notes.push(`${s.key} tier "${m.tierName}" has no allocation in config; using Eventbrite capacity.`);
      }
      if (m.channel === "public") {
        if (!(m.tierName in s.tiers)) row.total += tc.capacity ?? tc.quantity_total;
        if (!row.price) row.price = cents(tc.cost) / 100;
      }
    }

    const held = aasuHold + otherHolds.reduce((n, h) => n + h.hold, 0);
    acc.set(s.key, {
      key: s.key,
      name: s.name,
      allocation,
      sold: 0,
      sortedTiers,
      publicSold: 0,
      aasuSold: 0,
      aasuHold,
      aasuRemaining: 0,
      publicCapacity: Math.max(0, allocation - held),
      publicRemaining: 0,
      otherHolds,
      totalRemaining: 0,
      baseRevenue: 0,
      grossRevenue: 0,
      feesCollected: 0,
    });
  }

  // Walk attendees (one per ticket). Refunded/cancelled are excluded by status=attending,
  // but we double-check in case the filter is loosened later.
  // Cached continuation pages can overlap while sales are coming in; count each attendee once.
  const seen = new Set<string>();
  let dupes = 0;
  for (const a of attendees) {
    if (a.cancelled || a.refunded) continue;
    if (seen.has(a.id)) {
      dupes += 1;
      continue;
    }
    seen.add(a.id);
    const m = ticketMap.get(a.ticket_class_id);
    if (!m) continue;
    const st = acc.get(m.school.key)!;
    st.sold += 1;
    const code = a.promotional_code?.code ?? "";
    const isAasu = m.channel === "aasu" || (m.channel === "public" && code.toUpperCase().startsWith(AASU_CODE_PREFIX));
    const otherHold = m.channel === "hold" ? st.otherHolds.find((h) => h.name === m.holdName) : undefined;
    if (isAasu) st.aasuSold += 1;
    else if (otherHold) otherHold.sold += 1;
    else st.publicSold += 1;
    const base = cents(a.costs?.base_price);
    const gross = cents(a.costs?.gross);
    st.baseRevenue += base / 100;
    st.grossRevenue += gross / 100;
    st.feesCollected += (cents(a.costs?.eventbrite_fee) + cents(a.costs?.payment_fee)) / 100;
    const t = st.sortedTiers.find((x) => x.name === m.tierName);
    if (t) {
      t.sold += 1;
      if (isAasu) t.aasuSold += 1;
    }
  }
  if (dupes > 0) notes.push(`Skipped ${dupes} duplicate attendee records.`);

  const schools = SCHOOLS.map((s) => {
    const st = acc.get(s.key)!;
    st.aasuRemaining = Math.max(0, st.aasuHold - st.aasuSold);
    st.publicRemaining = Math.max(0, st.publicCapacity - st.publicSold);
    for (const h of st.otherHolds) h.remaining = Math.max(0, h.hold - h.sold);
    st.totalRemaining = Math.max(0, st.allocation - st.sold);
    return st;
  });

  const sum = (f: (s: SchoolStat) => number) => schools.reduce((n, s) => n + f(s), 0);
  const totals = {
    allocation: sum((s) => s.allocation),
    sold: sum((s) => s.sold),
    publicSold: sum((s) => s.publicSold),
    aasuSold: sum((s) => s.aasuSold),
    aasuHold: sum((s) => s.aasuHold),
    aasuRemaining: sum((s) => s.aasuRemaining),
    publicRemaining: sum((s) => s.publicRemaining),
    otherHold: sum((s) => s.otherHolds.reduce((n, h) => n + h.hold, 0)),
    otherSold: sum((s) => s.otherHolds.reduce((n, h) => n + h.sold, 0)),
    totalRemaining: sum((s) => s.totalRemaining),
    baseRevenue: sum((s) => s.baseRevenue),
    grossRevenue: sum((s) => s.grossRevenue),
    feesCollected: sum((s) => s.feesCollected),
  };

  return { eventId: EVENT_ID, generatedAt: new Date().toISOString(), schools, totals, notes };
}

/** Stats with every AASU field removed, for parties that don't see the AASU hold. */
export function withoutAasu(stats: Stats) {
  const { aasuSold, aasuHold, aasuRemaining, publicSold, publicRemaining, ...totals } = stats.totals;
  return {
    eventId: stats.eventId,
    generatedAt: stats.generatedAt,
    schools: stats.schools.map(
      ({ aasuSold, aasuHold, aasuRemaining, publicSold, publicCapacity, publicRemaining, sortedTiers, ...rest }) => ({
        ...rest,
        sortedTiers: sortedTiers.map(({ aasuSold, ...tier }) => tier),
      }),
    ),
    totals,
  };
}

/** Stats as the AASU party sees them: contracted AASU hold sizes where config sets one. */
export function forAasuParty(stats: Stats): Stats {
  const schools = stats.schools.map((st) => {
    const hold = SCHOOLS.find((s) => s.key === st.key)?.aasuHoldForAasu;
    return hold === undefined ? st : { ...st, aasuHold: hold, aasuRemaining: Math.max(0, hold - st.aasuSold) };
  });
  const totals = {
    ...stats.totals,
    aasuHold: schools.reduce((n, s) => n + s.aasuHold, 0),
    aasuRemaining: schools.reduce((n, s) => n + s.aasuRemaining, 0),
  };
  return { ...stats, schools, totals };
}
