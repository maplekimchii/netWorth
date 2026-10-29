"use client";
// One unsent draft, edited in place like an inbox: subject and body are always editable.
// Saves on the Save button, Cmd/Ctrl+S, and when a field loses focus. Used on Contact and Drafts pages.
import { useEffect, useState, useTransition } from "react";
import { deleteDraft, markSent, updateDraft } from "@/app/actions";
import { OpenInOutlook } from "./client";

export function DraftControls({ m, to }: { m: { id: number; subject: string; body: string }; to: string }) {
  const [subject, setSubject] = useState(m.subject);
  const [body, setBody] = useState(m.body);
  const [saved, setSaved] = useState({ subject: m.subject, body: m.body });
  const [pending, start] = useTransition();
  const dirty = subject !== saved.subject || body !== saved.body;

  const persist = async () => {
    if (!dirty) return;
    await updateDraft(m.id, subject, body);
    setSaved({ subject, body });
  };
  const save = () => start(persist);
  const send = () => start(async () => { await persist(); await markSent(m.id); });

  // Warn before closing the tab with unsaved text (in-app links blur the field first, which saves).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <div className="email-editor" onKeyDown={(e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
    }}>
      <input className="email-subject" aria-label="Subject" placeholder="Subject" value={subject}
        onChange={(e) => setSubject(e.target.value)} onBlur={save} />
      <textarea className="email-body" aria-label="Body" value={body} rows={12}
        onChange={(e) => setBody(e.target.value)} onBlur={save} />
      <div className="row actions">
        <button type="button" className="btn btn-sm btn-primary" disabled={!dirty || pending} onClick={save}>
          {pending ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
        {/* Opening Outlook counts as sending: it saves and marks the draft sent in one click. */}
        <span onClick={send}><OpenInOutlook to={to} subject={subject} body={body} /></span>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={send}>Mark sent</button>
        <span className="spacer" />
        <button type="button" className="btn btn-sm btn-ghost" disabled={pending}
          onClick={() => confirm("Delete this draft?") && start(() => deleteDraft(m.id))}>Delete</button>
      </div>
    </div>
  );
}
