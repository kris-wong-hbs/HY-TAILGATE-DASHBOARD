// Party logins. Not real auth: each party has one shared password from an env var
// (PASSWORD_HBS, PASSWORD_HLS, ...). The session cookie is the party name signed with
// that party's password, so it can't be edited to switch parties, and changing a
// password signs everyone in that party out.

export const PARTIES = ["HBS", "HLS", "SOM", "YLS", "AASU"] as const;
export type Party = (typeof PARTIES)[number];

/** Parties that see AASU holds and sales. Everyone else gets the dashboard without AASU. */
export const FULL_VIEW: readonly Party[] = ["HBS", "AASU"];

export const SESSION_COOKIE = "hy_party";

export function passwordFor(party: Party): string | undefined {
  return process.env[`PASSWORD_${party}`] || undefined;
}

export function parseParty(input: unknown): Party | undefined {
  let p = String(input ?? "").trim().toUpperCase();
  if (p === "HLC") p = "HLS"; // accept the alternate spelling at login
  return (PARTIES as readonly string[]).includes(p) ? (p as Party) : undefined;
}

export function seesAasu(party: Party): boolean {
  return FULL_VIEW.includes(party);
}

async function hmac(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cookie value for a signed-in party, or undefined if its password env var isn't set. */
export async function sessionToken(party: Party): Promise<string | undefined> {
  const secret = passwordFor(party);
  if (!secret) return undefined;
  return `${party}.${await hmac(`hy-tailgate:${party}`, secret)}`;
}

/** The party a cookie value belongs to, if its signature is valid. */
export async function partyFromToken(token: string | undefined): Promise<Party | undefined> {
  if (!token) return undefined;
  const party = parseParty(token.split(".")[0]);
  if (!party) return undefined;
  const expected = await sessionToken(party);
  return expected && expected === token ? party : undefined;
}
