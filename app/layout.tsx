import type { Metadata } from "next";
import { Suspense } from "react";
import { auth } from "@/auth";
import { Flash, NavLink } from "@/components/client";
import { dueCount } from "@/lib/data";
import "./globals.css";

export const metadata: Metadata = { title: { default: "netWorth", template: "%s · netWorth" } };
// ponytail: every page reads the session, so routes block on the server instead of streaming a static shell.
export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  const page = <div className="page"><Suspense><Flash /></Suspense>{children}</div>;
  if (!session) {
    return <html lang="en"><body><main className="main">{page}</main></body></html>;
  }
  return (
    <html lang="en">
      <body>
        <div className="layout">
          <nav className="sidebar" aria-label="Main">
            <div className="brand">net<span>Worth</span></div>
            <NavLink href="/" count={await dueCount()}>Today</NavLink>
            <NavLink href="/contacts">Contacts</NavLink>
            <NavLink href="/find">Find people</NavLink>
            <NavLink href="/companies">Companies</NavLink>
            <NavLink href="/applications">Applications</NavLink>
            <div className="nav-group">Setup</div>
            <NavLink href="/templates">Email templates</NavLink>
            <NavLink href="/profile">Profile</NavLink>
            <NavLink href="/import">Import / Export</NavLink>
          </nav>
          <main className="main">{page}</main>
        </div>
      </body>
    </html>
  );
}
