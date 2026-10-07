"""SQLite storage and the contact tracking rules for netWorth."""
import datetime as dt
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).with_name("networth.db")
STATUSES = ("to_contact", "drafted", "sent", "replied", "call", "done", "dead")
APP_STATUSES = ("planned", "applied", "interview", "offer", "rejected")
SOURCES = ("linkedin_csv", "ai_search", "paste", "import")
# Automation (drafting, sync) may only move contacts that are in one of these states.
OPEN = ("to_contact", "drafted", "sent")

SCHEMA = """
CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT DEFAULT '', program TEXT DEFAULT '', resume_text TEXT DEFAULT '',
    story TEXT DEFAULT '', target_roles TEXT DEFAULT '', voice_samples TEXT DEFAULT '',
    followup_days INTEGER DEFAULT 5
);
INSERT OR IGNORE INTO profile (id) VALUES (1);
CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    domain TEXT DEFAULT '', priority INTEGER DEFAULT 2, notes TEXT DEFAULT '',
    news TEXT DEFAULT '', news_updated_at TEXT
);
CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    company_id INTEGER REFERENCES companies(id),
    title TEXT DEFAULT '', email TEXT DEFAULT '', linkedin_url TEXT DEFAULT '',
    source TEXT NOT NULL CHECK (source IN ('linkedin_csv', 'ai_search', 'paste', 'import')),
    how_connected TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'to_contact'
        CHECK (status IN ('to_contact', 'drafted', 'sent', 'replied', 'call', 'done', 'dead')),
    notes TEXT DEFAULT '', next_followup_date TEXT, followup_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS email_templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('initial', 'followup')),
    subject TEXT NOT NULL, body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('initial', 'followup')),
    subject TEXT, body TEXT,
    outlook_message_id TEXT, outlook_conversation_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, sent_at TEXT, replied_at TEXT
);
CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    role TEXT NOT NULL, url TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'applied', 'interview', 'offer', 'rejected')),
    applied_date TEXT,
    referrer_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS column_mappings (signature TEXT PRIMARY KEY, mapping TEXT NOT NULL);
"""

DEFAULT_TEMPLATES = [
    ("Intro: coffee chat", "initial", "Waterloo student interested in {company}",
     "Hi {first_name},\n\n"
     "[[hook: one specific line on why I'm reaching out to this person - shared school, their post, their team's work]]\n\n"
     "I'm a {my_program} student at Waterloo looking at {target_role} roles. "
     "[[why_company: one sentence on why {company}, using company notes and news]]\n\n"
     "Would you be open to a 15-minute chat in the next couple of weeks?\n\n"
     "Best,\n{my_name}"),
    ("Follow-up: gentle nudge", "followup", "Re: Waterloo student interested in {company}",
     "Hi {first_name},\n\n"
     "[[nudge: one or two friendly sentences that add something new - a recent {company} update or a short reason I'm still keen - without guilt-tripping]]\n\n"
     "Happy to work around your schedule if a quick chat is possible.\n\n"
     "Best,\n{my_name}"),
]


def connect(path=DB_PATH):
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript(SCHEMA)
    if not con.execute("SELECT 1 FROM email_templates").fetchone():
        con.executemany("INSERT INTO email_templates (name, kind, subject, body) VALUES (?, ?, ?, ?)",
                        DEFAULT_TEMPLATES)
        con.commit()
    return con


def clean_name(name):
    return " ".join((name or "").split())


def get_or_create_company(con, name):
    name = clean_name(name)
    if not name:
        return None
    row = con.execute("SELECT id FROM companies WHERE name = ?", (name,)).fetchone()
    if row:
        return row["id"]
    return con.execute("INSERT INTO companies (name) VALUES (?)", (name,)).lastrowid


def _is_dup(con, name, company_id):
    return con.execute("SELECT 1 FROM contacts WHERE name = ? COLLATE NOCASE AND company_id IS ?",
                       (clean_name(name), company_id)).fetchone() is not None


def contact_exists(con, name, company=""):
    """Same duplicate rule as add_contact, without creating the company."""
    company = clean_name(company)
    row = con.execute("SELECT id FROM companies WHERE name = ?", (company,)).fetchone() if company else None
    if company and row is None:
        return False
    return _is_dup(con, name, row["id"] if row else None)


CONTACT_FIELDS = ("title", "email", "linkedin_url", "how_connected", "notes")


def add_contact(con, name, source, company="", **fields):
    name = clean_name(name)
    if not name:
        raise ValueError("A contact needs a name.")
    company_id = get_or_create_company(con, company)
    if _is_dup(con, name, company_id):
        return None
    values = {k: (fields.get(k) or "").strip() for k in CONTACT_FIELDS}
    cols = ["name", "source", "company_id", *values]
    return con.execute(f"INSERT INTO contacts ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                       (name, source, company_id, *values.values())).lastrowid


def update_contact(con, contact_id, form):
    values = [(form.get(k) or "").strip() for k in CONTACT_FIELDS]
    con.execute(f"UPDATE contacts SET name = ?, company_id = ?, {', '.join(k + ' = ?' for k in CONTACT_FIELDS)} "
                "WHERE id = ?",
                (clean_name(form.get("name")), get_or_create_company(con, form.get("company")), *values, contact_id))


def get_contact(con, contact_id):
    return con.execute("SELECT c.*, co.name AS company FROM contacts c "
                       "LEFT JOIN companies co ON co.id = c.company_id WHERE c.id = ?", (contact_id,)).fetchone()


def list_contacts(con, status=None, company_id=None, source=None, q=None):
    sql = "SELECT c.*, co.name AS company FROM contacts c LEFT JOIN companies co ON co.id = c.company_id WHERE 1 = 1"
    args = []
    if q and q.strip():
        sql += " AND (c.name LIKE ? OR c.title LIKE ? OR co.name LIKE ?)"
        args += [f"%{q.strip()}%"] * 3
    for col, val in (("c.status", status), ("c.company_id", company_id), ("c.source", source)):
        if val:
            sql += f" AND {col} = ?"
            args.append(val)
    return con.execute(sql + " ORDER BY c.created_at DESC, c.id DESC", args).fetchall()


def get_profile(con):
    return dict(con.execute("SELECT * FROM profile WHERE id = 1").fetchone())


def followup_due(con, sent_date):
    days = con.execute("SELECT followup_days FROM profile WHERE id = 1").fetchone()[0]
    return (sent_date + dt.timedelta(days=days)).isoformat()


def set_status(con, contact_id, status, today=None):
    """Manual status change. Only 'sent' keeps a follow-up date; every other status clears it."""
    if status not in STATUSES:
        raise ValueError(f"Unknown status: {status}")
    nxt = followup_due(con, today or dt.date.today()) if status == "sent" else None
    con.execute("UPDATE contacts SET status = ?, next_followup_date = ? WHERE id = ?", (status, nxt, contact_id))


def record_draft(con, contact_id, kind, subject, body, outlook_id=None, conversation_id=None):
    mid = con.execute("INSERT INTO messages (contact_id, kind, subject, body, outlook_message_id, "
                      "outlook_conversation_id) VALUES (?, ?, ?, ?, ?, ?)",
                      (contact_id, kind, subject, body, outlook_id, conversation_id)).lastrowid
    con.execute("UPDATE contacts SET status = 'drafted' WHERE id = ? AND status IN ('to_contact', 'sent')",
                (contact_id,))
    return mid


def mark_sent(con, message_id, sent_at):
    msg = con.execute("SELECT contact_id, kind, sent_at FROM messages WHERE id = ?", (message_id,)).fetchone()
    if msg is None or msg["sent_at"]:
        return
    con.execute("UPDATE messages SET sent_at = ? WHERE id = ?", (sent_at, message_id))
    due = followup_due(con, dt.date.fromisoformat(sent_at[:10]))
    con.execute("UPDATE contacts SET status = 'sent', next_followup_date = ?, followup_count = followup_count + ? "
                f"WHERE id = ? AND status IN {OPEN}",
                (due, 1 if msg["kind"] == "followup" else 0, msg["contact_id"]))


def mark_replied(con, message_id, replied_at):
    msg = con.execute("SELECT contact_id, replied_at FROM messages WHERE id = ?", (message_id,)).fetchone()
    if msg is None or msg["replied_at"]:
        return
    con.execute("UPDATE messages SET replied_at = ?, sent_at = COALESCE(sent_at, ?) WHERE id = ?",
                (replied_at, replied_at, message_id))
    con.execute(f"UPDATE contacts SET status = 'replied', next_followup_date = NULL WHERE id = ? AND status IN {OPEN}",
                (msg["contact_id"],))


def add_application(con, company, role, url="", referrer_contact_id=None):
    company_id = get_or_create_company(con, company)
    if company_id is None or not (role or "").strip():
        raise ValueError("An application needs a company and a role.")
    return con.execute("INSERT INTO applications (company_id, role, url, referrer_contact_id) VALUES (?, ?, ?, ?)",
                       (company_id, role.strip(), url, referrer_contact_id)).lastrowid


def update_application(con, app_id, status, referrer_contact_id=None):
    if status not in APP_STATUSES:
        raise ValueError(f"Unknown application status: {status}")
    # Right-hand sides see the old row, so updated_at only moves when the status really changes.
    con.execute("UPDATE applications SET "
                "updated_at = CASE WHEN status != ? THEN CURRENT_TIMESTAMP ELSE updated_at END, "
                "applied_date = CASE WHEN ? = 'applied' AND applied_date IS NULL THEN date('now') ELSE applied_date END, "
                "status = ?, referrer_contact_id = ? WHERE id = ?",
                (status, status, status, referrer_contact_id, app_id))


def today_view(con, today):
    def days_ago(n):
        return (today - dt.timedelta(days=n)).isoformat()

    due = con.execute("SELECT c.*, co.name AS company, "
                      "CAST(julianday(?) - julianday(c.next_followup_date) AS INTEGER) AS days_late "
                      "FROM contacts c LEFT JOIN companies co ON co.id = c.company_id "
                      "WHERE c.status = 'sent' AND c.next_followup_date <= ? ORDER BY c.next_followup_date",
                      (today.isoformat(), today.isoformat())).fetchall()
    unsent = con.execute("SELECT m.id, m.subject, m.created_at, c.id AS contact_id, c.name FROM messages m "
                         "JOIN contacts c ON c.id = m.contact_id "
                         "WHERE m.sent_at IS NULL AND c.status = 'drafted' AND date(m.created_at) <= ? "
                         "ORDER BY m.created_at", (days_ago(2),)).fetchall()
    stale = con.execute("SELECT a.*, co.name AS company FROM applications a JOIN companies co ON co.id = a.company_id "
                        "WHERE a.status IN ('planned', 'applied', 'interview') AND date(a.updated_at) <= ? "
                        "ORDER BY a.updated_at", (days_ago(14),)).fetchall()
    return {"due": due, "unsent": unsent, "stale_apps": stale}


def stats(con, today):
    """Numbers for the Today tiles. reply_rate is a whole percent over the last 30 days, or None with no sends."""
    def since(n):
        return (today - dt.timedelta(days=n)).isoformat()

    sent, replied = con.execute("SELECT COUNT(*), COUNT(replied_at) FROM messages WHERE date(sent_at) >= ?",
                                (since(29),)).fetchone()
    return {
        "due": con.execute("SELECT COUNT(*) FROM contacts WHERE status = 'sent' AND next_followup_date <= ?",
                           (today.isoformat(),)).fetchone()[0],
        "sent_week": con.execute("SELECT COUNT(*) FROM messages WHERE date(sent_at) >= ?", (since(6),)).fetchone()[0],
        "reply_rate": round(100 * replied / sent) if sent else None,
        "calls": con.execute("SELECT COUNT(*) FROM contacts WHERE status = 'call'").fetchone()[0],
    }
