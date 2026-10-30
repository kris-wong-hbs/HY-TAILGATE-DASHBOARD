import { AASU_CODE_PREFIX, AASU_DISPLAY_RE, EVENT_ID, SCHOOLS, SchoolConfig, SchoolKey } from "./config";

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

interface InventoryTier {
  id: string;
  name: string;
  quantity_total: number;
  quantity_sold: number;
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
  publicCapacity: number;
  publicRemaining: number;
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
  /** True for AASU hold ticket classes (their own inventory tier, "AASU - <KEY> " display_name). */
  aasu: boolean;
  /** Tier label shared by regular and AASU classes, e.g. "Food Only". */
  tierName: string;
}

function mapTicket(tc: TicketClass): TicketMapping | undefined {
  const display = tc.display_name ?? "";
  const tierName = tc.name.replace(AASU_DISPLAY_RE, "").trim();
  const bySection = SCHOOLS.find((s) => tc.inventory_tier_id === s.sectionTierId);
  if (bySection) return { school: bySection, aasu: false, tierName };
  const aasuKey = display.match(AASU_DISPLAY_RE)?.[1]?.toUpperCase();
  const byAasu = aasuKey ? SCHOOLS.find((s) => s.key === aasuKey) : undefined;
  if (byAasu) return { school: byAasu, aasu: true, tierName };
  // Tier id missing on the class: fall back to the section name prefix of display_name.
  const byName = SCHOOLS.find((s) => display.startsWith(s.sectionMatch));
  if (byName) return { school: byName, aasu: false, tierName };
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
  const ticketMap = new Map<string, TicketMapping>();
  for (const tc of ticketClasses) {
    const m = mapTicket(tc);
    if (m) ticketMap.set(tc.id, m);
    else notes.push(`Unmapped ticket type: ${tc.display_name ?? tc.name}`);
  }

  // Per-school accumulators
  const acc = new Map<SchoolKey, SchoolStat>();
  for (const s of SCHOOLS) {
    const allocation = s.allocation;
    // The section's capacity is the allocation minus whatever AASU currently holds back.
    const section = tiersById.get(s.sectionTierId);
    let aasuHold = s.fallbackAasuHold;
    if (section) aasuHold = Math.max(0, allocation - section.quantity_total);
    else if (!tiersFailed) notes.push(`Section ${s.sectionTierId} (${s.key}) not found; using AASU_HOLDS fallback.`);

    // One row per tier name, combining regular and AASU classes. The tier's max is the
    // regular class's `capacity` (tiers add up to the allocation); AASU classes draw from
    // the same pool, so their caps aren't added. quantity_total excludes the AASU hold.
    const sortedTiers: TierStat[] = [];
    for (const tc of ticketClasses) {
      const m = ticketMap.get(tc.id);
      if (m?.school.key !== s.key) continue;
      const total = tc.capacity ?? tc.quantity_total;
      const row = sortedTiers.find((t) => t.name === m.tierName);
      if (!row) {
        sortedTiers.push({ name: m.tierName, sold: 0, aasuSold: 0, total, price: cents(tc.cost) / 100 });
      } else if (!m.aasu) {
        row.total = total;
        row.price = cents(tc.cost) / 100;
      }
    }

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
      publicCapacity: Math.max(0, allocation - aasuHold),
      publicRemaining: 0,
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
    const isAasu = m.aasu || code.toUpperCase().startsWith(AASU_CODE_PREFIX);
    if (isAasu) st.aasuSold += 1;
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
