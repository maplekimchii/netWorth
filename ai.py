"""Email template filling and Claude calls."""
import json
import os
import re

import anthropic

MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")
WEB_SEARCH = {"type": "web_search_20260209", "name": "web_search", "max_uses": 5}
PLACEHOLDER = re.compile(r"\{(\w+)\}")
SLOT = re.compile(r"\[\[(\w+):\s*(.*?)\]\]", re.S)


class AIError(Exception):
    pass


_client = None


def client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


# --- template filling (no AI) ---

def fill_data(text, values):
    """Replace {name} placeholders that have a value; leave the rest visible."""
    return PLACEHOLDER.sub(lambda m: str(values[m[1]]) if values.get(m[1]) else m[0], text)


def extract_slots(text):
    return {m[1]: m[2].strip() for m in SLOT.finditer(text)}


def apply_slots(text, filled):
    """Swap each [[slot: ...]] for its AI text; a missing or empty slot stays as a visible marker."""
    return SLOT.sub(lambda m: (filled.get(m[1]) or "").strip() or m[0], text)


def unfilled(text):
    return [m[0] for m in PLACEHOLDER.finditer(text)] + [m[0] for m in SLOT.finditer(text)]


def parse_json(text):
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end < start:
        raise AIError("Claude did not return JSON.")
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise AIError(f"Claude returned invalid JSON: {e}") from e


# --- Claude calls ---

def _call(system, prompt, search=False):
    messages = [{"role": "user", "content": prompt}]
    extra = {"tools": [WEB_SEARCH]} if search else {}
    for _ in range(5):
        try:
            resp = client().beta.messages.create(
                model=MODEL, max_tokens=16000, system=system, messages=messages,
                output_config={"effort": "medium"},
                betas=["server-side-fallback-2026-07-01"], fallbacks="default",
                **extra,
            )
        except TypeError as e:
            # The SDK raises TypeError, not an API error, when no credentials are configured.
            if "authentication" not in str(e):
                raise
            raise AIError("No Anthropic API key found. Set ANTHROPIC_API_KEY in .env and restart.") from e
        if resp.stop_reason == "refusal":
            raise AIError("Claude declined this request.")
        if resp.stop_reason != "pause_turn":
            return "".join(b.text for b in resp.content if b.type == "text")
        # Long web search paused mid-turn: send the partial turn back so Claude continues it.
        messages = [messages[0], {"role": "assistant", "content": resp.content}]
    raise AIError("Web search did not finish. Try a narrower search.")


def ask_json(system, prompt, search=False):
    """Ask Claude for a JSON object; retry once if the reply is not valid JSON."""
    for attempt in (1, 2):
        try:
            return parse_json(_call(system, prompt, search))
        except AIError:
            if attempt == 2:
                raise


def _me(profile):
    return (f"Me: {profile.get('name') or ''}, {profile.get('program') or ''}. "
            f"Target roles: {profile.get('target_roles') or ''}.\nMy story: {profile.get('story') or ''}")


FIND_SYSTEM = ("You help a student find people to contact for job-search networking. Use web search. "
               "List only real people you found evidence for in the search results who currently work at the "
               "company. Never invent names, titles, or URLs.")


def find_people(company, focus, profile):
    data = ask_json(FIND_SYSTEM, f"""{_me(profile)}

Find up to 8 people currently at {company} worth contacting. Focus: {focus or 'anyone relevant to my target roles'}.
Prefer people likely to reply to a student: alumni of my school, recruiters, hiring managers, and people on teams that match my target roles.

Reply with only a JSON object:
{{"people": [{{"name": "", "title": "", "why_relevant": "one sentence", "source_url": "", "linkedin_url": "or empty"}}]}}""",
                    search=True)
    return [p for p in data.get("people", []) if p.get("name")]


def parse_profile(text):
    data = ask_json("You extract contact details from pasted profile text. Use only what the text says; "
                    "leave a field empty when the text does not contain it.",
                    f"""<profile>
{text}
</profile>

Reply with only a JSON object:
{{"name": "", "company": "current employer", "title": "current title", "email": "", "linkedin_url": "", "notes": "1-2 lines useful for a personal hook: schools, past companies, notable work"}}""")
    return {k: str(data.get(k) or "") for k in ("name", "company", "title", "email", "linkedin_url", "notes")}


def research_company(name):
    data = ask_json("You research companies for a job seeker. Use web search. Prefer news from the last six "
                    "months and include only facts you found.",
                    f"Research {name}: recent launches, funding, leadership changes, and hiring signals.\n"
                    'Reply with only a JSON object: {"bullets": ["3 to 5 short bullets, each ending with (Month Year)"]}',
                    search=True)
    return "\n".join(f"- {b}" for b in data.get("bullets", []))


SLOT_SYSTEM = ("You write short passages for the user's networking emails, in the user's own voice. Match the tone, "
               "sentence length, and word choice of the voice samples. Sound like a real person writing one email, "
               "not marketing copy: be specific, skip flattery and filler, and never invent facts that are not in "
               "the context.")


def fill_slots(slots, context, voice_samples):
    spec = "\n".join(f'- "{k}": {v}' for k, v in slots.items())
    data = ask_json(SLOT_SYSTEM, f"""{context}

<voice_samples>
{voice_samples or '(none provided: write plainly and warmly)'}
</voice_samples>

Write the text for each slot below. Each slot is dropped into a fixed email template, so write only the slot text: no greeting, no sign-off.
{spec}

Reply with only a JSON object mapping each slot name to its text.""")
    return {k: str(v) for k, v in data.items()}


def _context(profile, contact, company, prior):
    lines = [_me(profile), f"My resume:\n{profile.get('resume_text') or ''}", "",
             f"Contact: {contact.get('name')}, {contact.get('title') or 'title unknown'} at {contact.get('company') or 'unknown company'}",
             f"How we're connected: {contact.get('how_connected') or 'not connected'}",
             f"Notes on them: {contact.get('notes') or 'none'}"]
    if company:
        lines += [f"Why I'm interested in {company['name']}: {company.get('notes') or 'none'}",
                  f"Recent news:\n{company.get('news') or 'none'}"]
    for m in prior:
        lines.append(f"Earlier email I {'sent' if m.get('sent_at') else 'drafted'} (subject: {m.get('subject')}):\n{m.get('body')}")
    return "\n".join(lines)


def draft(template, profile, contact, company, prior):
    parts = (contact.get("name") or "").split()
    values = {
        "first_name": parts[0] if parts else "",
        "last_name": parts[-1] if len(parts) > 1 else "",
        "company": contact.get("company") or "",
        "title": contact.get("title") or "",
        "my_name": profile.get("name") or "",
        "my_program": profile.get("program") or "",
        "target_role": re.split(r"[,\n]", profile.get("target_roles") or "")[0].strip(),
    }
    subject, body = fill_data(template["subject"], values), fill_data(template["body"], values)
    slots = extract_slots(subject + "\n" + body)
    if slots:
        filled = fill_slots(slots, _context(profile, contact, company, prior), profile.get("voice_samples") or "")
        subject, body = apply_slots(subject, filled), apply_slots(body, filled)
    return subject, body
