import Link from "next/link";
import { eq } from "drizzle-orm";
import { deleteDrafts } from "@/app/actions";
import { ConfirmButton } from "@/components/client";
import { DraftControls } from "@/components/drafts";
import { ContactDetails, Pill } from "@/components/ui";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { getContact, listDrafts } from "@/lib/data";
import { niceDate, plural } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Drafts" };

export default async function Drafts({ searchParams }: PageProps<"/drafts">) {
  await requireUser();
  const drafts = await listDrafts();
  const id = Number((await searchParams).id);
  const sel = drafts.find((d) => d.m.id === id) ?? drafts[0];
  const c = sel ? await getContact(sel.m.contactId) : null;
  const [co] = c?.companyId ? await db.select().from(companies).where(eq(companies.id, c.companyId)) : [];

  return (
    <>
      <div className="page-head">
        <div><h1>Drafts</h1><p className="sub">{plural(drafts.length, "unsent draft")}. Open each in Outlook, send it there, then mark it sent.</p></div>
        <Link className="btn" href="/batch">Batch draft</Link>
      </div>
      {sel && c ? (
        <div className="drafts-layout">
          <nav className="card drafts-list" aria-label="Drafts">
            <form id="bulk" action={deleteDrafts} className="card-body row" style={{ borderBottom: "1px solid var(--line-soft)" }}>
              <ConfirmButton className="btn btn-sm" confirm="Delete the ticked drafts?">Delete selected</ConfirmButton>
              <ConfirmButton className="btn btn-sm btn-ghost" name="all" value="1"
                confirm="Delete ALL unsent drafts? This can't be undone.">Delete all</ConfirmButton>
            </form>
            <ul className="list">
              {drafts.map(({ m, name, company }) => (
                <li key={m.id} className={m.id === sel.m.id ? "selected" : ""}>
                  <input type="checkbox" form="bulk" name="id" value={m.id} aria-label={`Select draft to ${name}`} />
                  <Link className="grow" href={`/drafts?id=${m.id}`} aria-current={m.id === sel.m.id ? "page" : undefined}>
                    <div className="title">{name}</div>
                    <div className="sub">{company ?? "No company"} · {m.kind === "followup" ? "follow-up" : "first email"}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <section className="card drafts-email" aria-label="Email">
            <div className="card-body">
              <div className="muted small">
                To: {sel.email || "no email on file"} · {sel.m.kind === "followup" ? "follow-up" : "first email"} · drafted {niceDate(sel.m.createdAt)}
              </div>
              {/* key resets the editor when switching drafts */}
              <DraftControls key={sel.m.id} m={sel.m} to={sel.email} />
            </div>
          </section>

          <aside className="stack drafts-person">
            <section className="card" aria-labelledby="person-h">
              <div className="card-head">
                <h2 id="person-h"><Link href={`/contacts/${c.id}`}>{c.name}</Link></h2>
                <Pill status={c.status} />
              </div>
              <div className="card-body stack" style={{ gap: 12 }}>
                <div className="muted">{c.title || "Title unknown"}{c.company && ` · ${c.company}`}</div>
                <ContactDetails c={c} />
              </div>
            </section>
            {co && (co.notes || co.news) && (
              <section className="card" aria-labelledby="co-h">
                <div className="card-head"><h2 id="co-h"><Link href={`/companies/${co.id}`}>{co.name}</Link></h2></div>
                <div className="card-body stack" style={{ gap: 12 }}>
                  {co.notes && <div><div className="muted small">Why I&apos;m interested</div><pre>{co.notes}</pre></div>}
                  {co.news && <div><div className="muted small">Recent news</div><div className="prose-news">{co.news}</div></div>}
                </div>
              </section>
            )}
          </aside>
        </div>
      ) : <div className="card"><p className="empty">No unsent drafts.</p></div>}
    </>
  );
}
