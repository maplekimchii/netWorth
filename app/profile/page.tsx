import { saveProfile } from "@/app/actions";
import { getProfile } from "@/lib/data";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  await requireUser();
  const p = await getProfile();
  return (
    <div className="page-narrow">
      <div className="page-head">
        <div><h1>Profile</h1><p className="sub">The AI uses this for every draft. The more specific, the better the emails.</p></div>
      </div>
      <form action={saveProfile} className="stack">
        <section className="card">
          <div className="card-head"><h2>About you</h2></div>
          <div className="card-body form-grid">
            <label className="field"><span>Your name</span><input name="name" defaultValue={p.name} /></label>
            <label className="field"><span>Program</span><input name="program" defaultValue={p.program} placeholder="e.g. Computer Science" /></label>
            <label className="field full"><span>Target roles <span className="hint">comma separated; the first fills {"{target_role}"}</span></span>
              <input name="targetRoles" defaultValue={p.targetRoles} placeholder="Product Manager, Software Engineer" /></label>
            <label className="field full"><span>Your story <span className="hint">2–4 sentences</span></span>
              <textarea name="story" rows={4} defaultValue={p.story} /></label>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>Writing material</h2></div>
          <div className="card-body">
            <label className="field"><span>Voice samples <span className="hint">1–2 emails you wrote yourself; the AI copies their tone</span></span>
              <textarea name="voiceSamples" rows={8} defaultValue={p.voiceSamples} /></label>
            <label className="field"><span>Resume <span className="hint">paste as text</span></span>
              <textarea name="resumeText" rows={10} defaultValue={p.resumeText} /></label>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>Follow-ups</h2></div>
          <div className="card-body form-grid">
            <label className="field"><span>Days before a follow-up is due</span>
              <input name="followupDays" type="number" min={1} defaultValue={p.followupDays} /></label>
          </div>
        </section>
        <div className="form-actions" style={{ marginTop: 0 }}><button className="btn btn-primary">Save profile</button></div>
      </form>
    </div>
  );
}
