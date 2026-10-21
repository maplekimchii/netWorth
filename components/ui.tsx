import { label } from "@/lib/format";

export function Pill({ status, text }: { status: string; text?: string }) {
  return <span className={`pill s-${status}`}>{text ?? label(status)}</span>;
}

type Values = Partial<Record<"name" | "company" | "title" | "email" | "linkedinUrl" | "howConnected" | "notes"
  | "team" | "school" | "program" | "gradYear", string | number | null>> & { attributes?: Record<string, string> };

/** Shared by Add contact, Edit details, and the parsed-profile form. */
export function ContactFormFields({ v = {}, notes = false }: { v?: Values; notes?: boolean }) {
  const d = (k: keyof Values) => (v[k] ?? "").toString();
  return (
    <div className="form-grid">
      <label className="field"><span>Name</span><input name="name" defaultValue={d("name")} required /></label>
      <label className="field"><span>Company</span><input name="company" defaultValue={d("company")} /></label>
      <label className="field"><span>Title</span><input name="title" defaultValue={d("title")} /></label>
      <label className="field"><span>Team</span><input name="team" defaultValue={d("team")} /></label>
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
