import Link from "next/link";
import { DraftControls } from "@/components/drafts";
import { listDrafts } from "@/lib/data";
import { niceDate, plural } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Drafts" };

export default async function Drafts() {
  await requireUser();
  const drafts = await listDrafts();
  return (
    <div className="page-narrow">
      <div className="page-head">
        <div><h1>Drafts</h1><p className="sub">{plural(drafts.length, "unsent draft")}. Open each in Outlook, send it there, then mark it sent.</p></div>
        <Link className="btn" href="/batch">Batch draft</Link>
      </div>
      <div className="card">
        {drafts.length ? (
          <ol className="timeline">
            {drafts.map(({ m, name, email, company }) => (
              <li key={m.id}>
                <div className="title"><Link href={`/contacts/${m.contactId}`}>{name}</Link>{company && <span className="muted"> · {company}</span>}</div>
                <div className="when">
                  {m.subject || "(no subject)"} · {m.kind === "followup" ? "follow-up" : "first email"} · drafted {niceDate(m.createdAt)}
                  {!email && " · no email on file"}
                </div>
                <details><summary>Show email</summary><pre>{m.body}</pre></details>
                <DraftControls m={m} to={email} />
              </li>
            ))}
          </ol>
        ) : <p className="empty">No unsent drafts.</p>}
      </div>
    </div>
  );
}
