import { AASU_CODE_PREFIX, EVENT_ID, SCHOOLS, SchoolConfig, SchoolKey } from "./config";

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
  quantity_total: number;
  quantity_sold: number;
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

function schoolForTicket(tc: TicketClass, tiersById: Map<string, InventoryTier>): SchoolConfig | undefined {
  const tier = tc.inventory_tier_id ? tiersById.get(tc.inventory_tier_id) : undefined;
  if (tier) {
    const s = SCHOOLS.find((s) => tier.name.includes(s.sectionMatch));
    if (s) return s;
  }
  return SCHOOLS.find((s) => tc.name.startsWith(s.ticketMatch));
}

export async function fetchStats(): Promise<Stats> {
  const notes: string[] = [];

  const [ticketClasses, tiers, attendees] = await Promise.all([
    getAll<TicketClass>(`/events/${EVENT_ID}/ticket_classes/`, "ticket_classes"),
    getAll<InventoryTier>(`/events/${EVENT_ID}/inventory_tiers/`, "inventory_tiers").catch((e) => {
      notes.push(`Sections unavailable (${String(e.message).slice(0, 80)}); using contracted allocations.`);
      return [] as InventoryTier[];
    }),
    getAll<Attendee>(`/events/${EVENT_ID}/attendees/`, "attendees", { status: "attending" }),
  ]);

  const tiersById = new Map(tiers.map((t) => [t.id, t]));
  const ticketToSchool = new Map<string, SchoolConfig>();
  for (const tc of ticketClasses) {
    const s = schoolForTicket(tc, tiersById);
    if (s) ticketToSchool.set(tc.id, s);
    else notes.push(`Unmapped ticket type: ${tc.name}`);
  }

  // Per-school accumulators
  const acc = new Map<SchoolKey, SchoolStat>();
  for (const s of SCHOOLS) {
    const tier = tiers.find((t) => t.name.includes(s.sectionMatch));
    const allocation = tier?.quantity_total ?? s.allocation;
    acc.set(s.key, {
      key: s.key,
      name: s.name,
      allocation,
      sold: 0,
      sortedTiers: ticketClasses
        .filter((tc) => ticketToSchool.get(tc.id)?.key === s.key)
        .map((tc) => ({ name: tc.name.replace(/^.*?:\s*/, ""), sold: 0, total: tc.quantity_total, price: cents(tc.cost) / 100 })),
      publicSold: 0,
      aasuSold: 0,
      aasuHold: s.aasuHold,
      aasuRemaining: 0,
      publicCapacity: Math.max(0, allocation - s.aasuHold),
      publicRemaining: 0,
      totalRemaining: 0,
      baseRevenue: 0,
      grossRevenue: 0,
      feesCollected: 0,
    });
  }

  // Walk attendees (one per ticket). Refunded/cancelled are excluded by status=attending,
  // but we double-check in case the filter is loosened later.
  for (const a of attendees) {
    if (a.cancelled || a.refunded) continue;
    const school = ticketToSchool.get(a.ticket_class_id);
    if (!school) continue;
    const st = acc.get(school.key)!;
    st.sold += 1;
    const code = a.promotional_code?.code ?? "";
    if (code.toUpperCase().startsWith(AASU_CODE_PREFIX)) st.aasuSold += 1;
    else st.publicSold += 1;
    const base = cents(a.costs?.base_price);
    const gross = cents(a.costs?.gross);
    st.baseRevenue += base / 100;
    st.grossRevenue += gross / 100;
    st.feesCollected += (cents(a.costs?.eventbrite_fee) + cents(a.costs?.payment_fee)) / 100;
    const tierName = a.ticket_class_name.replace(/^.*?:\s*/, "");
    const t = st.sortedTiers.find((x) => x.name === tierName);
    if (t) t.sold += 1;
  }

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
