import { NextRequest, NextResponse } from "next/server";
import { partyFromToken, SESSION_COOKIE } from "@/lib/auth";

// Party login gate. Signed-out visitors are sent to /login; API calls get a 401.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();

  const party = await partyFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (party) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
