import { NextRequest, NextResponse } from "next/server";

// Password gate. DASHBOARD_PASSWORD must be set in Vercel; if it isn't,
// the dashboard refuses to serve rather than falling open.
export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return new NextResponse("Dashboard locked: DASHBOARD_PASSWORD is not configured.", { status: 503 });
  }

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const idx = decoded.indexOf(":");
    const supplied = idx >= 0 ? decoded.slice(idx + 1) : decoded;
    if (supplied === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Harvard-Yale Tailgate", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
