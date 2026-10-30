import { parseParty } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { error?: string; party?: string } }) {
  const selected = parseParty(searchParams.party);
  return (
    <main className="wrap login">
      <form className="card" method="post" action="/api/login">
        <h1>Harvard-Yale Tailgate</h1>
        <p className="sub">Sign in to see ticket sales.</p>
        <label>
          Party
          <input type="text" name="party" defaultValue={selected ?? ""} autoComplete="off" autoCapitalize="characters" spellCheck={false} required />
        </label>
        <label>
          Password
          <input type="password" name="password" autoComplete="current-password" required />
        </label>
        {searchParams.error && <div className="login-err">That party and password don&apos;t match.</div>}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
