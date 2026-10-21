import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** Every page and server action calls this; proxy.ts is only an optimistic first check. */
export async function requireUser() {
  const session = await auth();
  if (!session) redirect("/login");
  return session;
}

/** Redirect with a one-time message shown by <Flash />. */
export function go(path: string, flash?: string): never {
  redirect(flash ? `${path}${path.includes("?") ? "&" : "?"}flash=${encodeURIComponent(flash)}` : path);
}
