import Link from "next/link";
import { asc } from "drizzle-orm";
import { startJob } from "@/app/actions";
import { Submit } from "@/components/client";
import { db } from "@/db";
import { companies, emailTemplates } from "@/db/schema";
import { listContacts, SOURCES, STATUSES } from "@/lib/data";
import { label, niceDate, plural } from "@/lib/format";
import { listJobs } from "@/lib/jobs";
import { requireUser } from "@/lib/session";
import { PickAll } from "./pick-all";

export const metadata = { title: "Batch AI" };

export default async function Batch({ searchParams }: PageProps<"/batch">) {
  await requireUser();
  const a = await searchParams;
  const arg = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  const [people, cos, tpls, recent] = await Promise.all([
    listContacts({ q: arg("q"), status: arg("status"), source: arg("source"), companyId: Number(arg("companyId")) || undefined }),
    db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(asc(companies.name)),
    db.select().from(emailTemplates).orderBy(asc(emailTemplates.kind), asc(emailTemplates.name)),
    listJobs(),
  ]);

  return (
    <div className="page-narrow">
      <div className="page-head">
        <div><h1>Batch AI</h1><p className="sub">Draft emails or fill in graph fields for many contacts at once. Drafts are never sent: you review each one.</p></div>
      </div>

      <div className="stack">
        <form className="toolbar" role="search">
          <input type="search" name="q" defaultValue={arg("q")} placeholder="Search name, title, or company" aria-label="Search contacts" />
          <select name="status" defaultValue={arg("status")} aria-label="Status">
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <select name="companyId" defaultValue={arg("companyId")} aria-label="Company">
            <option value="">Any company</option>
            {cos.map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
          </select>
          <select name="source" defaultValue={arg("source")} aria-label="Source">
            <option value="">Any source</option>
            {SOURCES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <button className="btn">Filter</button>
        </form>

        <form action={startJob} className="stack">
          <section className="card">
            <div className="card-head"><h2>What to do</h2></div>
            <div className="card-body stack" style={{ gap: 12 }}>
              <div className="row">
                <label className="row"><input type="radio" name="kind" value="draft" defaultChecked /> Draft an email for each</label>
                <label className="row"><input type="radio" name="kind" value="enrich" /> Fill in missing industry, team, and school</label>
              </div>
              <label className="field"><span>Template <span className="hint">for drafts</span></span>
                <select name="templateId" defaultValue="">
                  <option value="">No template: AI writes the whole email</option>
                  {tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select></label>
              <label className="field"><span>Instruction <span className="hint">for drafts, e.g. &quot;personable, mention a shared school if there is one&quot;</span></span>
                <textarea name="instruction" rows={3} /></label>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>{plural(people.length, "contact")}</h2>
              <PickAll />
            </div>
            {people.length ? (
              <ul className="list">
                {people.map((c) => (
                  <li key={c.id}>
                    <input type="checkbox" name="contactId" value={c.id} id={`c-${c.id}`} defaultChecked />
                    <label className="grow" htmlFor={`c-${c.id}`}>
                      <span className="title">{c.name}</span>{c.company && <span className="muted"> · {c.company}</span>}
                      <div className="sub">{label(c.status)}{c.title && ` · ${c.title}`}</div>
                    </label>
                  </li>
                ))}
              </ul>
            ) : <p className="empty">No contacts match these filters.</p>}
            <div className="card-body row" style={{ borderTop: "1px solid var(--line-soft)", justifyContent: "flex-end" }}>
              <Submit className="btn btn-primary" pending="Starting…" disabled={!people.length}>Start batch</Submit>
            </div>
          </section>
        </form>

        {recent.length > 0 && (
          <section className="card">
            <div className="card-head"><h2>Recent batches</h2></div>
            <ul className="list">
              {recent.map((j) => (
                <li key={j.id}>
                  <div className="grow">
                    <Link className="title" href={`/batch/${j.id}`}>{j.kind === "draft" ? "Drafts" : "Fill fields"} · {niceDate(j.createdAt)}</Link>
                    <div className="sub">{j.done}/{j.total} done{j.failed ? ` · ${j.failed} failed` : ""}{j.instruction && ` · ${j.instruction}`}</div>
                  </div>
                  <span className={`pill ${j.status === "running" ? "s-warn" : j.status === "done" ? "s-replied" : "s-dead"}`}>{j.status}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
