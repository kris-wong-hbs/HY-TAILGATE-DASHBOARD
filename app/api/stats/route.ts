import { NextResponse } from "next/server";
import { fetchStats } from "@/lib/eventbrite";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await fetchStats();
    return NextResponse.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
