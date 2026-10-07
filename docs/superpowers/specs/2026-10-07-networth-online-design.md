# netWorth Online — Design Spec

Date: 2026-10-07
Status: Draft, awaiting review
Builds on: `2026-10-06-networth-design.md` (v1, local single-user app)

## 1. Purpose

Move netWorth from a local single-user app to a hosted app for the owner plus a few invited people, and add an interactive network graph of saved contacts.

### Goals

1. **Google sign-in.** Only invited Google accounts can use the app.
2. **Data stored online.** Each user has their own private contacts, companies, emails, applications, templates, and profile.
3. **Network graph.** A radial, drill-down view of a user's contacts grouped by levels the user chooses and reorders (for example Industry → Company → Team, or School → Class year → Major).

### Users

- **Admin:** the owner. Invites people, sets per-member AI limits, has no AI limit.
- **Member:** an invited person. Has a fully separate dataset. Uses the owner's OpenAI key subject to a monthly call limit.
- Small scale: a handful of users. Non-commercial.

### Success criteria

- A non-invited Google account cannot see any page beyond "not invited".
- No user can read or change another user's data, even if an application query forgets to filter by owner (proved by a test).
- Changing graph levels re-renders in under one second for a few hundred contacts.
- Hosting and database cost $0 at this scale.

### Non-goals

- Shared/team contact pools between users.
- Billing, self-serve sign-up, or a public product.
- User-defined custom fields beyond the fixed set plus one "Group" field.
- Gmail integration (Outlook plus `mailto:` fallback stays).
- A JavaScript framework rewrite; Flask with server-rendered pages stays.

## 2. Stack and hosting

- **App:** existing Flask app, deployed as one Vercel Python serverless function. `api/index.py` imports and exposes `app`. `vercel.json` rewrites all paths to it. Static assets move to `public/static/`; Flask's `static_folder` points there, so Vercel serves them directly in production and Flask serves the same files locally at the same `/static/...` URLs.
- **Hosting plan:** Vercel Hobby ($0, non-commercial). Max function duration 300 s, enough for AI web searches.
- **Database:** Neon Postgres free tier, connected through Neon's pooled connection string. One connection per request.
- **Driver:** `psycopg` 3. No ORM.
- **Migrations:** numbered SQL files in `migrations/`, applied by `python -m db migrate`, tracked in a `schema_migrations` table.
- **Environments:** Neon branches for `dev`, `test`, and `main` (production).
- **Graph rendering:** D3 v7 from a pinned CDN URL.
- **Auth library:** Authlib (Google OpenID Connect).
- **Token encryption:** `cryptography` Fernet with key from env `TOKEN_KEY`.

### Environment variables

`DATABASE_URL`, `SECRET_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAIL`, `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-6-luna`), `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` (default `organizations`), `TOKEN_KEY`. Tests also use `TEST_DATABASE_URL`.

## 3. Data model

All existing tables gain `owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`, except where noted.

### New tables

- **users**: `id`, `email` (unique, lowercase), `name`, `role` (`admin` | `member`), `ai_monthly_cap` (integer, default 100; ignored for admin), `google_sub` (unique, nullable until first login), `last_sync_at`, `created_at`. A row with null `google_sub` is a pending invite. Not owner-scoped.
- **searches**: `owner_id` (primary key), `company`, `results` (jsonb), `created_at`. Holds the latest Find-people results per user.
- **ai_usage**: `owner_id`, `month` (`YYYY-MM`), `calls`. Primary key `(owner_id, month)`.
- **outlook_tokens**: `owner_id` (primary key), `token_cache` (bytea, Fernet-encrypted MSAL cache).
- **pending_imports**: `owner_id` (primary key), `filename`, `data` (bytea), `created_at`. Holds an uploaded spreadsheet between upload and column mapping.

### Changed tables

- **profile**: primary key becomes `owner_id`. Adds `graph_levels` (jsonb, default `["industry","company"]`).
- **companies**: adds `industry`. Uniqueness becomes `(owner_id, lower(name))`.
- **contacts**: adds `team`, `region`, `school`, `class_year`, `major`, `group_name` (all text, default empty).
- **email_templates**, **messages**, **applications**, **column_mappings**: add `owner_id`. `column_mappings` primary key becomes `(owner_id, signature)`.

### Row-Level Security

- RLS is enabled and forced on every owner-scoped table, with one policy per table: `USING (owner_id = current_setting('app.user_id')::int) WITH CHECK (owner_id = current_setting('app.user_id')::int)`.
- The app connects as role `app_rw`, which is not the table owner. Migrations run as the owner role.
- At the start of each authenticated request, inside the request transaction: `SELECT set_config('app.user_id', <id>, true)`.
- Inserts set `owner_id` from the same session value (column default `current_setting('app.user_id')::int`), so application code does not pass it.
- `users` has no RLS; only auth code and admin routes read or write it.

### New-user setup

On a user's first successful login, the app creates their `profile` row and copies the default email templates into their account.

## 4. Authentication, invites, admin

### Google sign-in

- `/login` redirects to Google (scopes `openid email profile`). `/auth/callback` completes the flow.
- Reject accounts whose `email_verified` is false.
- Matching: by `google_sub` if known; otherwise by lowercase email against a `users` row with null `google_sub`, then store the `google_sub`.
- No match: render "You're not invited. Ask the admin." and create nothing.
- `ADMIN_EMAIL`: if no admin exists and the signed-in email equals `ADMIN_EMAIL`, create that user as admin.
- Session: Flask signed cookie storing `user_id`; 30-day lifetime; `HttpOnly`, `Secure` (in production), `SameSite=Lax`.
- `before_request` requires a session on every route except `/login`, `/auth/*`, `/logout`, and static assets. Unauthenticated requests redirect to `/login`; JSON endpoints return 401.
- `/logout` clears the session.

### Admin page (`/admin`, admin only)

- List users: email, name, role, status (invited / active), AI calls this month, monthly limit.
- Invite by email (creates a `users` row). Set role. Set monthly AI limit.
- Remove user: requires typing the email to confirm; deletes the user and, by cascade, all their data.
- Non-admins get 403.

### AI limits

- Before every AI call, `ai.py` checks `ai_usage` for the current month against the user's `ai_monthly_cap`. Admins are not limited.
- Over the limit: raise `AIError("Monthly AI limit reached (N calls). Ask the admin to raise it.")`.
- Usage increments by one after each successful call (each `ask_json` call counts once, including its single retry).

### Kept protections

- Same-origin POST guard (`Sec-Fetch-Site` / `Origin`).
- `safe_url` filter for user- or AI-supplied links.
- Debug mode off in production.

## 5. Outlook per user

- Replace the device-code flow with the MSAL confidential-client authorization-code flow: "Connect Outlook" → Microsoft → `/outlook/callback`.
- Scopes unchanged: `Mail.ReadWrite`, `User.Read`. Never `Mail.Send`.
- Each user's MSAL token cache is serialized, Fernet-encrypted with `TOKEN_KEY`, and stored in `outlook_tokens`.
- Sync runs when the Today page loads, at most once per 10 minutes per user (`users.last_sync_at`), and on "Sync now".
- The Azure app registration adds the production and local redirect URIs and a client secret.
- The `mailto:` "Open in Outlook" fallback stays for users who do not connect Outlook.

## 6. Contact fields and data quality

### Fields

- Contact: team, region, school, class year, major, group.
- Company: industry. Contacts inherit industry through their company.

### Manual entry

- Contact edit and add forms show the new fields. Company page shows industry.
- Each field offers a native `<datalist>` of the user's existing distinct values for that field.

### Canonical values

- On every save (form, AI, import), each of these fields is trimmed and whitespace-collapsed, then matched case-insensitively against the user's existing values for that field. A match stores the existing spelling. `db.canonical(con, field, value) -> str`.

### AI fill

- `parse_profile` and `find_people` also return school, class_year, major, region, team when evident.
- New companies created from AI results get an `industry` suggestion.
- Contact page button "Fill missing with AI": sends title, company, notes to the model and returns suggested values only for empty fields; the user reviews and saves.
- Every AI prompt that fills these fields includes the user's existing values per field and asks the model to reuse one when it fits.
- All of these count toward the AI limit.

### Import

- `importers.FIELDS` gains the new contact fields plus `industry` (applied to the company).

## 7. Serverless adaptation

| Current | Online |
|---|---|
| `last_search` module list | `searches` table, one row per user |
| `uploads/` directory | `pending_imports` table, one row per user, deleted after import |
| Device-code Outlook login in a thread | Authorization-code redirect flow |
| `.token_cache.json` | `outlook_tokens` (encrypted) |
| In-memory `_last_sync` | `users.last_sync_at` |
| In-memory `_me` address cache | Fetched per sync (one extra Graph call per sync) |
| SQLite file | Neon Postgres |

## 8. Network graph

### Page and data

- New sidebar item "Network" at `/network`.
- `network.build(contacts, levels) -> dict`: pure function returning a nested tree `{"name", "kind": "root"|"group"|"person", "count", "children": [...]}`. Person leaves carry `id, name, title, company, school, class_year, status, overdue`.
- Available levels: `industry`, `company`, `team`, `region`, `school`, `class_year`, `major`, `group_name`, `status`. A person is always the final level. Unknown levels are rejected with 400.
- Empty values group under `"Unknown <level label>"` with `"unknown": true`.
- Groups are sorted by count descending, then name.
- `GET /api/network?levels=a,b,c` returns the tree for the signed-in user (RLS applies). Also saves `levels` to `profile.graph_levels`.

### Level picker

- Chips for the active levels in order; drag to reorder (native HTML drag-and-drop), × to remove, "+ Level" menu to add.
- Each chip has ← → buttons for keyboard reordering.
- Presets: Career (Industry → Company → Team), Campus (School → Class year → Major), Geography (Region → School).
- Opens with the user's saved `graph_levels`.

### Rendering and interaction

- D3 radial tree (`d3.tree` with radial projection, `d3.linkRadial`). The current root is at the center.
- Group node radius scales with `sqrt(count)`. Unknown groups are dashed and grey.
- Person colors: replied or call = green, sent = orange, overdue = red, to contact or drafted = grey, dead = faded.
- Click a group: animated transition (about 500 ms) making it the root. Breadcrumb `You › Fintech › Stripe`. Back via breadcrumb, Escape, or browser back.
- URL hash stores state: `#levels=industry,company&path=Fintech/Stripe`.
- Hover a person: card with name, title, company, school and class year, status, and "Open contact". Click: open contact page.
- Search box highlights matching people and their ancestor path. "Hide dead" toggle.
- If more than 150 people are under the current root, rings deeper than two levels start collapsed (click to expand) and group labels show only on hover when crowded.
- Keyboard: nodes focusable with Tab; Enter drills in or opens a person; Escape goes up one level.
- Empty network: friendly empty state linking to Find people and Import.

## 9. Testing

- pytest against Postgres at `TEST_DATABASE_URL`; schema dropped and re-migrated per test session, tables truncated per test.
- All 41 existing tests ported to Postgres and per-user scoping.
- New tests:
  - RLS isolation: user B cannot select, update, or delete user A's rows, including through a query with no owner filter.
  - Auth: invited user signs in; non-invited user is refused; admin bootstrap via `ADMIN_EMAIL`; unverified email refused; protected routes redirect without a session.
  - Admin: member gets 403; invite, set limit, remove user cascades.
  - AI limit: member blocked at the limit, admin never blocked, usage increments on success only.
  - Canonical values.
  - `network.build`: level order, swapped levels, unknown buckets, counts, sorting, empty input, invalid level.
  - `/api/network` returns only the signed-in user's contacts and saves levels.
  - Outlook token round-trip through encryption (Graph and MSAL faked).
- Manual: deploy preview walkthrough in light and dark mode, headless-Chrome screenshots of the graph at desktop and 500 px widths.

## 10. Rollout phases

Each phase is shippable and ends with a green suite.

1. **Postgres port:** migrations, `owner_id`, RLS, per-request user context; tests ported (a fixed test user stands in for auth).
2. **Auth and admin:** Google sign-in, invites, admin page, AI limits.
3. **Serverless adaptation:** searches, pending imports, Outlook authorization-code flow, encrypted tokens, `last_sync_at`.
4. **Deploy:** private GitHub repo, Vercel project, Neon project and branches, environment variables, Google and Azure redirect URIs. Requires the owner's confirmation before creating external resources.
5. **Contact fields:** new columns, forms with datalists, canonical values, AI fill, import mapping.
6. **Network graph.**
