import { fetchStats, SchoolStat } from "@/lib/eventbrite";

export const dynamic = "force-dynamic";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const num = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

function SchoolCard({ s }: { s: SchoolStat }) {
  const pubW = pct(s.publicSold, s.allocation);
  const aasuW = pct(s.aasuSold, s.allocation);
  return (
    <div className="card">
      <h2>{s.name}</h2>
      <div className="bar" aria-label={`${s.sold} of ${s.allocation} sold`}>
        <span className="pub" style={{ width: `${pubW}%` }} />
        <span className="aasu" style={{ width: `${aasuW}%` }} />
      </div>
      <div className="sub" style={{ marginBottom: 8 }}>
        {num(s.sold)} of {num(s.allocation)} sold ({pct(s.sold, s.allocation)}%)
      </div>
      <div className="row"><span className="k">Public sold</span><span className="v">{num(s.publicSold)} / {num(s.publicCapacity)}</span></div>
      <div className="row"><span className="k">Public remaining</span><span className="v">{num(s.publicRemaining)}</span></div>
      <div className="row"><span className="k">AASU sold</span><span className="v">{num(s.aasuSold)} / {num(s.aasuHold)}</span></div>
      <div className="row"><span className="k">AASU remaining</span><span className="v">{num(s.aasuRemaining)}</span></div>
      <div className="row"><span className="k">Total remaining</span><span className="v">{num(s.totalRemaining)}</span></div>
      <div className="row"><span className="k">Ticket revenue</span><span className="v">{usd(s.baseRevenue)}</span></div>
      <div className="row"><span className="k">Buyers paid (incl. fees)</span><span className="v">{usd(s.grossRevenue)}</span></div>
    </div>
  );
}

export default async function Page() {
  let stats;
  try {
    stats = await fetchStats();
  } catch (e: any) {
    return (
      <main className="wrap">
        <header><h1>Harvard-Yale Tailgate</h1></header>
        <div className="err">
          Couldn&apos;t load Eventbrite data: {e?.message ?? "unknown error"}. Check that <code>EVENTBRITE_TOKEN</code> is set in Vercel.
        </div>
      </main>
    );
  }
  const t = stats.totals;
  const updated = new Date(stats.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });

  return (
    <main className="wrap">
      <header>
        <h1>Harvard-Yale Tailgate · Ticket Sales</h1>
        <span className="sub">Updated {updated} ET · refreshes every minute</span>
      </header>

      <div className="kpi">
        <div className="card"><div className="label">Tickets sold</div><div className="value">{num(t.sold)}</div><div className="hint">of {num(t.allocation)} ({pct(t.sold, t.allocation)}%)</div></div>
        <div className="card"><div className="label">Remaining</div><div className="value">{num(t.totalRemaining)}</div><div className="hint">{num(t.publicRemaining)} public · {num(t.aasuRemaining)} AASU</div></div>
        <div className="card"><div className="label">Ticket revenue</div><div className="value">{usd(t.baseRevenue)}</div><div className="hint">face value, before any processing deductions</div></div>
        <div className="card"><div className="label">Fees passed to buyers</div><div className="value">{usd(t.feesCollected)}</div><div className="hint">buyers paid {usd(t.grossRevenue)} in total</div></div>
        <div className="card"><div className="label">AASU</div><div className="value">{num(t.aasuSold)} / {num(t.aasuHold)}</div><div className="hint">{num(t.aasuRemaining)} held tickets unsold</div></div>
      </div>

      <div className="legend"><span><i style={{ background: "var(--crimson)" }} />Public</span><span><i style={{ background: "var(--gold)" }} />AASU hold</span></div>
      <div className="grid">
        {stats.schools.map((s) => <SchoolCard key={s.key} s={s} />)}
      </div>

      <div className="section-title">By ticket tier</div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr><th>School</th><th>Tier</th><th>Price</th><th>Sold</th><th>Tier max</th><th>Left</th></tr>
          </thead>
          <tbody>
            {stats.schools.flatMap((s) => [
              ...s.sortedTiers.map((tier) => (
                <tr key={`${s.key}-${tier.name}`}>
                  <td>{s.key}</td><td>{tier.name}</td><td>{usd(tier.price)}</td>
                  <td>{num(tier.sold)}</td><td>{num(tier.total)}</td><td>{num(Math.max(0, tier.total - tier.sold))}</td>
                </tr>
              )),
              <tr key={`${s.key}-subtotal`} className="subtotal">
                <td>{s.key}</td><td>Subtotal (allocation)</td><td></td>
                <td>{num(s.sold)}</td><td>{num(s.allocation)}</td><td>{num(s.totalRemaining)}</td>
              </tr>,
            ])}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Total (allocation)</td><td>{num(t.sold)}</td><td>{num(t.allocation)}</td><td>{num(t.totalRemaining)}</td></tr>
          </tfoot>
        </table>
      </div>

      <div className="sub" style={{ marginTop: 6 }}>Tier max is each tier&apos;s share of the school allocation. Sold counts every ticket sold in the tier, whoever distributed it.</div>

      <div className="section-title">Public vs AASU split</div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="split">
          <thead>
            <tr className="group">
              <th></th><th></th>
              <th colSpan={3} className="g pub">Public sale</th>
              <th colSpan={4} className="g aasu">AASU hold</th>
            </tr>
            <tr>
              <th>School</th><th>Allocation</th>
              <th className="g">Capacity</th><th>Sold</th><th>Left</th>
              <th className="g">Hold</th><th>Sold</th><th>Left</th><th>% sold</th>
            </tr>
          </thead>
          <tbody>
            {stats.schools.flatMap((s) => {
              const aasuTiers = s.sortedTiers.filter((x) => x.aasuSold > 0);
              return [
                <tr key={`split-${s.key}`} className={aasuTiers.length > 0 ? "has-detail" : undefined}>
                  <td>{s.key}</td><td>{num(s.allocation)}</td>
                  <td className="g">{num(s.publicCapacity)}</td><td>{num(s.publicSold)}</td><td>{num(s.publicRemaining)}</td>
                  <td className="g">{num(s.aasuHold)}</td><td>{num(s.aasuSold)}</td><td>{num(s.aasuRemaining)}</td><td>{pct(s.aasuSold, s.aasuHold)}%</td>
                </tr>,
                ...(aasuTiers.length > 0
                  ? [
                      <tr key={`split-${s.key}-tiers`} className="detail">
                        <td colSpan={9}>AASU sold by tier: {aasuTiers.map((x) => `${x.name} ${num(x.aasuSold)}`).join(" · ")}</td>
                      </tr>,
                    ]
                  : []),
              ];
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td><td>{num(t.allocation)}</td>
              <td className="g">{num(t.allocation - t.aasuHold)}</td><td>{num(t.publicSold)}</td><td>{num(t.publicRemaining)}</td>
              <td className="g">{num(t.aasuHold)}</td><td>{num(t.aasuSold)}</td><td>{num(t.aasuRemaining)}</td><td>{pct(t.aasuSold, t.aasuHold)}%</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="sub" style={{ marginTop: 6 }}>Each school&apos;s allocation is split between the public sale and the AASU hold (capacity + hold = allocation). Both channels&apos; sales count toward the tier table above.</div>

      <div className="notes">
        AASU sales are tickets from the AASU hold ticket types (or bought with a code starting with <code>AASU_</code>). Hold sizes are read from Eventbrite: each school&apos;s allocation minus its section capacity. Public capacity is the allocation minus the hold. Refunded and cancelled tickets are excluded.
        {stats.notes.length > 0 && <div style={{ marginTop: 6 }}>{stats.notes.join(" · ")}</div>}
      </div>
    </main>
  );
}
