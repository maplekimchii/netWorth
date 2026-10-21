import Link from "next/link";
import { markSent, setStatus } from "@/app/actions";
import { Pill } from "@/components/ui";
import { stats, todayView } from "@/lib/data";
import { niceDate, plural, TZ } from "@/lib/format";
import { requireUser } from "@/lib/session";

export default async function Today() {
  await requireUser();
  const [view, st] = await Promise.all([todayView(), stats()]);
  const dateLine = new Date().toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" });

  return (
    <>
      <div className="page-head"><div><h1>Today</h1><p className="sub">{dateLine}</p></div></div>
      <div className="banner">Mark emails sent and replied yourself after sending them from Outlook.</div>

      <div className="stats">
        <div className={`stat ${st.due ? "attn" : ""}`}><div className="k">Follow-ups due</div><div className="v">{st.due}</div></div>
        <div className="stat"><div className="k">Sent (7 days)</div><div className="v">{st.sentWeek}</div></div>
        <div className="stat"><div className="k">Reply rate (30 days)</div><div className="v">{st.replyRate === null ? "—" : `${st.replyRate}%`}</div></div>
        <div className="stat"><div className="k">Calls booked</div><div className="v">{st.calls}</div></div>
      </div>

      <div className="stack">
        <section className="card" aria-labelledby="due-h">
          <div className="card-head"><h2 id="due-h">Follow-ups due</h2><span className="meta">{view.due.length}</span></div>
          {view.due.length ? (
            <ul className="list">
              {view.due.map((c) => (
                <li key={c.id}>
                  <div className="grow">
                    <Link className="title" href={`/contacts/${c.id}`}>{c.name}</Link>
                    <div className="sub">
                      {c.title || "Title unknown"}{c.company && ` · ${c.company}`}
                      {c.followupCount > 0 && ` · ${plural(c.followupCount, "follow-up")} sent`}
                    </div>
                  </div>
                  {c.daysLate > 0 ? <Pill status="late" text={`${plural(c.daysLate, "day")} late`} /> : <Pill status="warn" text="due today" />}
                  {c.followupCount >= 2 ? (
                    <>
                      <form className="inline" action={setStatus.bind(null, c.id)}>
                        <button className="btn btn-sm" name="status" value="dead" title="No reply after 2 follow-ups">Mark dead</button>
                      </form>
                      <Link className="btn btn-sm btn-ghost" href={`/contacts/${c.id}#draft`}>Follow up anyway</Link>
                    </>
                  ) : <Link className="btn btn-sm btn-primary" href={`/contacts/${c.id}#draft`}>Draft follow-up</Link>}
                </li>
              ))}
            </ul>
          ) : <p className="empty">Nothing due. Nice.</p>}
        </section>

        <section className="card" aria-labelledby="unsent-h">
          <div className="card-head"><h2 id="unsent-h">Drafts not sent yet</h2><span className="meta">{view.unsent.length}</span></div>
          {view.unsent.length ? (
            <ul className="list">
              {view.unsent.map((m) => (
                <li key={m.id}>
                  <div className="grow">
                    <Link className="title" href={`/contacts/${m.contactId}`}>{m.name}</Link>
                    <div className="sub">{m.subject} · drafted {niceDate(m.createdAt)}</div>
                  </div>
                  <form className="inline" action={markSent.bind(null, m.id)}><button className="btn btn-sm">Mark sent</button></form>
                </li>
              ))}
            </ul>
          ) : <p className="empty">No forgotten drafts.</p>}
        </section>

        <section className="card" aria-labelledby="apps-h">
          <div className="card-head">
            <h2 id="apps-h">Applications with no update in 14+ days</h2>
            <Link className="btn btn-sm btn-ghost" href="/applications">All applications</Link>
          </div>
          {view.staleApps.length ? (
            <ul className="list">
              {view.staleApps.map((a) => (
                <li key={a.id}>
                  <div className="grow"><span className="title">{a.role}</span><div className="sub">{a.company} · last change {niceDate(a.updatedAt)}</div></div>
                  <Pill status={a.status} />
                </li>
              ))}
            </ul>
          ) : <p className="empty">All applications are current.</p>}
        </section>
      </div>
    </>
  );
}
