import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "netWorth" };
// ponytail: every page reads the session, so routes block on the server instead of streaming a static shell.
export const instant = false;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <div className="layout">
          <nav className="sidebar" aria-label="Main">
            <div className="brand">net<span>Worth</span></div>
          </nav>
          <main className="main"><div className="page">{children}</div></main>
        </div>
      </body>
    </html>
  );
}
