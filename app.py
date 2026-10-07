"""netWorth: a local networking CRM for a job search."""
import datetime as dt
import io
import os
from pathlib import Path
from urllib.parse import urlparse

import anthropic
import requests
from dotenv import load_dotenv
from flask import Flask, abort, flash, g, redirect, render_template, request, send_file, url_for
from werkzeug.utils import secure_filename

load_dotenv()

import ai  # noqa: E402  (after load_dotenv so modules read .env)
import db  # noqa: E402
import importers  # noqa: E402
import outlook  # noqa: E402

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET", "local-only")
app.config["DB_PATH"] = db.DB_PATH
UPLOAD_DIR = Path(__file__).with_name("uploads")
PROFILE_FIELDS = ("name", "program", "resume_text", "story", "target_roles", "voice_samples", "followup_days")
# ponytail: single-user app, so the last AI search lives in memory until the next search or restart.
last_search = []


@app.before_request
def same_origin_only():
    """Block other websites from posting to this unauthenticated local app (spending API credits, planting drafts)."""
    if request.method != "POST":
        return None
    site = request.headers.get("Sec-Fetch-Site")
    origin = request.headers.get("Origin")
    if (site and site not in ("same-origin", "none")) or (origin and urlparse(origin).netloc != request.host):
        abort(403)
    return None


@app.template_filter("safe_url")
def safe_url(url):
    """Only http(s) links reach an href; AI- or import-supplied javascript: URLs become '#'."""
    url = (url or "").strip()
    return url if url.lower().startswith(("http://", "https://")) else "#"


def con():
    if "con" not in g:
        g.con = db.connect(app.config["DB_PATH"])
    return g.con


@app.teardown_appcontext
def close_db(exc):
    c = g.pop("con", None)
    if c is not None:
        if exc is None:
            c.commit()
        c.close()


def now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def back(default):
    return redirect(request.referrer or url_for(default))


def guarded(fn, *args, **kwargs):
    """Run a Claude or Outlook call. On failure, flash the reason and return None."""
    try:
        return fn(*args, **kwargs)
    except outlook.NotConnected:
        flash("Outlook is not connected. Use 'Connect Outlook' on the Today page.")
    except (ai.AIError, anthropic.APIError, outlook.OutlookError, requests.RequestException) as e:
        flash(f"Error: {e}")
    return None


def companies():
    return con().execute("SELECT id, name FROM companies ORDER BY name").fetchall()


# --- Today and Outlook ---

@app.get("/")
def today_page():
    connected = outlook.enabled() and outlook.is_connected()
    if connected:
        guarded(outlook.sync, con())
    return render_template("today.html", view=db.today_view(con(), dt.date.today()),
                           outlook_enabled=outlook.enabled(), connected=connected, login=outlook.login_state)


@app.post("/sync")
def sync_now():
    if guarded(outlook.sync, con(), force=True):
        flash("Synced with Outlook.")
    return redirect(url_for("today_page"))


@app.post("/outlook/connect")
def outlook_connect():
    guarded(outlook.start_login)
    return redirect(url_for("today_page"))


# --- Contacts ---

@app.get("/contacts")
def contacts_page():
    a = request.args
    rows = db.list_contacts(con(), a.get("status"), a.get("company_id", type=int), a.get("source"))
    return render_template("contacts.html", contacts=rows, companies=companies(), statuses=db.STATUSES,
                           sources=db.SOURCES, args=a)


@app.post("/contacts")
def contact_add():
    f = request.form.to_dict()
    name, source = f.pop("name", ""), f.pop("source", "paste")
    if source not in db.SOURCES:
        abort(400)
    try:
        cid = db.add_contact(con(), name, source, **f)
    except ValueError as e:
        flash(str(e))
        return back("contacts_page")
    if cid is None:
        flash(f"{name} at {f.get('company') or 'no company'} is already saved.")
        return back("contacts_page")
    return redirect(url_for("contact_page", cid=cid))


def render_contact(cid, draft=None):
    c = db.get_contact(con(), cid) or abort(404)
    messages = con().execute("SELECT * FROM messages WHERE contact_id = ? ORDER BY id", (cid,)).fetchall()
    tpls = con().execute("SELECT * FROM email_templates ORDER BY kind, name").fetchall()
    return render_template("contact.html", c=c, messages=messages, templates=tpls, statuses=db.STATUSES,
                           draft=draft, mailto=outlook.mailto_link, outlook_enabled=outlook.enabled())


@app.get("/contacts/<int:cid>")
def contact_page(cid):
    return render_contact(cid)


@app.post("/contacts/<int:cid>")
def contact_update(cid):
    db.update_contact(con(), cid, request.form)
    flash("Saved.")
    return redirect(url_for("contact_page", cid=cid))


@app.post("/contacts/<int:cid>/status")
def contact_status(cid):
    db.set_status(con(), cid, request.form["status"])
    return back("contacts_page")


@app.post("/contacts/<int:cid>/draft")
def contact_draft(cid):
    c = db.get_contact(con(), cid) or abort(404)
    tpl = con().execute("SELECT * FROM email_templates WHERE id = ?", (request.form["template_id"],)).fetchone() or abort(404)
    company = con().execute("SELECT * FROM companies WHERE id = ?", (c["company_id"],)).fetchone()
    prior = con().execute("SELECT subject, body, sent_at FROM messages WHERE contact_id = ? ORDER BY id", (cid,)).fetchall()
    result = guarded(ai.draft, dict(tpl), db.get_profile(con()), dict(c), dict(company) if company else None,
                     [dict(m) for m in prior])
    if result is None:
        return render_contact(cid)
    subject, body = result
    return render_contact(cid, draft={"subject": subject, "body": body, "kind": tpl["kind"],
                                      "unfilled": ai.unfilled(subject + "\n" + body)})


@app.post("/contacts/<int:cid>/save_draft")
def contact_save_draft(cid):
    c = db.get_contact(con(), cid) or abort(404)
    f = request.form
    if not c["email"]:
        flash("No email on file for this contact. Add the recipient in Outlook before sending.")
    ids = (None, None)
    if f["action"] == "outlook":
        ids = guarded(outlook.create_draft, c["email"], f["subject"], f["body"]) or (None, None)
        flash("Draft created in Outlook. Review and send it there." if ids[0]
              else "Saved here instead. Use 'Open in Outlook' on the message below.")
    db.record_draft(con(), cid, f["kind"], f["subject"], f["body"], *ids)
    return redirect(url_for("contact_page", cid=cid))


@app.post("/messages/<int:mid>/sent")
def message_sent(mid):
    db.mark_sent(con(), mid, now_iso())
    return back("today_page")


@app.post("/messages/<int:mid>/replied")
def message_replied(mid):
    db.mark_replied(con(), mid, now_iso())
    return back("today_page")


# --- Companies ---

@app.get("/companies")
def companies_page():
    rows = con().execute("SELECT co.*, COUNT(c.id) AS people FROM companies co "
                         "LEFT JOIN contacts c ON c.company_id = co.id GROUP BY co.id ORDER BY co.priority, co.name").fetchall()
    return render_template("companies.html", companies=rows)


@app.post("/companies")
def company_add():
    coid = db.get_or_create_company(con(), request.form["name"])
    return redirect(url_for("company_page", coid=coid) if coid else url_for("companies_page"))


@app.get("/companies/<int:coid>")
def company_page(coid):
    co = con().execute("SELECT * FROM companies WHERE id = ?", (coid,)).fetchone() or abort(404)
    apps = con().execute("SELECT a.*, c.name AS referrer FROM applications a "
                         "LEFT JOIN contacts c ON c.id = a.referrer_contact_id WHERE a.company_id = ?", (coid,)).fetchall()
    return render_template("company.html", co=co, people=db.list_contacts(con(), company_id=coid), apps=apps)


@app.post("/companies/<int:coid>")
def company_update(coid):
    f = request.form
    con().execute("UPDATE companies SET domain = ?, priority = ?, notes = ? WHERE id = ?",
                  (f.get("domain", ""), f.get("priority", 2, type=int), f.get("notes", ""), coid))
    flash("Saved.")
    return redirect(url_for("company_page", coid=coid))


@app.post("/companies/<int:coid>/news")
def company_news(coid):
    co = con().execute("SELECT name FROM companies WHERE id = ?", (coid,)).fetchone() or abort(404)
    news = guarded(ai.research_company, co["name"])
    if news is not None:
        con().execute("UPDATE companies SET news = ?, news_updated_at = ? WHERE id = ?", (news, now_iso(), coid))
    return redirect(url_for("company_page", coid=coid))


# --- Find ---

@app.get("/find")
def find_page():
    return render_template("find.html", results=last_search, parsed=None)


@app.post("/find/search")
def find_search():
    company = request.form["company"].strip()
    people = guarded(ai.find_people, company, request.form.get("focus", ""), db.get_profile(con()))
    if people is not None:
        last_search[:] = [dict(p, company=company, saved=False) for p in people]
        if not people:
            flash("No people found. Try a broader focus.")
    return redirect(url_for("find_page"))


@app.post("/find/save/<int:i>")
def find_save(i):
    if i >= len(last_search):
        abort(404)
    p = last_search[i]
    notes = f"{p.get('why_relevant') or ''}\nSource: {p.get('source_url') or ''}".strip()
    cid = db.add_contact(con(), p["name"], "ai_search", company=p["company"], title=p.get("title") or "",
                         linkedin_url=p.get("linkedin_url") or "", notes=notes)
    p["saved"] = True
    if cid is None:
        flash(f"{p['name']} is already saved.")
    return redirect(url_for("find_page"))


@app.post("/find/parse")
def find_parse():
    parsed = guarded(ai.parse_profile, request.form["text"])
    return render_template("find.html", results=last_search, parsed=parsed)


# --- Applications ---

@app.get("/applications")
def applications_page():
    rows = con().execute("SELECT a.*, co.name AS company, c.name AS referrer FROM applications a "
                         "JOIN companies co ON co.id = a.company_id "
                         "LEFT JOIN contacts c ON c.id = a.referrer_contact_id ORDER BY a.updated_at DESC").fetchall()
    contacts = con().execute("SELECT c.id, c.name, co.name AS company FROM contacts c "
                             "LEFT JOIN companies co ON co.id = c.company_id ORDER BY c.name").fetchall()
    return render_template("applications.html", apps=rows, contacts=contacts, app_statuses=db.APP_STATUSES)


@app.post("/applications")
def application_add():
    f = request.form
    try:
        db.add_application(con(), f["company"], f["role"], f.get("url", ""), f.get("referrer_contact_id", type=int))
    except ValueError as e:
        flash(str(e))
    return back("applications_page")


@app.post("/applications/<int:aid>")
def application_update(aid):
    db.update_application(con(), aid, request.form["status"], request.form.get("referrer_contact_id", type=int))
    return back("applications_page")


# --- Email templates and profile ---

@app.route("/templates", methods=["GET", "POST"])
def templates_page():
    if request.method == "POST":
        f = request.form
        values = (f["name"], f["kind"], f["subject"], f["body"])
        if f.get("id"):
            con().execute("UPDATE email_templates SET name = ?, kind = ?, subject = ?, body = ? WHERE id = ?",
                          (*values, f["id"]))
        else:
            con().execute("INSERT INTO email_templates (name, kind, subject, body) VALUES (?, ?, ?, ?)", values)
        flash("Template saved.")
        return redirect(url_for("templates_page"))
    tpls = con().execute("SELECT * FROM email_templates ORDER BY kind, name").fetchall()
    return render_template("email_templates.html", templates=tpls)


@app.route("/profile", methods=["GET", "POST"])
def profile_page():
    if request.method == "POST":
        f = request.form
        values = [f.get(k, 5, type=int) if k == "followup_days" else f.get(k, "") for k in PROFILE_FIELDS]
        con().execute(f"UPDATE profile SET {', '.join(k + ' = ?' for k in PROFILE_FIELDS)} WHERE id = 1", values)
        flash("Profile saved.")
        return redirect(url_for("profile_page"))
    return render_template("profile.html", p=db.get_profile(con()))


# --- Import / export ---

@app.get("/import")
def import_page():
    return render_template("import.html", stage="start")


@app.post("/import/linkedin")
def import_linkedin():
    try:
        report = importers.import_linkedin(con(), request.files["file"].read())
    except ValueError as e:
        flash(str(e))
        return redirect(url_for("import_page"))
    return render_template("import.html", stage="report", report=report)


@app.post("/import/upload")
def import_upload():
    f = request.files["file"]
    UPLOAD_DIR.mkdir(exist_ok=True)
    for old in UPLOAD_DIR.iterdir():
        old.unlink()
    f.save(UPLOAD_DIR / (secure_filename(f.filename) or "upload.xlsx"))
    return redirect(url_for("import_map"))


def uploaded():
    files = sorted(UPLOAD_DIR.glob("*")) if UPLOAD_DIR.exists() else []
    if not files:
        abort(400, "Upload a file first.")
    return files[0]


@app.get("/import/map")
def import_map():
    path = uploaded()
    try:
        sheets, headers, rows = importers.read_table(path.name, path.read_bytes(), request.args.get("sheet"))
    except ValueError as e:
        flash(str(e))
        return redirect(url_for("import_page"))
    return render_template("import.html", stage="map", sheets=sheets, sheet=request.args.get("sheet") or sheets[0],
                           headers=headers, preview=rows[:10], fields=importers.FIELDS,
                           mapping=importers.saved_mapping(con(), headers))


@app.post("/import/map")
def import_map_post():
    path = uploaded()
    _, headers, rows = importers.read_table(path.name, path.read_bytes(), request.form.get("sheet"))
    mapping = {h: request.form.get(f"map_{i}", "") for i, h in enumerate(headers)}
    importers.save_mapping(con(), headers, mapping)
    report = importers.import_rows(con(), rows, mapping, "import")
    path.unlink()
    return render_template("import.html", stage="report", report=report)


@app.get("/export")
def export():
    return send_file(io.BytesIO(importers.export_xlsx(con())), as_attachment=True,
                     download_name=f"networth-{dt.date.today()}.xlsx")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5050)), debug=True)
