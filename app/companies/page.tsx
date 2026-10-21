import Link from "next/link";
import { asc, count, eq } from "drizzle-orm";
import { addCompany } from "@/app/actions";
import { db } from "@/db";
import { companies, contacts } from "@/db/schema";
import { niceDate } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Companies" };

export default async function Companies() {
  await requireUser();
  const rows = await db.select({ co: companies, people: count(contacts.id) }).from(companies)
    .leftJoin(contacts, eq(contacts.companyId, companies.id)).groupBy(companies.id)
    .orderBy(asc(companies.priority), asc(companies.name));

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
            <table className="table">
              <thead><tr><th>Company</th><th>Industry</th><th>Priority</th><th className="num">People</th><th>News updated</th></tr></thead>
              <tbody>
                {rows.map(({ co, people }) => (
                  <tr key={co.id}>
                    <td><Link className="name" href={`/companies/${co.id}`}>{co.name}</Link>{co.domain && <div className="sub">{co.domain}</div>}</td>
                    <td className="sub">{co.industry}</td>
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
