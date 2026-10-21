// Controls for one unsent draft: edit in place, open in Outlook, mark sent, delete. Used on Contact and Drafts pages.
import { deleteDraft, markSent, updateDraft } from "@/app/actions";
import { OpenInOutlook, Submit } from "./client";

export function DraftControls({ m, to }: { m: { id: number; subject: string; body: string }; to: string }) {
  return (
    <>
      <details className="edit">
        <summary className="btn btn-sm">Edit</summary>
        <form action={updateDraft.bind(null, m.id)} className="stack" style={{ gap: 10, marginTop: 10 }}>
          <label className="field"><span>Subject</span><input name="subject" defaultValue={m.subject} /></label>
          <label className="field"><span>Body</span><textarea name="body" rows={12} defaultValue={m.body} /></label>
          <div className="row" style={{ justifyContent: "flex-end" }}><Submit className="btn btn-sm btn-primary" pending="Saving…">Save</Submit></div>
        </form>
      </details>
      <div className="row actions">
        <OpenInOutlook to={to} subject={m.subject} body={m.body} />
        <form className="inline" action={markSent.bind(null, m.id)}><button className="btn btn-sm">Mark sent</button></form>
        <form className="inline" action={deleteDraft.bind(null, m.id)}><button className="btn btn-sm btn-ghost">Delete</button></form>
      </div>
    </>
  );
}
