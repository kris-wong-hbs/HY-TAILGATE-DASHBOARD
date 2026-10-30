import { NextResponse } from "next/server";
import { fetchDebug, fetchStats } from "@/lib/eventbrite";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const debug = new URL(req.url).searchParams.get("debug") === "1";
    const stats = debug ? await fetchDebug() : await fetchStats();
    return NextResponse.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
