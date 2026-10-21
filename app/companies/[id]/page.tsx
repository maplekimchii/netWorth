import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { addApplication, refreshNews, updateCompany } from "@/app/actions";
import { Submit } from "@/components/client";
import { Pill } from "@/components/ui";
import { db } from "@/db";
import { applications, companies, contacts } from "@/db/schema";
import { listContacts } from "@/lib/data";
import { niceDate, plural } from "@/lib/format";
import { requireUser } from "@/lib/session";

export default async function CompanyPage({ params }: PageProps<"/companies/[id]">) {
  await requireUser();
  const id = Number((await params).id);
  const [co] = Number.isInteger(id) ? await db.select().from(companies).where(eq(companies.id, id)) : [];
  if (!co) notFound();
  const [people, apps] = await Promise.all([
    listContacts({ companyId: id }),
    db.select({ a: applications, referrer: contacts.name }).from(applications)
      .leftJoin(contacts, eq(contacts.id, applications.referrerContactId)).where(eq(applications.companyId, id)),
  ]);

  return (
    <>
      <title>{`${co.name} · netWorth`}</title>
      <div className="page-head">
        <div>
          <div className="row"><h1>{co.name}</h1><span className={`pill ${co.priority === 1 ? "s-warn" : ""}`}>P{co.priority}</span></div>
          <p className="sub">{plural(people.length, "person", "people")} · {plural(apps.length, "application")}</p>
        </div>
        <Link className="btn btn-ghost" href="/companies">All companies</Link>
      </div>

      <div className="two-col">
        <div className="stack">
          <section className="card" aria-labelledby="notes-h">
            <div className="card-head"><h2 id="notes-h">Why this company</h2><span className="meta">Used in emails</span></div>
            <form action={updateCompany.bind(null, id)} className="card-body">
              <label className="field"><span>Notes</span>
                <textarea name="notes" rows={4} defaultValue={co.notes} placeholder="What draws you here: product, team, mission, a recent launch…" /></label>
              <div className="form-grid">
                <label className="field"><span>Website domain</span><input name="domain" defaultValue={co.domain} placeholder="stripe.com" /></label>
                <label className="field"><span>Industry</span><input name="industry" defaultValue={co.industry} placeholder="Fintech" /></label>
                <label className="field"><span>Priority</span>
                  <select name="priority" defaultValue={co.priority}>
                    <option value={1}>P1 · top target</option><option value={2}>P2</option><option value={3}>P3 · maybe</option>
                  </select></label>
              </div>
              <div className="form-actions"><button className="btn btn-primary">Save</button></div>
            </form>
          </section>

          <section className="card" aria-labelledby="news-h">
            <div className="card-head">
              <h2 id="news-h">Recent news</h2>
              {co.newsUpdatedAt && <span className="meta">Updated {niceDate(co.newsUpdatedAt)}</span>}
              <form className="inline" action={refreshNews.bind(null, id)}><Submit className="btn btn-sm" pending="Researching…">Refresh with AI</Submit></form>
            </div>
            {co.news ? <div className="card-body prose-news">{co.news}</div>
              : <p className="empty">No news yet. Refresh to pull recent launches, funding, and hiring signals.</p>}
          </section>
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="people-h">
            <div className="card-head"><h2 id="people-h">People</h2><Link className="btn btn-sm btn-ghost" href="/find">Find more</Link></div>
            {people.length ? (
              <ul className="list">
                {people.map((c) => (
                  <li key={c.id}>
                    <div className="grow"><Link className="title" href={`/contacts/${c.id}`}>{c.name}</Link><div className="sub">{c.title || "Title unknown"}</div></div>
                    <Pill status={c.status} />
                  </li>
                ))}
              </ul>
            ) : <p className="empty">No contacts here yet.</p>}
          </section>

          <section className="card" aria-labelledby="apps-h">
            <div className="card-head"><h2 id="apps-h">Applications</h2></div>
            {apps.length > 0 && (
              <ul className="list">
                {apps.map(({ a, referrer }) => (
                  <li key={a.id}>
                    <div className="grow"><span className="title">{a.role}</span>{referrer && <div className="sub">Referred by {referrer}</div>}</div>
                    <Pill status={a.status} />
                  </li>
                ))}
              </ul>
            )}
            <form action={addApplication} className="card-body" style={apps.length ? { borderTop: "1px solid var(--line-soft)" } : undefined}>
              <input type="hidden" name="company" value={co.name} />
              <div className="row">
                <input name="role" required placeholder="Role, e.g. PM Intern" aria-label="Role" style={{ flex: 1, width: "auto" }} />
                <button className="btn btn-sm">Add</button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </>
  );
}
