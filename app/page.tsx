// Phase 2 spike page: proves login works and shows which Outlook scopes the tenant granted.
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { graph, grantedScopes, OutlookError } from "@/lib/outlook";

export default async function Home() {
  const session = await auth();
  if (!session) redirect("/login");

  const scopes = await grantedScopes();
  let me = "";
  try {
    const r = await graph<{ mail?: string; userPrincipalName: string }>("GET", "/me?$select=mail,userPrincipalName");
    me = r.mail ?? r.userPrincipalName;
  } catch (e) {
    if (!(e instanceof OutlookError)) throw e;
    me = `Error: ${e.message}`;
  }
  const has = (s: string) => scopes.some((g) => g.toLowerCase().endsWith(s.toLowerCase()));

  return (
    <>
      <h1>Outlook connection</h1>
      <dl className="kv">
        <dt>Signed in as</dt><dd>{session.user?.email}</dd>
        <dt>Graph /me</dt><dd>{me}</dd>
        <dt>Mail.ReadWrite</dt><dd>{has("Mail.ReadWrite") ? "granted" : "missing"}</dd>
        <dt>Mail.Send</dt><dd>{has("Mail.Send") ? "granted" : "missing"}</dd>
      </dl>
      <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
        <button className="btn btn-ghost">Sign out</button>
      </form>
    </>
  );
}
