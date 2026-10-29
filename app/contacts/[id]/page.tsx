import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { markReplied, setStatus, updateContact } from "@/app/actions";
import { StatusSelect } from "@/components/client";
import { DraftControls } from "@/components/drafts";
import { ContactDetails, ContactFormFields, Pill } from "@/components/ui";
import { db } from "@/db";
import { emailTemplates, messages } from "@/db/schema";
import { getContact, STATUSES } from "@/lib/data";
import { niceDate } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { DraftEditor } from "./draft-editor";

export default async function ContactPage({ params }: PageProps<"/contacts/[id]">) {
  await requireUser();
  const id = Number((await params).id);
  const c = Number.isInteger(id) ? await getContact(id) : null;
  if (!c) notFound();
  const [msgs, tpls] = await Promise.all([
    db.select().from(messages).where(eq(messages.contactId, id)).orderBy(asc(messages.id)),
    db.select({ id: emailTemplates.id, name: emailTemplates.name, kind: emailTemplates.kind })
      .from(emailTemplates).orderBy(asc(emailTemplates.kind), asc(emailTemplates.name)),
  ]);
  // Preselect a follow-up template once there is already an email to this person.
  const preferred = tpls.find((t) => t.kind === (msgs.length ? "followup" : "initial"));
  const latestId = msgs.at(-1)?.id;

  return (
    <>
      <title>{`${c.name} · netWorth`}</title>
      <div className="page-head">
        <div>
          <div className="row"><h1>{c.name}</h1><Pill status={c.status} /></div>
          <p className="sub">
            {c.title || "Title unknown"}
            {c.company && <> · <Link href={`/companies/${c.companyId}`}>{c.company}</Link></>}
            {c.nextFollowupDate && ` · follow up ${niceDate(c.nextFollowupDate)}`}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/contacts">All contacts</Link>
      </div>

      <div className="two-col">
        <div className="stack">
          <section className="card" id="draft" aria-labelledby="draft-h">
            <div className="card-head"><h2 id="draft-h">Draft an email</h2></div>
            <DraftEditor contactId={id} templates={tpls} preferredId={preferred?.id} />
          </section>

          <section className="card" aria-labelledby="hist-h">
            <div className="card-head"><h2 id="hist-h">Email history</h2><span className="meta">{msgs.length}</span></div>
            {msgs.length ? (
              <ol className="timeline">
                {msgs.toReversed().map((m) => {
                  const latest = m.id === latestId;
                  return (
                    <li key={m.id} className={m.repliedAt ? "replied" : m.sentAt ? "sent" : ""}>
                      <div className="title">{m.subject}</div>
                      <div className="when">
                        {m.kind === "followup" ? "Follow-up" : "First email"} · drafted {niceDate(m.createdAt)}
                        {m.sentAt ? ` · sent ${niceDate(m.sentAt)}` : " · not sent"}
                        {m.repliedAt && ` · replied ${niceDate(m.repliedAt)}`}
                      </div>
                      <details><summary>Show email</summary><pre>{m.body}</pre></details>
                      {!m.sentAt && <DraftControls m={m} to={c.email} />}
                      {latest && !m.repliedAt && (
                        <div className="row actions">
                          <form className="inline" action={markReplied.bind(null, m.id)}><button className="btn btn-sm">Mark replied</button></form>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : <p className="empty">No emails yet. Draft the first one above.</p>}
          </section>
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="status-h">
            <div className="card-head">
              <h2 id="status-h">Status</h2>
              <StatusSelect action={setStatus.bind(null, id)} current={c.status} options={STATUSES} label="Status" />
            </div>
            {!c.email && <div className="card-body"><p className="note">No email on file. Add one in Details, or add the recipient in Outlook.</p></div>}
          </section>

          <section className="card" aria-labelledby="details-h">
            <div className="card-head"><h2 id="details-h">Details</h2></div>
            <div className="card-body">
              <details className="edit">
                <summary className="btn btn-sm">Edit details</summary>
                <form action={updateContact.bind(null, id)} className="stack" style={{ gap: 10, marginTop: 12 }}>
                  <ContactFormFields v={c} notes />
                  <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn btn-primary">Save</button></div>
                </form>
              </details>
              <ContactDetails c={c} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
