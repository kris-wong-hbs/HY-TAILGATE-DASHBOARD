import { NextResponse } from "next/server";
import { parseParty, passwordFor, sessionToken, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const party = parseParty(form.get("party"));
  const supplied = String(form.get("password") ?? "");
  const expected = party ? passwordFor(party) : undefined;
  const token = party && expected && supplied === expected ? await sessionToken(party) : undefined;

  if (!token) {
    // 303 so the browser follows with a GET.
    return NextResponse.redirect(new URL(`/login?error=1${party ? `&party=${party}` : ""}`, req.url), 303);
  }
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
