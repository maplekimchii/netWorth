import { signIn } from "@/auth";

export default async function Login({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <div className="page-narrow">
      <h1>Sign in</h1>
      {error === "AccessDenied" && <div className="flash" role="alert">That GitHub account is not allowed.</div>}
      {error && error !== "AccessDenied" && <div className="flash" role="alert">Sign-in failed: {String(error)}</div>}
      <form action={async () => { "use server"; await signIn("github", { redirectTo: "/" }); }}>
        <button className="btn btn-primary">Sign in with GitHub</button>
      </form>
    </div>
  );
}
