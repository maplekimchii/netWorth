// Optimistic gate: no session cookie, go to /login. Pages and actions still check auth() themselves.
export { auth as proxy } from "@/auth";

export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)"],
};
