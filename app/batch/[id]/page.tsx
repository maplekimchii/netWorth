import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelJob, retryJob } from "@/app/actions";
import { Pill } from "@/components/ui";
import { niceDate } from "@/lib/format";
import { getJob } from "@/lib/jobs";
import { requireUser } from "@/lib/session";
import { Runner } from "./runner";

export default async function JobPage({ params }: PageProps<"/batch/[id]">) {
  await requireUser();
  const id = Number((await params).id);
  const job = Number.isInteger(id) ? await getJob(id) : null;
  if (!job) notFound();
  const done = job.items.filter((i) => i.status === "done").length;
  const failed = job.items.filter((i) => i.status === "failed").length;
  const running = job.status === "running";

  return (
    <div className="page-narrow">
      <title>{`Batch ${id} · netWorth`}</title>
      <div className="page-head">
        <div>
          <h1>{job.kind === "draft" ? "Batch drafts" : "Fill in fields"}</h1>
          <p className="sub">
            Started {niceDate(job.createdAt)}
            {job.kind === "draft" && ` · ${job.template ?? "no template"}`}
            {job.instruction && ` · “${job.instruction}”`}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/batch">All batches</Link>
      </div>

      <div className="stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="stat"><div className="k">Done</div><div className="v">{done}/{job.items.length}</div></div>
        <div className={`stat ${failed ? "attn" : ""}`}><div className="k">Failed</div><div className="v">{failed}</div></div>
        <div className="stat"><div className="k">Status</div><div className="v" style={{ fontSize: 18 }}>{job.status}</div></div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Contacts</h2>
          <span className="row">
            <Runner key={job.status} jobId={id} running={running} />
            {running && <form className="inline" action={cancelJob.bind(null, id)}><button className="btn btn-sm btn-ghost">Cancel</button></form>}
            {failed > 0 && <form className="inline" action={retryJob.bind(null, id)}><button className="btn btn-sm">Retry failed</button></form>}
            {job.kind === "draft" && done > 0 && <Link className="btn btn-sm btn-primary" href="/drafts">Review drafts</Link>}
          </span>
        </div>
        <ul className="list">
          {job.items.map((i) => (
            <li key={i.id}>
              <div className="grow">
                <Link className="title" href={`/contacts/${i.contactId}`}>{i.name}</Link>
                {i.error && <div className="sub">{i.error}</div>}
              </div>
              <Pill status={i.status === "done" ? "replied" : i.status === "failed" ? "dead" : "to_contact"} text={i.status} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
