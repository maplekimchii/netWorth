"use client";
import { useActionState, useState } from "react";
import { addContact, addFound, findPeople, parseProfile, type FindState, type ParseState } from "@/app/actions";
import { Submit } from "@/components/client";
import { ContactFormFields, Pill } from "@/components/ui";
import { safeUrl } from "@/lib/format";

export function FindClient() {
  const [found, search] = useActionState<FindState, FormData>(findPeople, null);
  const [parsed, parse] = useActionState<ParseState, FormData>(parseProfile, null);
  const people = found?.people ?? [];
  const [unpicked, setUnpicked] = useState<Set<number>>(new Set());
  const picked = people.filter((p, i) => !p.saved && !unpicked.has(i)).length;
  const savedCount = people.filter((p) => p.saved).length;
  const toggle = (i: number) => setUnpicked((s) => {
    const n = new Set(s);
    if (!n.delete(i)) n.add(i);
    return n;
  });

  return (
    <div className="stack">
      <section className="card">
        <form action={(fd) => { setUnpicked(new Set()); search(fd); }} className="card-body row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ flex: "1 1 180px" }}><span>Company</span><input name="company" required placeholder="e.g. Stripe" /></label>
          <label className="field" style={{ flex: "2 1 240px" }}><span>Focus</span><input name="focus" placeholder="e.g. PM, Waterloo alumni, recruiters" /></label>
          <Submit className="btn btn-primary" pending="Searching…">Search</Submit>
        </form>
        {found?.error && <p className="note card-body" role="alert">{found.error}</p>}
      </section>

      {people.length > 0 && (
        <form action={addFound} className="card">
          <div className="card-head">
            <h2>{people.length} found{savedCount > 0 && <span className="muted" style={{ fontWeight: 400 }}> · {savedCount} already saved</span>}</h2>
            {savedCount < people.length && <Submit className="btn btn-primary btn-sm" disabled={!picked}>Add {picked} to contacts</Submit>}
          </div>
          <ul className="list">
            {people.map((p, i) => (
              <li key={`${p.name}-${i}`} className={p.saved ? "dim" : ""}>
                {p.saved ? <input type="checkbox" disabled aria-label={`${p.name} already saved`} />
                  : <input type="checkbox" name="pick" value={JSON.stringify(p)} id={`pick-${i}`} checked={!unpicked.has(i)} onChange={() => toggle(i)} />}
                <label className="grow" htmlFor={`pick-${i}`}>
                  <span className="title">{p.name}</span>{p.title && <span className="muted"> · {p.title}</span>}
                  {p.why_relevant && <div className="sub">{p.why_relevant}</div>}
                </label>
                {p.saved && <Pill status="to_contact" text="already saved" />}
                <span className="row small">
                  {p.source_url && <a href={safeUrl(p.source_url)} target="_blank" rel="noopener">Source</a>}
                  {p.linkedin_url && <a href={safeUrl(p.linkedin_url)} target="_blank" rel="noopener">LinkedIn</a>}
                </span>
              </li>
            ))}
          </ul>
        </form>
      )}

      <section className="card" aria-labelledby="paste-h">
        <div className="card-head"><h2 id="paste-h">Paste a profile</h2><span className="meta">On LinkedIn: select all, copy, paste</span></div>
        <form action={parse} className="card-body">
          <label className="field"><span>Profile text</span><textarea name="text" rows={6} required /></label>
          <div className="form-actions"><Submit pending="Extracting…">Extract details</Submit></div>
        </form>
        {parsed?.error && <p className="note card-body" role="alert">{parsed.error}</p>}
        {parsed?.parsed && (
          <form key={JSON.stringify(parsed.parsed)} action={addContact} className="card-body" style={{ borderTop: "1px solid var(--line-soft)" }}>
            <input type="hidden" name="source" value="paste" />
            <ContactFormFields notes v={{ ...parsed.parsed, linkedinUrl: parsed.parsed.linkedin_url, gradYear: parsed.parsed.grad_year }} />
            <div className="form-actions"><button className="btn btn-primary">Save contact</button></div>
          </form>
        )}
      </section>
    </div>
  );
}
