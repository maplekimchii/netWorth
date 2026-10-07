import datetime as dt
import io

import openpyxl
import pytest

import ai
import db
import importers
import outlook


@pytest.fixture
def con(tmp_path):
    c = db.connect(tmp_path / "test.db")
    yield c
    c.close()


def sent_contact(con, sent="2026-10-01T09:00:00Z"):
    cid = db.add_contact(con, "Jane Doe", "paste", company="Stripe")
    mid = db.record_draft(con, cid, "initial", "Hi", "Body")
    db.mark_sent(con, mid, sent)
    return cid, mid


# --- db ---

def test_duplicate_contact_same_name_and_company_is_skipped(con):
    assert db.add_contact(con, "Jane Doe", "paste", company="Stripe")
    assert db.add_contact(con, "  jane   doe ", "paste", company="stripe") is None
    assert db.add_contact(con, "Jane Doe", "paste", company="Figma")
    assert db.add_contact(con, "Jane Doe", "paste")
    assert db.add_contact(con, "jane doe", "paste") is None


def test_add_contact_requires_name(con):
    with pytest.raises(ValueError):
        db.add_contact(con, "   ", "paste")


def test_draft_then_sent_sets_followup_date(con):
    cid = db.add_contact(con, "Jane Doe", "paste", company="Stripe")
    mid = db.record_draft(con, cid, "initial", "Hi", "Body")
    assert db.get_contact(con, cid)["status"] == "drafted"
    db.mark_sent(con, mid, "2026-10-01T09:00:00Z")
    c = db.get_contact(con, cid)
    assert (c["status"], c["next_followup_date"], c["followup_count"]) == ("sent", "2026-10-06", 0)


def test_followup_days_setting(con):
    con.execute("UPDATE profile SET followup_days = 7")
    cid, _ = sent_contact(con)
    assert db.get_contact(con, cid)["next_followup_date"] == "2026-10-08"


def test_two_sent_followups_count_and_stay_due(con):
    cid, _ = sent_contact(con)
    for sent in ("2026-10-06T09:00:00Z", "2026-10-11T09:00:00Z"):
        mid = db.record_draft(con, cid, "followup", "Re: Hi", "Nudge")
        db.mark_sent(con, mid, sent)
    c = db.get_contact(con, cid)
    assert (c["followup_count"], c["next_followup_date"]) == (2, "2026-10-16")
    due = db.today_view(con, dt.date(2026, 10, 16))["due"]
    assert [r["id"] for r in due] == [cid]
    assert due[0]["followup_count"] >= 2  # template shows "suggest dead"


def test_mark_sent_twice_is_noop(con):
    cid, mid = sent_contact(con)
    db.mark_sent(con, mid, "2026-10-09T09:00:00Z")
    assert db.get_contact(con, cid)["next_followup_date"] == "2026-10-06"


def test_reply_clears_followup(con):
    cid, mid = sent_contact(con)
    db.mark_replied(con, mid, "2026-10-02T10:00:00Z")
    c = db.get_contact(con, cid)
    assert (c["status"], c["next_followup_date"]) == ("replied", None)
    assert db.today_view(con, dt.date(2026, 10, 30))["due"] == []


def test_manual_status_overrides_automation(con):
    cid, mid = sent_contact(con)
    db.set_status(con, cid, "call")
    assert db.get_contact(con, cid)["next_followup_date"] is None
    db.mark_replied(con, mid, "2026-10-02T10:00:00Z")
    assert db.get_contact(con, cid)["status"] == "call"


def test_today_lists_old_unsent_drafts_and_stale_apps(con):
    cid = db.add_contact(con, "Jane Doe", "paste", company="Stripe")
    db.record_draft(con, cid, "initial", "Hi", "Body")
    con.execute("UPDATE messages SET created_at = '2026-10-01 12:00:00'")
    aid = db.add_application(con, "Stripe", "PM Intern")
    con.execute("UPDATE applications SET updated_at = '2026-09-01 12:00:00'")
    assert db.today_view(con, dt.date(2026, 10, 2))["unsent"] == []
    view = db.today_view(con, dt.date(2026, 10, 3))
    assert len(view["unsent"]) == 1
    assert [a["id"] for a in view["stale_apps"]] == [aid]


def test_application_status_change_sets_applied_date(con):
    aid = db.add_application(con, "Stripe", "PM Intern")
    con.execute("UPDATE applications SET updated_at = '2026-09-01 12:00:00'")
    db.update_application(con, aid, "applied")
    a = con.execute("SELECT * FROM applications WHERE id = ?", (aid,)).fetchone()
    assert a["applied_date"] and a["updated_at"] > "2026-09-01 12:00:00"


# --- ai ---

def test_fill_data_leaves_unknown_and_empty_placeholders_visible():
    out = ai.fill_data("Hi {first_name} at {company}, {mystery}", {"first_name": "Jane", "company": ""})
    assert out == "Hi Jane at {company}, {mystery}"
    assert ai.unfilled(out + " [[hook: x]]") == ["{company}", "{mystery}", "[[hook: x]]"]


def test_slots_extract_and_apply_keeps_missing_marker():
    text = "A [[hook: why them]] B [[why_company: why\nStripe]]"
    assert ai.extract_slots(text) == {"hook": "why them", "why_company": "why\nStripe"}
    assert ai.apply_slots(text, {"hook": " We both did CS. "}) == "A We both did CS. B [[why_company: why\nStripe]]"


def test_parse_json_handles_fences_and_prose():
    assert ai.parse_json('Sure!\n```json\n{"a": [1]}\n```') == {"a": [1]}
    with pytest.raises(ai.AIError):
        ai.parse_json("no json here")
    with pytest.raises(ai.AIError):
        ai.parse_json("{not: valid}")


PROFILE = {"name": "Alex Lee", "program": "CS", "target_roles": "Product, eng", "voice_samples": "hey!"}


def test_draft_fills_data_first_then_only_slots(monkeypatch):
    seen = {}

    def fake_fill(slots, context, voice):
        seen.update(slots)
        assert voice == "hey!" and "Stripe" in context
        return {"hook": "Loved your talk."}

    monkeypatch.setattr(ai, "fill_slots", fake_fill)
    tpl = {"subject": "{target_role} at {company}", "body": "Hi {first_name},\n[[hook: about {company}]]\n{my_name}"}
    contact = {"name": "Cher", "title": "", "company": "Stripe"}
    assert ai.draft(tpl, PROFILE, contact, None, []) == ("Product at Stripe", "Hi Cher,\nLoved your talk.\nAlex Lee")
    assert seen == {"hook": "about Stripe"}


def test_draft_without_slots_makes_no_ai_call(monkeypatch):
    monkeypatch.setattr(ai, "fill_slots", lambda *a: pytest.fail("should not call Claude"))
    tpl = {"subject": "Hi", "body": "Hi {first_name}"}
    assert ai.draft(tpl, PROFILE, {"name": "Jane Doe"}, None, []) == ("Hi", "Hi Jane")

