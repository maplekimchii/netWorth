"""Outlook via Microsoft Graph: create drafts and detect sends and replies. Never sends mail."""
import datetime as dt
import os
import threading
from pathlib import Path
from urllib.parse import quote, urlencode

import msal
import requests

import db

GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = ["Mail.ReadWrite"]  # MSAL adds offline_access itself. Never add Mail.Send.
CACHE_PATH = Path(__file__).with_name(".token_cache.json")
SYNC_EVERY = dt.timedelta(minutes=10)


class OutlookError(Exception):
    pass


class NotConnected(OutlookError):
    pass


_cache = msal.SerializableTokenCache()
if CACHE_PATH.exists():
    _cache.deserialize(CACHE_PATH.read_text())
_app = None
_me = None
_last_sync = None
login_state = {}


def enabled():
    return bool(os.environ.get("MS_CLIENT_ID"))


def _msal():
    global _app
    if _app is None:
        tenant = os.environ.get("MS_TENANT", "organizations")
        _app = msal.PublicClientApplication(os.environ["MS_CLIENT_ID"],
                                            authority=f"https://login.microsoftonline.com/{tenant}",
                                            token_cache=_cache)
    return _app


def _save_cache():
    if _cache.has_state_changed:
        CACHE_PATH.write_text(_cache.serialize())


def is_connected():
    return bool(_msal().get_accounts())


def start_login():
    """Begin device-code login; a background thread waits for the user to finish in the browser."""
    flow = _msal().initiate_device_flow(scopes=SCOPES)
    if "user_code" not in flow:
        raise OutlookError(flow.get("error_description", "Could not start Outlook login."))
    login_state.clear()
    login_state.update(message=flow["message"], done=False, error=None)

    def wait():
        result = _msal().acquire_token_by_device_flow(flow)
        _save_cache()
        login_state.update(done=True, error=None if "access_token" in result else result.get("error_description"))

    threading.Thread(target=wait, daemon=True).start()


def _token():
    accounts = _msal().get_accounts()
    result = _msal().acquire_token_silent(SCOPES, account=accounts[0]) if accounts else None
    _save_cache()
    if not result or "access_token" not in result:
        raise NotConnected("Outlook is not connected.")
    return result["access_token"]


def _graph(method, path, **kwargs):
    r = requests.request(method, GRAPH + path, headers={"Authorization": "Bearer " + _token()}, timeout=30, **kwargs)
    if r.status_code == 401:
        raise NotConnected("Outlook login expired.")
    if not r.ok:
        raise OutlookError(f"Outlook returned {r.status_code}: {r.text[:200]}")
    return r.json()


def draft_payload(to, subject, body):
    return {"subject": subject, "body": {"contentType": "Text", "content": body},
            "toRecipients": [{"emailAddress": {"address": to}}] if to else []}


def create_draft(to, subject, body):
    m = _graph("POST", "/me/messages", json=draft_payload(to, subject, body))
    return m["id"], m["conversationId"]


def mailto_link(to, subject, body):
    return f"mailto:{quote(to or '')}?" + urlencode({"subject": subject, "body": body}, quote_via=quote)


def _my_address():
    global _me
    if not _me:
        m = _graph("GET", "/me", params={"$select": "mail,userPrincipalName"})
        _me = (m.get("mail") or m["userPrincipalName"]).lower()
    return _me


def _conversation(conversation_id):
    cid = conversation_id.replace("'", "''")
    return _graph("GET", "/me/messages", params={
        "$filter": f"conversationId eq '{cid}'",
        "$select": "isDraft,from,sentDateTime,receivedDateTime"})["value"]


def classify(msgs, me, since):
    """Earliest send by me and earliest reply by anyone else, counting only mail at or after `since`."""
    since = since.replace(" ", "T")[:19]

    def sender(m):
        return ((m.get("from") or {}).get("emailAddress") or {}).get("address", "").lower()

    sent = [m["sentDateTime"] for m in msgs
            if not m["isDraft"] and sender(m) == me and m["sentDateTime"][:19] >= since]
    replies = [m["receivedDateTime"] for m in msgs
               if not m["isDraft"] and sender(m) != me and m["receivedDateTime"][:19] >= since]
    return (min(sent) if sent else None), (min(replies) if replies else None)


def sync(con, force=False):
    global _last_sync
    now = dt.datetime.now(dt.timezone.utc)
    if not force and _last_sync and now - _last_sync < SYNC_EVERY:
        return False
    _last_sync = now
    me = _my_address()
    rows = con.execute("SELECT id, outlook_conversation_id, created_at, sent_at FROM messages "
                       "WHERE outlook_conversation_id IS NOT NULL AND replied_at IS NULL").fetchall()
    for row in rows:
        sent_at, replied_at = classify(_conversation(row["outlook_conversation_id"]), me, row["created_at"])
        if sent_at and not row["sent_at"]:
            db.mark_sent(con, row["id"], sent_at)
        if replied_at:
            db.mark_replied(con, row["id"], replied_at)
    return True
