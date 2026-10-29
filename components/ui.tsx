import type { getContact } from "@/lib/data";
import { label, safeUrl } from "@/lib/format";

/** Read-only contact facts. Shared by the Contact and Drafts pages. */
export function ContactDetails({ c }: { c: NonNullable<Awaited<ReturnType<typeof getContact>>> }) {
  return (
    <dl className="kv">
      <div><dt>Email</dt><dd>{c.email || <span className="muted">None</span>}</dd></div>
      <div><dt>LinkedIn</dt><dd>{!c.linkedinUrl ? <span className="muted">None</span>
        // "#" means not a real URL (e.g. "Profile" from a sheet): a link would only reopen this page.
        : safeUrl(c.linkedinUrl) === "#" ? c.linkedinUrl
        : <a href={safeUrl(c.linkedinUrl)} target="_blank" rel="noopener">{c.linkedinUrl.replace("https://", "").replace("www.", "")}</a>}</dd></div>
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

export function Pill({ status, text }: { status: string; text?: string }) {
  return <span className={`pill s-${status}`}>{text ?? label(status)}</span>;
}

type Values = Partial<Record<"name" | "company" | "title" | "email" | "linkedinUrl" | "howConnected" | "notes"
  | "team" | "school" | "program" | "gradYear" | "gender" | "location", string | number | null>> & { attributes?: Record<string, string> };

/** Shared by Add contact, Edit details, and the parsed-profile form. */
export function ContactFormFields({ v = {}, notes = false }: { v?: Values; notes?: boolean }) {
  const d = (k: keyof Values) => (v[k] ?? "").toString();
  return (
    <div className="form-grid">
      <label className="field"><span>Name</span><input name="name" defaultValue={d("name")} required /></label>
      <label className="field"><span>Company</span><input name="company" defaultValue={d("company")} /></label>
      <label className="field"><span>Title</span><input name="title" defaultValue={d("title")} /></label>
      <label className="field"><span>Team</span><input name="team" defaultValue={d("team")} /></label>
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
