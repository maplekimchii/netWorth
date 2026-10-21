import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { deleteGraphView } from "@/app/actions";
import { db } from "@/db";
import { companies, contacts, graphViews } from "@/db/schema";
import { getProfile } from "@/lib/data";
import { buildTree, levelLabel, parseLevels } from "@/lib/graph";
import { requireUser } from "@/lib/session";
import { GraphView, LevelEditor } from "./graph-client";

export const metadata = { title: "Network graph" };

export default async function Graph({ searchParams }: PageProps<"/graph">) {
  await requireUser();
  const a = await searchParams;
  const [rows, views, me] = await Promise.all([
    db.select({ c: contacts, company: companies.name, industry: companies.industry }).from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId)),
    db.select().from(graphViews).orderBy(asc(graphViews.name)),
    getProfile(),
  ]);
  const people = rows.map((r) => ({ ...r.c, company: r.company, industry: r.industry }));
  const attributeKeys = [...new Set(people.flatMap((p) => Object.keys(p.attributes)))].sort();
  const view = views.find((v) => String(v.id) === a.view);
  const levels = parseLevels(view ? view.levels.join(",") : (a.levels as string | undefined), attributeKeys);
  const tree = buildTree(people, levels, me.name || "Me");

  return (
    <>
      <div className="page-head">
        <div><h1>Network graph</h1><p className="sub">Your contacts grouped by {levels.map(levelLabel).join(" → ")}. Click a group to fold it.</p></div>
      </div>
      <div className="stack">
        <section className="card">
          <div className="card-body stack" style={{ gap: 12 }}>
            <LevelEditor levels={levels} attributeKeys={attributeKeys} />
            {views.length > 0 && (
              <div className="row small">
                <span className="muted">Saved views:</span>
                {views.map((v) => (
                  <span key={v.id} className="row" style={{ gap: 2 }}>
                    <Link className={`pill ${view?.id === v.id ? "s-sent" : ""}`} href={`/graph?view=${v.id}`}>{v.name}</Link>
                    <form className="inline" action={deleteGraphView.bind(null, v.id)}>
                      <button className="btn btn-sm btn-ghost" aria-label={`Delete view ${v.name}`} title="Delete view">×</button>
                    </form>
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>
        <section className="card">
          {people.length
            ? <GraphView key={levels.join(",")} tree={tree} />
            : <p className="empty">No contacts yet. <Link href="/find">Find people</Link> or <Link href="/import">import</Link> to see your network.</p>}
        </section>
      </div>
    </>
  );
}
