"use client";
import Link from "next/link";
import { useActionState, useRef } from "react";
import { importLinkedin, importSheet, type ImportState } from "@/app/actions";
import { Submit } from "@/components/client";
import { label } from "@/lib/format";

export function ImportClient({ fields }: { fields: readonly string[] }) {
  const [li, runLinkedin] = useActionState<ImportState, FormData>(importLinkedin, null);
  const [sheet, runSheet] = useActionState<ImportState, FormData>(importSheet, null);
  // The browser keeps the spreadsheet and sends it again with the sheet choice and the mapping.
  const fileRef = useRef<File | null>(null);
  const withFile = (fd: FormData) => {
    const f = fd.get("file");
    if (f instanceof File && f.size) fileRef.current = f;
    else if (fileRef.current) fd.set("file", fileRef.current);
    runSheet(fd);
  };
  const report = li?.report ?? sheet?.report;
  const t = sheet?.table;

  if (report) {
    return (
      <>
        <div className="stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <div className="stat"><div className="k">Added</div><div className="v">{report.added}</div></div>
          <div className="stat"><div className="k">Skipped (duplicates)</div><div className="v">{report.skipped}</div></div>
          <div className={`stat ${report.failed.length ? "attn" : ""}`}><div className="k">Failed</div><div className="v">{report.failed.length}</div></div>
        </div>
        {report.failed.length > 0 && (
          <section className="card" style={{ marginBottom: 20 }}>
            <div className="card-head"><h2>Rows that failed</h2></div>
            <ul className="list">{report.failed.map((f) => <li key={f} className="small">{f}</li>)}</ul>
          </section>
        )}
        <div className="row">
          <Link className="btn btn-primary" href="/contacts">See contacts</Link>
          <a className="btn" href="/import">Import more</a>
        </div>
      </>
    );
  }

  if (t) {
    return (
      <section className="card">
        <div className="card-head">
          <h2>Match columns</h2>
          {t.sheets.length > 1 && (
            <form action={withFile} className="row">
              <label className="muted small" htmlFor="sheet">Sheet</label>
              <select id="sheet" name="sheet" defaultValue={t.sheet} onChange={(e) => e.currentTarget.form?.requestSubmit()} style={{ width: "auto", height: 28 }}>
                {t.sheets.map((s) => <option key={s}>{s}</option>)}
              </select>
            </form>
          )}
        </div>
        {sheet?.error && <p className="note card-body" role="alert">{sheet.error}</p>}
        <form action={withFile} key={t.sheet}>
          <input type="hidden" name="sheet" value={t.sheet} />
          <input type="hidden" name="step" value="import" />
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Column in file</th><th>Contact field</th><th>Example</th></tr></thead>
              <tbody>
                {t.headers.map((h, i) => (
                  <tr key={`${h}-${i}`}>
                    <td className="name">{h}</td>
                    <td>
                      <select name={`map_${i}`} defaultValue={t.mapping[h] ?? ""} aria-label={`Field for ${h}`} style={{ width: "auto", minWidth: 160 }}>
                        <option value="">Skip</option>
                        {fields.map((f) => <option key={f} value={f}>{label(f)}</option>)}
                      </select>
                    </td>
                    <td className="sub">{t.preview[h] ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-body row" style={{ borderTop: "1px solid var(--line-soft)" }}>
            <p className="muted small spacer">Map <b>name</b>, or both <b>first name</b> and <b>last name</b>.</p>
            <a className="btn btn-ghost" href="/import">Cancel</a>
            <Submit className="btn btn-primary" pending="Importing…">Import</Submit>
          </div>
        </form>
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head"><h2>LinkedIn connections</h2></div>
        <form action={runLinkedin} className="card-body">
          <p className="muted small">LinkedIn → Settings → Data privacy → Get a copy of your data → Connections. Upload the <code>Connections.csv</code> it emails you.</p>
          {li?.error && <p className="note" role="alert">{li.error}</p>}
          <div className="row">
            <input type="file" name="file" accept=".csv" required aria-label="Connections.csv" style={{ flex: 1, width: "auto" }} />
            <Submit className="btn btn-primary" pending="Importing…">Import</Submit>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-head"><h2>Any spreadsheet</h2><span className="meta">e.g. a PitchBook export</span></div>
        <form action={withFile} className="card-body">
          <p className="muted small">Upload an <code>.xlsx</code> or <code>.csv</code>. You&apos;ll match its columns to contact fields next; the mapping is remembered.</p>
          {sheet?.error && <p className="note" role="alert">{sheet.error}</p>}
          <div className="row">
            <input type="file" name="file" accept=".xlsx,.csv" required aria-label="Spreadsheet" style={{ flex: 1, width: "auto" }} />
            <Submit className="btn btn-primary" pending="Reading…">Upload</Submit>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-head"><h2>Export</h2></div>
        <div className="card-body row">
          <p className="muted small spacer">Everything in one <code>.xlsx</code>, one sheet per table.</p>
          <a className="btn" href="/export">Download .xlsx</a>
        </div>
      </section>
    </div>
  );
}
