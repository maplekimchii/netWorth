"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";
import { label as pretty } from "@/lib/format";

/** A status dropdown styled as a pill that saves as soon as it changes. */
export function StatusSelect({ action, name = "status", current, options, label, hidden }: {
  action: (fd: FormData) => Promise<void>; name?: string; current: string; options: readonly string[];
  label: string; hidden?: Record<string, string>;
}) {
  return (
    <form className="inline" action={action}>
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <select name={name} defaultValue={current} className={`pill-select s-${current}`} aria-label={label}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {options.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
      </select>
    </form>
  );
}

/** Plain select that submits its form on change (referrer pickers, sheet picker). */
export function AutoSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

/** Submit button that shows a working label while its form's action runs (AI calls take a while). */
export function Submit({ children, pending, className = "btn", ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { pending?: string }) {
  const status = useFormStatus();
  return (
    <button className={className} {...rest} disabled={status.pending || rest.disabled}>
      {status.pending && pending ? pending : children}
    </button>
  );
}

export function Flash() {
  const msg = useSearchParams().get("flash");
  return msg ? <div className="flash" role="status">{msg}</div> : null;
}

export function NavLink({ href, children, count }: { href: string; children: React.ReactNode; count?: number }) {
  const path = usePathname();
  const current = href === "/" ? path === "/" : path.startsWith(href);
  return (
    <Link className="nav-link" href={href} aria-current={current ? "page" : undefined}>
      {children}{count ? <span className="count" aria-label={`${count} due`}>{count}</span> : null}
    </Link>
  );
}
