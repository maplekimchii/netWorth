import Link from "next/link";
import { asc, countDistinct, eq } from "drizzle-orm";
import { addCompany, deleteCompanies } from "@/app/actions";
import { ConfirmButton } from "@/components/client";
import { db } from "@/db";
import { applications, companies, contacts } from "@/db/schema";
import { niceDate, plural } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Companies" };

export default async function Companies() {
  await requireUser();
  const rows = await db.select({
    co: companies, people: countDistinct(contacts.id), apps: countDistinct(applications.id),
  }).from(companies)
    .leftJoin(contacts, eq(contacts.companyId, companies.id))
    .leftJoin(applications, eq(applications.companyId, companies.id)).groupBy(companies.id)
    .orderBy(asc(companies.priority), asc(companies.name));
  const unused = rows.filter((r) => !r.people && !r.apps).length;

  return (
    <>
      <div className="page-head">
        <div><h1>Companies</h1><p className="sub">Sorted by priority. Notes and news here feed into every email.</p></div>
        <form action={addCompany} className="row">
          <input name="name" required placeholder="Company name" aria-label="Company name" style={{ width: 200 }} />
          <button className="btn btn-primary">Add company</button>
        </form>
      </div>
      <div className="card">
        {rows.length ? (
          <div className="table-wrap">
            <form id="bulk" action={deleteCompanies} className="card-body row" style={{ borderBottom: "1px solid var(--line-soft)" }}>
              <p className="muted small spacer">Tick companies to delete them. Their contacts stay, without a company; their applications go.</p>
              {unused > 0 && <ConfirmButton className="btn btn-sm" name="unused" value="1"
                confirm={`Delete ${plural(unused, "company")} with no contacts or applications?`}>Remove {plural(unused, "unused company")}</ConfirmButton>}
              <ConfirmButton className="btn btn-sm" confirm="Delete the ticked companies? Their contacts stay; their applications are deleted.">Delete selected</ConfirmButton>
              <ConfirmButton className="btn btn-sm btn-ghost" name="all" value="1"
                confirm="Delete ALL companies and all applications? Contacts stay, without a company. This can't be undone.">Delete all companies</ConfirmButton>
            </form>
            <table className="table">
              <thead><tr><th aria-label="Select"></th><th>Company</th><th>Scale</th><th>Priority</th><th className="num">People</th><th>News updated</th></tr></thead>
              <tbody>
                {rows.map(({ co, people }) => (
                  <tr key={co.id}>
                    <td><input type="checkbox" form="bulk" name="id" value={co.id} aria-label={`Select ${co.name}`} /></td>
                    <td><Link className="name" href={`/companies/${co.id}`}>{co.name}</Link>{co.domain && <div className="sub">{co.domain}</div>}</td>
                    <td className="sub">{co.scale}</td>
                    <td><span className={`pill ${co.priority === 1 ? "s-warn" : ""}`}>P{co.priority}</span></td>
                    <td className="num">{people}</td>
                    <td className="sub">{niceDate(co.newsUpdatedAt) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="empty">No companies yet. Add one above, or they appear as you save contacts.</p>}
      </div>
    </>
  );
}
