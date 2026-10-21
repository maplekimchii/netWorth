"use client";
import { useActionState, useState } from "react";
import { draftWithAI, saveDraft, type Draft, type DraftState } from "@/app/actions";
import { Submit } from "@/components/client";

type Template = { id: number; name: string; kind: "initial" | "followup" };

export function DraftEditor({ contactId, templates, preferredId }: {
  contactId: number; templates: Template[]; preferredId?: number;
}) {
  const preferredKind = templates.find((t) => t.id === preferredId)?.kind ?? "initial";
  const [state, run] = useActionState<DraftState, FormData>(draftWithAI.bind(null, contactId), null);
  const [blank, setBlank] = useState<Draft | null>(null);
  const d = blank ?? state?.draft;
  return (
    <div className="card-body">
      <form action={(fd) => { setBlank(null); run(fd); }} className="row">
        <select name="templateId" defaultValue={preferredId} aria-label="Template" style={{ flex: 1, width: "auto" }}>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <Submit className="btn btn-primary" pending="Drafting…">Draft with AI</Submit>
        <button type="button" className="btn btn-ghost"
          onClick={() => setBlank({ subject: "", body: "", kind: preferredKind, unfilled: [] })}>Write it myself</button>
      </form>
      {state?.error && <p className="note" role="alert">{state.error}</p>}
      {d && (
        // key resets the fields when a new draft arrives
        <form key={blank ? "blank" : d.subject + d.body} action={saveDraft.bind(null, contactId)} className="stack" style={{ gap: 12 }}>
          {d.unfilled.length > 0 && <p className="note">Not filled in yet: {d.unfilled.join(", ")}</p>}
          <input type="hidden" name="kind" value={d.kind} />
          <label className="field"><span>Subject</span><input name="subject" defaultValue={d.subject} /></label>
          <label className="field"><span>Body</span><textarea name="body" rows={14} defaultValue={d.body} /></label>
          <div className="row" style={{ justifyContent: "flex-end" }}><Submit className="btn btn-primary">Save draft</Submit></div>
        </form>
      )}
    </div>
  );
}
