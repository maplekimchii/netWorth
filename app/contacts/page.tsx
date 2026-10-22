import Link from "next/link";
import { asc } from "drizzle-orm";
import { addContact, deleteContacts, setStatus } from "@/app/actions";
import { ConfirmButton, StatusSelect } from "@/components/client";
import { ContactFormFields } from "@/components/ui";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { listContacts, SOURCES, STATUSES } from "@/lib/data";
import { label, niceDate, plural, today } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Contacts" };

export default async function Contacts({ searchParams }: PageProps<"/contacts">) {
  await requireUser();
  const a = await searchParams;
  const arg = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  const filtered = Boolean(arg("q") || arg("status") || arg("companyId") || arg("source"));
  const [rows, cos] = await Promise.all([
    listContacts({ q: arg("q"), status: arg("status"), source: arg("source"), companyId: Number(arg("companyId")) || undefined }),
    db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(asc(companies.name)),
  ]);
  const now = today();

  return (
    <>
      <div className="page-head">
        <div><h1>Contacts</h1><p className="sub">{plural(rows.length, "person", "people")}</p></div>
        <a className="btn btn-primary" href="#add">Add contact</a>
      </div>

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
        {filtered && <Link className="btn btn-ghost" href="/contacts">Clear</Link>}
      </form>

      <div className="card">
        {rows.length ? (
          <div className="table-wrap">
            {/* Row checkboxes join this form through form="bulk": each status pill is its own form, and forms can't nest. */}
            <form id="bulk" action={deleteContacts} className="card-body row" style={{ borderBottom: "1px solid var(--line-soft)" }}>
              <p className="muted small spacer">Tick contacts to delete them. Their drafts and messages go too.</p>
              <ConfirmButton className="btn btn-sm" confirm="Delete the ticked contacts and their drafts and messages?">Delete selected</ConfirmButton>
              <ConfirmButton className="btn btn-sm btn-ghost" name="all" value="1"
                confirm="Delete ALL contacts, not only the ones shown, with their drafts and messages? This can't be undone.">Delete all contacts</ConfirmButton>
            </form>
            <table className="table">
              <thead><tr><th aria-label="Select"></th><th>Name</th><th>Company</th><th>Status</th><th>Follow up</th><th>Source</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td><input type="checkbox" form="bulk" name="id" value={c.id} aria-label={`Select ${c.name}`} /></td>
                    <td><Link className="name" href={`/contacts/${c.id}`}>{c.name}</Link>{c.title && <div className="sub">{c.title}</div>}</td>
                    <td>{c.company ?? ""}</td>
                    <td><StatusSelect action={setStatus.bind(null, c.id)} current={c.status} options={STATUSES} label={`Status for ${c.name}`} /></td>
                    <td>{c.nextFollowupDate && (
                      <span className={c.nextFollowupDate <= now && c.status === "sent" ? "late-text" : "sub"}>{niceDate(c.nextFollowupDate)}</span>
                    )}</td>
                    <td className="sub">{c.attributes.source || label(c.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : filtered ? <p className="empty">No contacts match these filters.</p> : (
          <p className="empty">No contacts yet. <Link href="/find">Find people</Link> or <Link href="/import">import your LinkedIn connections</Link>.</p>
        )}
      </div>

      <section className="card" id="add" style={{ marginTop: 20 }}>
        <div className="card-head"><h2>Add a contact</h2></div>
        <form action={addContact} className="card-body">
          <input type="hidden" name="source" value="paste" />
          <ContactFormFields />
          <div className="form-actions"><button className="btn btn-primary">Add contact</button></div>
        </form>
      </section>
    </>
  );
}
