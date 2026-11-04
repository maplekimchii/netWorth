"use client";
// One unsent draft, edited in place like an inbox: subject and body are always editable.
// Saves on the Save button, Cmd/Ctrl+S, and when a field loses focus. Used on Contact and Drafts pages.
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import { deleteDraft, markSent, updateDraft } from "@/app/actions";
import type { ChatEvent } from "@/app/api/draft-chat/route";
import type { ChatTurn } from "@/lib/ai";
import { parseEdit } from "@/lib/templating";
import { OpenInOutlook } from "./client";

const noop = () => () => {};

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

  const chat = <DraftChat id={m.id} subject={subject} body={body}
    apply={(s, b) => { setSubject(s); setBody(b); }} />;
  // On the Drafts page the chat sits in the side column (#draft-chat); elsewhere it goes under the editor.
  const slot = useSyncExternalStore(noop, () => document.getElementById("draft-chat"), () => null);

  return (
    <>
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
    {slot ? createPortal(chat, slot) : <div style={{ marginTop: 16 }}>{chat}</div>}
    </>
  );
}

type Turn = ChatTurn & { steps?: string[]; thinking?: string; error?: boolean };

/** Chat with the AI about one draft. Replies stream in: steps, thinking, the note, and the draft itself,
 * which rewrites the editor live (unsaved, with Undo).
 * ponytail: chat history lives in memory only and resets when you switch drafts; store it if it's ever missed. */
function DraftChat({ id, subject, body, apply }: {
  id: number; subject: string; body: string; apply: (subject: string, body: string) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [undo, setUndo] = useState<{ subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { log.current?.scrollTo(0, log.current.scrollHeight); }, [turns]);

  const ask = async () => {
    const request = input.trim();
    if (!request || busy) return;
    const history = turns.filter((t) => !t.error).map(({ role, text }) => ({ role, text }));
    const before = { subject, body };
    const ctl = new AbortController();
    setInput(""); setBusy(ctl);
    setTurns((t) => [...t, { role: "me", text: request }, { role: "ai", text: "", steps: [], thinking: "" }]);
    const update = (f: (t: Turn) => Turn) => setTurns((ts) => [...ts.slice(0, -1), f(ts[ts.length - 1])]);

    let raw = "";
    try {
      const res = await fetch("/api/draft-chat", {
        method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: id, subject, body, history, request }),
      });
      // A signed-out request is redirected to the login page, which is HTML, not our stream.
      if (!res.body || !res.headers.get("content-type")?.includes("ndjson")) throw new Error("Signed out: reload and sign in.");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines.filter(Boolean)) {
          const e = JSON.parse(line) as ChatEvent;
          if (e.type === "step") update((t) => ({ ...t, steps: [...(t.steps ?? []), e.text] }));
          else if (e.type === "thinking") update((t) => ({ ...t, thinking: (t.thinking ?? "") + e.text }));
          else if (e.type === "error") update((t) => ({ ...t, text: e.text, error: true }));
          else {
            raw += e.text;
            const p = parseEdit(raw);
            update((t) => ({ ...t, text: p.reply }));
            if (p.subject !== undefined) { setUndo(before); apply(p.subject, p.body ?? before.body); }
          }
        }
      }
    } catch (err) {
      const msg = ctl.signal.aborted ? "Stopped." : (err as Error).message;
      update((t) => ({ ...t, text: t.text ? `${t.text}\n(${msg})` : msg, error: !t.text }));
    }
    setBusy(null);
  };

  return (
    <section className="card chat" aria-labelledby="chat-h">
      <div className="card-head">
        <h2 id="chat-h">Edit with AI</h2>
        {undo && <button type="button" className="btn btn-sm btn-ghost" disabled={!!busy}
          onClick={() => { apply(undo.subject, undo.body); setUndo(null); }}>Undo last edit</button>}
      </div>
      <div className="chat-log" ref={log} aria-live="polite">
        {!turns.length && <p className="muted small">Ask for changes, e.g. &quot;shorter&quot;, &quot;warmer opening&quot;, or &quot;mention their Series B&quot;. Edits land in the draft; save when you like them.</p>}
        {turns.map((t, i) => t.role === "me" ? <div key={i} className="chat-msg me">{t.text}</div> : (
          <div key={i} className="chat-ai">
            {t.steps?.map((s, j) => <div key={j} className="chat-step">✓ {s}</div>)}
            {t.thinking && <details className="chat-step"><summary>{busy && i === turns.length - 1 && !t.text ? "Thinking…" : "Thought"}</summary>
              <div className="chat-thinking">{t.thinking}</div></details>}
            {busy && i === turns.length - 1 && !t.text && !t.thinking && <div className="chat-step">Working…</div>}
            {t.text && <div className={`chat-msg ai${t.error ? " error" : ""}`} role={t.error ? "alert" : undefined}>{t.text}</div>}
          </div>
        ))}
      </div>
      <div className="chat-input">
        <textarea aria-label="Message to AI" rows={2} placeholder="Ask the AI to change this draft" value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); } }} />
        {busy ? <button type="button" className="btn btn-sm" onClick={() => busy.abort()}>Stop</button>
          : <button type="button" className="btn btn-sm btn-primary" disabled={!input.trim()} onClick={() => void ask()}>Send</button>}
      </div>
    </section>
  );
}
