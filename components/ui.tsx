import { setStatus, snoozeFollowup } from "@/app/actions";
import type { getContact } from "@/lib/data";
import { label, safeUrl, TYPES } from "@/lib/format";

/** Read-only contact facts. Shared by the Contact and Drafts pages. */
export function ContactDetails({ c }: { c: NonNullable<Awaited<ReturnType<typeof getContact>>> }) {
  return (
    <dl className="kv">
      <div><dt>Email</dt><dd>{c.email || <span className="muted">None</span>}</dd></div>
      <div><dt>LinkedIn</dt><dd>{!c.linkedinUrl ? <span className="muted">None</span>
        // "#" means not a real URL (e.g. "Profile" from a sheet): a link would only reopen this page.
        : safeUrl(c.linkedinUrl) === "#" ? c.linkedinUrl
        : <a href={safeUrl(c.linkedinUrl)} target="_blank" rel="noopener">{c.linkedinUrl.replace("https://", "").replace("www.", "")}</a>}</dd></div>
      <div><dt>Type</dt><dd>{c.type || "—"}</dd></div>
      <div><dt>Team</dt><dd>{c.team || "—"}</dd></div>
      <div><dt>Gender</dt><dd>{c.gender ? label(c.gender) : "—"}</dd></div>
      <div><dt>Location</dt><dd>{c.location || "—"}</dd></div>
      <div><dt>School</dt><dd>{[c.school, c.program, c.gradYear].filter(Boolean).join(" · ") || "—"}</dd></div>
      <div><dt>How connected</dt><dd>{c.howConnected || "—"}</dd></div>
      <div><dt>Source</dt><dd>{c.attributes.source || label(c.source)}</dd></div>
      <div><dt>Notes</dt><dd><pre>{c.notes || "—"}</pre></dd></div>
    </dl>
  );
}

/** Manage a pending follow-up: remind later, dismiss, or record a reply. Shared by Today and Drafts. */
export function FollowupActions({ id }: { id: number }) {
  return (
    <>
      <form className="inline" action={snoozeFollowup.bind(null, id)}>
        <select name="days" aria-label="Remind me" defaultValue="3" className="btn-sm">
          <option value="1">Tomorrow</option>
          <option value="3">In 3 days</option>
          <option value="7">In 1 week</option>
          <option value="14">In 2 weeks</option>
        </select>
        <button className="btn btn-sm">Remind me</button>
        <button className="btn btn-sm btn-ghost" name="dismiss" value="1" title="Stop reminding; contact stays sent">Dismiss</button>
      </form>
      <form className="inline" action={setStatus.bind(null, id)}>
        <button className="btn btn-sm btn-ghost" name="status" value="replied">Replied</button>
      </form>
    </>
  );
}

/** Dropdown over fixed options (grouped when keys are non-empty). A saved value not in the list stays as its own choice. */
export function Choice({ name, value, groups }: { name: string; value: string; groups: Record<string, readonly string[]> }) {
  const known = Object.values(groups).flat().includes(value);
  const opts = (xs: readonly string[]) => xs.map((x) => <option key={x} value={x}>{x}</option>);
  return (
    <select name={name} defaultValue={value}>
      <option value="">Not set</option>
      {value && !known && <option value={value}>{value} (old)</option>}
      {Object.entries(groups).map(([g, xs]) => (g ? <optgroup key={g} label={g}>{opts(xs)}</optgroup> : opts(xs)))}
    </select>
  );
}

export function Pill({ status, text }: { status: string; text?: string }) {
  return <span className={`pill s-${status}`}>{text ?? label(status)}</span>;
}

type Values = Partial<Record<"name" | "company" | "title" | "email" | "linkedinUrl" | "howConnected" | "notes"
  | "type" | "team" | "school" | "program" | "gradYear" | "gender" | "location", string | number | null>> & { attributes?: Record<string, string> };

/** Shared by Add contact, Edit details, and the parsed-profile form. */
export function ContactFormFields({ v = {}, notes = false }: { v?: Values; notes?: boolean }) {
  const d = (k: keyof Values) => (v[k] ?? "").toString();
  return (
    <div className="form-grid">
      <label className="field"><span>Name</span><input name="name" defaultValue={d("name")} required /></label>
      <label className="field"><span>Company</span><input name="company" defaultValue={d("company")} /></label>
      <label className="field"><span>Title</span><input name="title" defaultValue={d("title")} /></label>
      <label className="field"><span>Type <span className="hint">their line of work</span></span>
        <Choice name="type" value={d("type")} groups={{ "": TYPES }} /></label>
      <label className="field"><span>Team <span className="hint">group or desk, e.g. TMT, Rates</span></span><input name="team" defaultValue={d("team")} /></label>
      <label className="field"><span>Gender <span className="hint">sets Mr./Ms. for VPs and above</span></span>
        <select name="gender" defaultValue={d("gender")}>
          <option value="">Not set</option><option value="woman">Woman (Ms.)</option>
          <option value="man">Man (Mr.)</option><option value="nonbinary">Non-binary (full name)</option>
        </select></label>
      <label className="field"><span>Location</span><input name="location" defaultValue={d("location")} placeholder="e.g. Toronto" /></label>
      <label className="field"><span>Email</span><input name="email" type="email" defaultValue={d("email")} /></label>
      <label className="field"><span>LinkedIn URL</span><input name="linkedinUrl" defaultValue={d("linkedinUrl")} /></label>
      <label className="field"><span>School</span><input name="school" defaultValue={d("school")} /></label>
      <label className="field"><span>Program</span><input name="program" defaultValue={d("program")} /></label>
      <label className="field"><span>Grad year</span><input name="gradYear" inputMode="numeric" defaultValue={d("gradYear")} /></label>
      <label className="field"><span>How connected</span><input name="howConnected" defaultValue={d("howConnected")} placeholder="e.g. Waterloo alum" /></label>
      {notes && <label className="field full"><span>Notes</span><textarea name="notes" rows={3} defaultValue={d("notes")} /></label>}
      {v.attributes && (
        <label className="field full"><span>Custom fields <span className="hint">one per line, like city: Toronto; usable as graph levels</span></span>
          <textarea name="attributes" rows={3} defaultValue={Object.entries(v.attributes).map(([k, x]) => `${k}: ${x}`).join("\n")} /></label>
      )}
    </div>
  );
}
