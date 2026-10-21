import { asc } from "drizzle-orm";
import { saveTemplate } from "@/app/actions";
import { db } from "@/db";
import { emailTemplates } from "@/db/schema";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Email templates" };
const DATA_FIELDS = ["first_name", "last_name", "company", "title", "my_name", "my_program", "target_role"];

export default async function Templates() {
  await requireUser();
  const tpls = await db.select().from(emailTemplates).orderBy(asc(emailTemplates.kind), asc(emailTemplates.name));

  return (
    <div className="page-narrow">
      <div className="page-head">
        <div><h1>Email templates</h1><p className="sub">Fixed text is sent exactly as written. Only the AI slots change per person.</p></div>
      </div>
      <div className="stack">
        <section className="card">
          <div className="card-body">
            <div><b>Data fields</b> <span className="muted small">filled from your data</span></div>
            <div className="chips">{DATA_FIELDS.map((f) => <code key={f}>{`{${f}}`}</code>)}</div>
            <div><b>AI slots</b> <span className="muted small">written in your voice</span></div>
            <div className="chips"><code>[[hook: one line on why I&apos;m reaching out to them]]</code></div>
          </div>
        </section>

        {[...tpls, null].map((t) => (
          <section className="card" key={t?.id ?? "new"}>
            <div className="card-head">
              <h2>{t ? t.name : "New template"}</h2>
              {t && <span className={`pill ${t.kind === "initial" ? "s-sent" : "s-drafted"}`}>{t.kind === "initial" ? "first email" : "follow-up"}</span>}
            </div>
            <form action={saveTemplate} className="card-body">
              {t && <input type="hidden" name="id" value={t.id} />}
              <div className="form-grid">
                <label className="field"><span>Name</span><input name="name" defaultValue={t?.name} required /></label>
                <label className="field"><span>Kind</span>
                  <select name="kind" defaultValue={t?.kind ?? "initial"}>
                    <option value="initial">First email</option><option value="followup">Follow-up</option>
                  </select></label>
                <label className="field full"><span>Subject</span><input name="subject" defaultValue={t?.subject} required /></label>
                <label className="field full"><span>Body</span>
                  <textarea name="body" rows={10} required defaultValue={t?.body} style={{ fontFamily: "var(--mono)", fontSize: 13 }} /></label>
              </div>
              <div className="form-actions"><button className="btn btn-primary">{t ? "Save" : "Add template"}</button></div>
            </form>
          </section>
        ))}
      </div>
    </div>
  );
}
