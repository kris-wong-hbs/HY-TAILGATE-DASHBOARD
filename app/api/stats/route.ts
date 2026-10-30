import { NextRequest, NextResponse } from "next/server";
import { partyFromToken, seesAasu, SESSION_COOKIE } from "@/lib/auth";
import { fetchDebug, fetchStats, withoutAasu } from "@/lib/eventbrite";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const party = await partyFromToken(req.cookies.get(SESSION_COOKIE)?.value);
    const full = party ? seesAasu(party) : false;
    if (req.nextUrl.searchParams.get("debug") === "1") {
      if (!full) return NextResponse.json({ error: "Not available for this party" }, { status: 403 });
      return NextResponse.json(await fetchDebug(), { headers: { "Cache-Control": "no-store" } });
    }
    const stats = await fetchStats();
    return NextResponse.json(full ? stats : withoutAasu(stats), { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
