import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";

export default async function Home() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <>
      <h1>netWorth</h1>
      <p className="muted">Signed in as {session.user?.name ?? session.user?.email}.</p>
      <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
        <button className="btn btn-ghost">Sign out</button>
      </form>
    </>
  );
}
