# netWorth — Design Spec

Date: 2026-10-06
Status: Draft, awaiting review

## 1. Purpose

A locally hosted web app that supports a job search through networking. It covers the full outreach loop in one place:

1. **Find** people worth contacting at target companies.
2. **Draft** personalized cold emails and follow-ups quickly.
3. **Track** who was contacted, who replied, when to follow up, and which applications each contact relates to.

### Success criteria

- Going from "target company" to a personalized Outlook draft takes under 2 minutes.
- No follow-up is missed: every sent email without a reply surfaces on the Today page when due.
- Applications are linked to the contacts who referred or helped with them.

### Assumptions

- Single user, runs only on the user's laptop (`localhost`), no authentication.
- AI is OpenAI via the Responses API, model `gpt-6-luna` (configurable with `OPENAI_MODEL`).
- Email account is a University of Waterloo Microsoft 365 account.

### Non-goals (v1)

- Sending email automatically. The app only creates drafts; the user sends from Outlook.
- LinkedIn automation of any kind (deferred to v2, see §12).
- Email address guessing or verification.
- Kanban board view.
- Multi-user support, hosting, or mobile layout beyond basic responsiveness.

## 2. Stack

- Python 3.12+, Flask, Jinja templates, plain HTML/CSS (no JS framework; small inline JS where needed).
- SQLite via the standard library `sqlite3` module.
- Dependencies: `flask`, `openai`, `msal`, `requests`, `openpyxl`, `python-dotenv`, `pytest` (dev).
- Run with `python app.py`, then open `http://localhost:5000`.

## 3. File layout

```
netWorth/
  app.py          Flask routes and page handlers
  db.py           SQLite schema, migrations-on-start, query helpers
  ai.py           OpenAI calls: find people, parse profile, company research, fill template slots
  outlook.py      Microsoft Graph: device-code login, create draft, sync sent/replied
  importers.py    LinkedIn Connections.csv, generic Excel with column mapping, Excel export
  templates/      Jinja HTML pages
  static/         One CSS file
  test_app.py     pytest suite
  networth.db     Data (gitignored)
  .token_cache.json  MSAL token cache (gitignored)
  .env            OPENAI_API_KEY, OPENAI_MODEL, MS_CLIENT_ID, MS_TENANT (gitignored)
```

## 4. Data model

**profile** (single row)
- `name`, `program` (e.g. "Computer Science"), `resume_text`, `story`, `target_roles`, `voice_samples` (1–2 example emails written by the user), `followup_days` (default 5)

**companies**
- `id`, `name` (unique), `domain`, `priority` (1–3), `notes` (why this company), `news` (cached AI research), `news_updated_at`

**contacts**
- `id`, `name`, `company_id`, `title`, `email`, `linkedin_url`
- `source`: `linkedin_csv` | `ai_search` | `paste` | `import`
- `how_connected` (free text, e.g. "Waterloo alum", "1st-degree connection")
- `status`: `to_contact` | `drafted` | `sent` | `replied` | `call` | `done` | `dead`
- `notes`, `next_followup_date`, `followup_count`, `created_at`
- Duplicate rule: same normalized name + same company is a duplicate. Imports and saves skip duplicates and report them.

**email_templates**
- `id`, `name`, `kind` (`initial` | `followup`), `subject`, `body`
- Ships with 2 default templates (one initial, one follow-up) that the user can edit.

**messages**
- `id`, `contact_id`, `kind` (`initial` | `followup`), `subject`, `body`
- `outlook_message_id`, `outlook_conversation_id` (null in fallback mode)
- `created_at`, `sent_at`, `replied_at`

**applications**
- `id`, `company_id`, `role`, `url`, `status` (`planned` | `applied` | `interview` | `offer` | `rejected`), `applied_date`, `referrer_contact_id`, `updated_at`

## 5. Pages

- **Today**: follow-ups due, drafts created but unsent for 2+ days, applications with no status change for 14+ days.
- **Contacts**: table filterable by status, company, and source; inline status change; link to contact detail (messages history, draft button).
- **Companies**: list plus detail page with notes, cached news ("Refresh news" button), people at the company, and applications.
- **Find**: AI web search form (company + role focus) and paste-a-profile form.
- **Applications**: table with status, linked company and referrer.
- **Templates**: list and edit email templates.
- **Profile**: edit profile fields and settings.
- **Import/Export**: upload LinkedIn CSV or Excel, map columns, preview, import; export all tables to one `.xlsx`.

## 6. Email templates

Template bodies contain two kinds of placeholders:

- **Data placeholders** `{name}`: filled directly from the database without AI. Supported: `{first_name}`, `{last_name}`, `{company}`, `{title}`, `{my_name}`, `{my_program}`, `{target_role}`.
- **AI slots** `[[slot_name: instruction]]`: filled by the AI. The instruction after the colon tells the AI what to write for that slot.

Rules:
- Fixed template text is never altered by the AI. The app fills data placeholders, sends only the slot instructions plus context to the AI, then substitutes the returned slot text.
- The AI writes slots in the user's voice, using `voice_samples` as style reference.
- Unknown `{placeholder}` names are left visible and highlighted so the user notices them.
- The filled result appears in an editable subject field and body textarea before any Outlook action.

Example default initial template:

```
Subject: Waterloo student interested in {company}

Hi {first_name},

[[hook: one specific line on why I'm reaching out to this person — shared school, their post, their team's work]]

I'm a {my_program} student at Waterloo looking at {target_role} roles. [[why_company: one sentence on why {company}, using company notes and news]]

Would you be open to a 15-minute chat in the next couple of weeks?

Best,
{my_name}
```

## 7. AI flows (`ai.py`)

All calls use the OpenAI Python SDK Responses API with model from config (default `gpt-6-luna`). Every AI result is shown for review; nothing is saved or sent to Outlook without a user click.

1. **Find people**: input is company + role focus. The model uses the built-in `web_search` tool and returns JSON: list of `{name, title, why_relevant, source_url, linkedin_url?}`. Shown as cards with a Save button. Saved contacts get `source=ai_search`. Source links are always shown so the user can verify stale or wrong results.
2. **Parse profile**: input is pasted profile text (LinkedIn or anywhere). The model returns contact fields as JSON, shown in an editable form before saving. The app does not fetch LinkedIn URLs.
3. **Company research**: The model web-searches the company and returns 3–5 bullets (recent launches, funding, hiring signals). Stored in `companies.news` with timestamp.
4. **Fill template slots**: inputs are profile, contact, company notes and news, `how_connected`, prior messages with this contact, and the list of slot instructions. Output is JSON mapping slot name to text.
5. **Follow-up**: same as 4 using a `followup` template; prior message bodies are included in the context.

Error handling:
- API errors are shown on the page with a Retry button.
- Invalid JSON from the model triggers one automatic retry, then a visible error.
- Missing slot keys in the response are left as visible `[[slot]]` markers rather than failing the whole draft.

## 8. Outlook integration (`outlook.py`)

### Modes

- **Graph mode**: requires an Azure app registration (free) and user consent in the UWaterloo tenant.
- **Fallback mode**: used when `MS_CLIENT_ID` is unset or consent is blocked. "Open in Outlook" uses a `mailto:` link with subject and body prefilled; the user clicks "Mark sent" and "Mark replied" manually.

Risk: UWaterloo may disable user consent for third-party apps, which blocks `Mail.ReadWrite`. The first implementation task is a spike to test this. The rest of the app does not depend on the outcome.

### Graph mode details

- Auth: MSAL device-code flow. Scopes `Mail.ReadWrite`, `offline_access`. No `Mail.Send`, so the app is technically unable to send email. Token cached in `.token_cache.json`.
- Create draft: `POST /me/messages` with subject, HTML body, and recipient. Store returned `id` and `conversationId` in `messages`. Contact status becomes `drafted`.
- Sync (on "Sync" click or Today page load, throttled to once per 10 minutes):
  - **Sent detection**: for each `drafted` message, fetch it by id. If `isDraft` is false, set `sent_at` and contact status to `sent`. If the id is no longer found (Outlook can change ids when a draft is sent), search Sent Items by `conversationId`.
  - **Reply detection**: for each `sent` message without `replied_at`, list messages with the same `conversationId`; any message whose sender is not the user sets `replied_at`, contact status to `replied`, and clears `next_followup_date`.
- Expired or revoked token: prompt to reconnect. Graph failures show an error banner; the draft remains saved locally.

## 9. Tracking and follow-up rules

- On `sent`: `next_followup_date = sent_at + profile.followup_days`.
- On sending a follow-up: `followup_count += 1`, `next_followup_date` reset the same way.
- When `followup_count >= 2` and the next follow-up comes due, the Today page suggests marking the contact `dead` instead of drafting another.
- Status can always be changed manually; manual changes override automation.
- Moving a contact to `call`, `done`, or `dead` clears `next_followup_date`.

## 10. Importers (`importers.py`)

- **LinkedIn Connections.csv**: known format (skip LinkedIn's preamble lines before the header). Maps First Name, Last Name, Email Address, Company, Position, URL, Connected On. Companies are created as needed. `source=linkedin_csv`, `how_connected="1st-degree LinkedIn connection"`.
- **Generic Excel/CSV** (e.g. PitchBook export): upload, pick sheet, map each column to a contact field via dropdowns, preview first 10 rows, import. Column mappings are remembered per header signature for reuse.
- **Export**: one `.xlsx` with a sheet per table.
- All imports report counts: added, skipped as duplicates, failed rows with reasons.

Note: if the PitchBook seat belongs to the user's employer, using it for a personal job search may violate the license or employer policy. The user should confirm before importing from it.

## 11. Testing

One `test_app.py` using pytest, with the OpenAI client and Graph replaced by fakes:
- Status transitions and follow-up date calculations.
- Template filling: data placeholders, slot extraction, slot substitution, unknown placeholder handling, missing slot handling.
- LinkedIn CSV import including preamble lines and duplicate skipping.
- Sync logic: sent detection and reply detection against fake Graph responses.

Manual smoke test against real Outlook and the OpenAI API after automated tests pass.

## 12. v2 (out of scope for v1)

- **LinkedIn MCP adapter**: optional `linkedin.py` using the Python `mcp` client to call `stickerdaniel/linkedin-mcp-server` (Patchright browser automation on the user's logged-in session). Adds "LinkedIn search" as a source on the Find page. Off by default behind `LINKEDIN_MCP=1`, hard cap of about 20 lookups per day. The user accepts the account restriction risk (LinkedIn's User Agreement prohibits automated access). Removing it must not affect anything else.
- **Clipper browser extension**: sends the current page's text to `POST /api/clip` for profile parsing.
- Apollo free tier for verified work emails.
- Kanban view.
