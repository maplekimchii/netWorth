import { asc, desc, eq } from "drizzle-orm";
import { addApplication, updateApplication } from "@/app/actions";
import { AutoSelect, StatusSelect } from "@/components/client";
import { db } from "@/db";
import { applications, companies, contacts } from "@/db/schema";
import { APP_STATUSES } from "@/lib/data";
import { niceDate, safeUrl } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Applications" };

export default async function Applications() {
  await requireUser();
  const [apps, people] = await Promise.all([
    db.select({ a: applications, company: companies.name }).from(applications)
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .orderBy(desc(applications.updatedAt)),
    db.select({ id: contacts.id, name: contacts.name, company: companies.name }).from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId)).orderBy(asc(contacts.name)),
  ]);

  return (
    <>
      <div className="page-head">
        <div><h1>Applications</h1><p className="sub">{apps.length} total. Link a referrer to remember who helped.</p></div>
      </div>

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="card-head"><h2>Add an application</h2></div>
        <form action={addApplication} className="card-body">
          <div className="form-grid">
            <label className="field"><span>Company</span><input name="company" required /></label>
            <label className="field"><span>Role</span><input name="role" required /></label>
            <label className="field"><span>Posting URL</span><input name="url" type="url" /></label>
            <label className="field"><span>Referrer</span>
              <select name="referrerContactId" defaultValue="">
                <option value="">None</option>
                {people.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company && ` (${c.company})`}</option>)}
              </select></label>
          </div>
          <div className="form-actions"><button className="btn btn-primary">Add application</button></div>
        </form>
      </section>

      <div className="card">
        {apps.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Role</th><th>Company</th><th>Applied</th><th>Status</th><th>Referrer</th></tr></thead>
              <tbody>
                {apps.map(({ a, company }) => {
                  const save = updateApplication.bind(null, a.id);
                  return (
                    <tr key={a.id}>
                      <td>{a.url ? <a className="name" href={safeUrl(a.url)} target="_blank" rel="noopener">{a.role}</a> : <span className="name">{a.role}</span>}</td>
                      <td>{company}</td>
                      <td className="sub">{niceDate(a.appliedDate) || "—"}</td>
                      <td><StatusSelect action={save} current={a.status} options={APP_STATUSES} label={`Status for ${a.role}`}
                        hidden={{ referrerContactId: String(a.referrerContactId ?? "") }} /></td>
                      <td>
                        <form className="inline" action={save}>
                          <input type="hidden" name="status" value={a.status} />
                          <AutoSelect name="referrerContactId" defaultValue={a.referrerContactId ?? ""} aria-label={`Referrer for ${a.role}`}
                            style={{ width: "auto", height: 28, fontSize: 13 }}>
                            <option value="">No referrer</option>
                            {people.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </AutoSelect>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="empty">No applications yet. Add one above.</p>}
      </div>
    </>
  );
}
