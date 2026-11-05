// ponytail: one user in Toronto, so "today" and date display use one fixed zone instead of a per-user setting.
export const TZ = "America/Toronto";

/** Today's date as YYYY-MM-DD in TZ. */
export function today(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Oct 3" this year, "Oct 3, 2025" otherwise. Blank stays blank. */
export function niceDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const iso = typeof value === "string" ? value.slice(0, 10) : today(value);
  const d = new Date(`${iso}T00:00:00Z`);
  const sameYear = iso.slice(0, 4) === today().slice(0, 4);
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Only http(s) links reach an href; AI- or import-supplied javascript: URLs become "#". */
export function safeUrl(url: string | null | undefined): string {
  const u = (url ?? "").trim();
  if (/^https?:\/\//i.test(u)) return u;
  // A bare "linkedin.com/in/x" is a site, not a path in this app. Anything with a scheme (javascript:) stays blocked.
  return /^[\w-]+(\.[\w-]+)+(\/|$)/.test(u) ? `https://${u}` : "#";
}

export const label = (s: string) => s.replaceAll("_", " ");
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Outlook on the web compose window, prefilled. Sends from whatever account is signed in there. */
export function composeUrl(to: string, subject: string, body: string): string {
  const q = new URLSearchParams({ to, subject, body });
  return `https://outlook.office.com/mail/deeplink/compose?${q.toString().replaceAll("+", "%20")}`;
}

/** A contact's line of work. Dropdown options; the AI picks from these too. */
export const TYPES = [
  "Investment Banking",
  "Sales & Trading",
  "Equity Research",
  "Private Equity",
  "Private Credit",
  "Hedge Funds",
  "Asset Management",
  "Pension Funds",
  "Venture Capital",
  "Quant & Prop Trading",
  "Wealth Management",
  "Corporate Development",
  "Transaction Advisory",
  "Commercial Banking",
  "Fintech",
  "Insurance",
  "Recruiting",
  "Other",
] as const;

/** A company's tier, grouped for the dropdown. The AI picks from these too. */
export const SCALES: Record<string, readonly string[]> = {
  Banks: ["Bulge Bracket", "Big 6 (Canada)", "Elite Boutique", "Middle Market Bank", "Regional Boutique"],
  "Buy side": ["Mega-fund", "Upper Middle Market Fund", "Middle Market Fund", "Lower Middle Market Fund",
    "Multi-Manager Hedge Fund", "Single-Manager Hedge Fund", "Asset Manager"],
  Pensions: ["Maple 8", "Other Pension / Sovereign Wealth"],
  Advisory: ["Big 4", "Advisory Boutique"],
  Other: ["Fintech / Startup", "Corporate", "Insurer", "Other"],
};
export const ALL_SCALES = Object.values(SCALES).flat();
