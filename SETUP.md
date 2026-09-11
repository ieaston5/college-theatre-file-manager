# Setup

Three stages. Stage 1 needs nothing but this repo. Stage 2 connects Google.
Stage 3 is for when you want other people to reach it.

---

## Stage 1 — run it privately (10 minutes, no Google)

```bash
npm install
npm run setup
npm run dev
```

Open <http://localhost:3000> and pick **Production Manager** from the local
sign-in list. You are an admin.

What to click through:

1. **Dashboard** — sample documents across 14 categories and 3 shows.
2. **New document** — make one. Watch the "will be created as" line at the
   bottom change as you pick a category and show.
3. On the success screen, **Open Google Doc** — this opens `/mock-drive/…`, the
   simulated Drive, which lists exactly who the file was shared with.
4. **Edit details** on that document and switch it to **Private**. Go back to
   the mock Drive page: the board group's access is gone.
5. Sign out, sign back in as **Rowan Ellis** (also an admin) and look at
   *Casting & auditions* — the private documents are not there. Private is
   private from admins too.
6. **New document → Upload a file** — drop in a PDF. It gets the same name,
   folder and sharing as anything else; on the document page you can then
   upload a new version over it and the link stays the same.
7. **Admin → Categories** — rename things, change the icons and colours, add
   the categories your board actually uses. This is the part worth spending
   time on: the categories are the whole product. Note the **“production
   companies can see documents here”** switch: on for schedules, scripts,
   contact sheets and the like; off for budgets, casting and governance.
8. **Admin → Production roles** — Cast, Stage management, Design & tech,
   Costumes & props and Music are set up already. Each one lists exactly which
   categories that job can see; change them to match how your shows run.
9. **Productions → Urinetown → Company** — a sample company is loaded. Try
   pasting three of your own email addresses into the box, and watch the count
   on the light plot's “who can see this” panel change.
10. Sign out and sign back in as **Nadia Brooks** (Cast) from the login screen.
    Five categories instead of fourteen, one show, no budgets, no casting, no
    create button. Then try **Wes Kaplan** (Lighting Designer): he gets design
    and costumes, and no script.
11. **Admin → Settings** — the file naming rule has a live preview.

Everything you change here carries over to stage 2. Only the sample documents
are throwaway (Admin → Settings → **Remove sample data**).

---

## Stage 2 — connect Google for real

### 2a. Make the account that will own the documents

Create one new Google account, e.g. `pennplayers.hub@gmail.com`, and keep the
password in the board's password manager. **Do not use a personal account.**
Every document the hub creates is owned by this account, which is what stops
paperwork from vanishing when someone graduates.

While you are there, note the board's Google Group address (the one you already
use for mass email). Board documents get shared with that group.

### 2b. Create the OAuth client

In the [Google Cloud console](https://console.cloud.google.com), signed in as
**the account from 2a**:

1. **New project** → name it `Penn Players Hub`.
2. **APIs & Services → Library** → enable: *Google Drive API*, *Google Docs
   API*, *Google Sheets API*, *Google Slides API*, *Google Forms API*,
   *Gmail API*.

   The Forms one is needed because a Google Form is the single file type the
   Drive API cannot create — a blank form has to come from the Forms API. (A
   form copied from one of your templates is an ordinary Drive copy and works
   either way.)

   The Gmail one is easy to skip and the failure is confusing: sign-in and
   documents work fine, and then the first welcome email or digest fails with
   *"Gmail API has not been used in project … before or it is disabled"*. The
   hub sends its own mail from the hub account rather than through a third
   party, which is why it needs it. Skip it deliberately if you never want the
   hub to send email — everything else works, and messages are recorded in
   Admin → Email instead of being sent.
3. **APIs & Services → OAuth consent screen**
   - User type: **External**
   - App name `Penn Players Hub`, support email = the hub account
   - Scopes: you can leave this blank; the app requests them at run time
   - **Test users**: add every board email that will sign in, plus the hub
     account itself. While the app is in "testing" mode only these addresses
     can use it, which is exactly what you want. Google shows an
     "unverified app" warning — click *Advanced → Go to Penn Players Hub*.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Type: **Web application**
   - Authorised redirect URIs — add both, exactly:
     - `http://localhost:3000/api/auth/google/callback`
     - `http://localhost:3000/api/google/callback`
   - Copy the **client ID** and **client secret**.

> Admin → Google & settings always prints the exact redirect URIs for the
> current `APP_URL`. When you deploy, add the deployed versions of both.

### 2c. Put them in `.env`

```dotenv
GOOGLE_CLIENT_ID="…apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="…"
DRIVE_MODE="google"
```

Restart `npm run dev`.

### 2d. Connect the account

1. Sign in to the hub as yourself.
2. **Admin → Google & settings → Connect the hub's Google account**.
3. Sign in as `pennplayers.hub@gmail.com` and approve Drive, Docs, Sheets,
   Slides and *send email on your behalf*. This is the only account that ever
   grants any of this — board members only sign in.
4. The hub creates `Penn Players Hub / Productions` and
   `Penn Players Hub / Organisation-wide` in that account's Drive.
5. Still in **Settings**, set the **Board Google Group** to your real group
   address and save. If you had already created documents, press **Re-apply
   sharing everywhere**.

### 2e. Add the board

**Admin → Members → Add a member**, one row per board email, with a role:

| Role | Can |
|---|---|
| Admin | everything, including settings and members |
| Board | create and edit documents |
| Member | read board documents |

They must also be in the OAuth **test users** list from 2b until the app is
verified, or Google will refuse their sign-in.

Whether they get an email depends on one switch. The hub's email is **off until
you turn it on** in *Admin → Email*, so nothing is ever sent by surprise: with
it off, every message the hub would have sent is written to the log on that page
instead, which is worth reading before you switch it on. With it on, adding a
member sends them a short note explaining what the hub is and how to sign in,
from the hub account.

### 2f. Cast and crew (nothing extra to configure)

Company members never grant Drive access and never need a hub invitation from
you beyond being told the address:

1. **Productions → the show → Company**.
2. Paste the cast list — one per line, or the email column straight out of your
   existing contact sheet. `Nadia Brooks nadia@gmail.com Hope Cladwell` parses
   into name, address and part.
3. Pick what they are doing on the show; **Add to the company**.
4. Use **Copy invite message** and send it however you already talk to the
   company.

In Drive, company documents are shared with each of those people individually
as viewers — they are not in the board's Google Group, and putting them in it
would give them everything. Adding somebody backfills access to everything
already filed for the show; removing them revokes it. Changing a role's
categories re-shares every affected document across every show.

> They must also be in the OAuth **test users** list (2b) until the app is
> verified — that is the one piece of Google friction for a company, and it is
> a copy-paste of the same addresses into the Cloud console.

### 2g. Canva (optional)

Skip this unless the club designs posters or decks in Canva.

**What you should know first.** Canva's API cannot manage who can open a
design: there is no design-permission endpoint, the one permission-shaped scope
(`folder:permission:write`) has no endpoint behind it, and the URLs the API
returns are single-user and expire after 30 days. So the hub cannot put a Canva
design itself behind Company/Board/Private. What it does instead is keep an
exported copy in Drive, which the hub *can* control completely. The design
stays in Canva for the designers.

1. In the [Canva Developer Portal](https://www.canva.dev/), with MFA enabled on
   the account, create an integration. Choose **Public** — "Private" needs a
   Canva Enterprise plan. You do **not** need to submit it for review to use it
   with your own account; review is only for listing it to all Canva users.
2. Scopes: `design:meta:read`, `design:content:read`, `profile:read`.
3. Redirect URL: whatever Admin → Canva connection shows. Canva rejects
   `localhost`, so locally it is `http://127.0.0.1:3000/api/canva/callback`.
4. Put the client id and secret in `.env` as `CANVA_CLIENT_ID` and
   `CANVA_CLIENT_SECRET`, set `CANVA_MODE="canva"`, restart.
5. **Browse the hub at `http://127.0.0.1:3000` while connecting**, then
   Admin → Canva connection → Connect. Sign in as the account that can open the
   club's designs.
6. Designers share each design with that account (view access is enough), then
   anybody on the board can paste the link into New document → Canva design.

Notes worth knowing:

- Export needs no paid Canva plan. A *pro-quality* export would, so the hub
  always asks for regular quality.
- A design containing purchased-only premium elements will refuse to export;
  Canva says so and the hub passes the message through.
- Only PDF and PowerPoint are offered, because other formats come back as one
  file per page.
- `CANVA_MODE="off"` hides the feature entirely.

### 2h. Templates (the biggest time-saver)

Make your ideal rehearsal report, budget skeleton and contact sheet in the hub
account's Drive, then **Admin → Templates → Add a template** with the link. Put
`{{TITLE}}`, `{{PRODUCTION}}`, `{{CATEGORY}}`, `{{OWNER}}`, `{{DATE}}` anywhere
in the file and they get filled in on each copy.

### 2i. Email and the weekly digest (optional)

The hub can send its own mail from the hub account: a short welcome when
somebody is added, a notice when a document is shared with one person, and a
weekly digest of what changed — built per person, so a cast member's digest
never mentions a board document.

It is **off by default**, and while it is off every message is written to the
log in *Admin → Email* rather than sent. Read a few, then:

1. *Admin → Email* → **Send a test digest to myself**. It arrives from the hub
   account. If it does not, that page shows the exact error.
2. Turn email on with the switch.
3. *Admin → Scheduled* → pick the digest day (Monday works well). Anybody can
   silence their own digest from their profile.

If you skipped the Gmail API in 2b, the test will fail with a message saying so.

### 2j. Check it end to end

- Create a Board document → it appears in the hub account's Drive in the right
  folder, and a board member on the group can open it.
- Create a Private document → nobody else sees it, in the hub or in Drive.
- Flip it to Board → the group gets access. Flip it back → access is removed.
- Create a Company document in a company-visible category → each person on the
  show whose role covers it appears in "who can see this", and can open it.
- **Add existing** with a link to one of your current spreadsheets. If the hub
  cannot see the file, share that file with the hub account first, or tick
  *just save the link*.
- Upload a PDF, then upload a second version over it. The Drive link should not
  change and Drive's *File → Version history* should show both.
- Mirror a Canva design, edit it in Canva, wait half an hour, and reload the
  document in the hub: opening it checks Canva, so the copy in Drive should be
  refreshed for you. Check the Drive file kept its link and gained a revision.
- **Disable a member** in Admin → Members. They lose the hub immediately. Their
  *Drive* access depends on which sharing mode you chose in Admin → Sharing: on
  **per-member** sharing their permission is removed from every board document
  too, which is what makes offboarding real; on **group** sharing the hub cannot
  see inside a consumer Google Group, so you must also remove them from the
  group by hand. The Sharing page says which you are on.

---

## Stage 3 — put it on the internet

Everything below is ready to run. Budget an hour, most of it waiting for a
database to provision. Do it in this order — the Google redirect URIs need the
real domain, which you do not have until the deploy exists.

### 3a. Move to Postgres — do this *before* the first deploy

SQLite is a file on one machine. On a serverless host it does not merely
perform badly, it cannot work: the filesystem is read-only and thrown away
between requests, so there is nowhere for `dev.db` to live. **Deploying the
SQLite schema produces a site where every page is a 500** —

```
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:15
14 |   provider = "sqlite"
```

— which is Prisma saying two things at once: the variable is missing, *and* the
provider is still the local one. Both are fixed here.

**1. Get a database.** [Neon](https://neon.tech) and
[Supabase](https://supabase.com) both have a free tier that is plenty for a
club.

Two URLs, because serverless opens and drops connections constantly — which a
pooler is built for and a Postgres server is not — while migrations need a
connection that is *not* in transaction-pooling mode, because they use prepared
statements and advisory locks that such a pooler will not pass through. Both
must be set, here and on the host: Prisma refuses to generate at all when
`DIRECT_URL` is missing.

**Supabase** offers *three* strings (Project Settings → Database → Connection
string), and picking wrongly fails in two different confusing ways. Take these
two:

| Variable | Which Supabase string | Port |
| --- | --- | --- |
| `DATABASE_URL` | **Transaction pooler**, plus `?pgbouncer=true&connection_limit=1` | 6543 |
| `DIRECT_URL` | **Session pooler** | 5432 |

- Using the transaction pooler (6543) for `DIRECT_URL` is the single commonest
  mistake: migrations fail with prepared-statement errors.
- Use the **session pooler**, not the *direct connection*
  (`db.<ref>.supabase.co`), for `DIRECT_URL`. The direct connection is
  IPv6-only unless you have bought the IPv4 add-on, so it fails from most
  laptops and build machines with a "can't reach database server" that looks
  like a wrong password. Session mode is the IPv4-safe equivalent and is fine
  for migrations.
- Both strings contain your database password where Supabase writes
  `[YOUR-PASSWORD]`. Replace it, and if it contains `@ : / ?` or `#`,
  percent-encode those characters or the URL will parse wrongly.

The two you want look like this — identical apart from the port:

```dotenv
# DATABASE_URL — transaction pooler, port 6543, params appended by you
postgresql://postgres.abcdefghijklmnop:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1

# DIRECT_URL — session pooler, port 5432, no params needed
postgresql://postgres.abcdefghijklmnop:PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```

Copy them from the dashboard rather than typing them from the above: the region
prefix varies (`aws-0-`, `aws-1-`, …) and `abcdefghijklmnop` stands for your own
project reference. The shape is worth knowing so you can tell the three strings
apart at a glance:

| | Username | Host | Port |
| --- | --- | --- | --- |
| Transaction pooler → `DATABASE_URL` | `postgres.<ref>` | `…pooler.supabase.com` | 6543 |
| Session pooler → `DIRECT_URL` | `postgres.<ref>` | `…pooler.supabase.com` | 5432 |
| Direct connection → *don't use* | `postgres` | `db.<ref>.supabase.co` | 5432 |

So: a dot in the username means a pooler, and the port tells you which. A
`db.` host is the one to avoid.

**Neon** is simpler: its *pooled* string is `DATABASE_URL` and its *unpooled*
string is `DIRECT_URL`.

**2. Switch the project over.**

```
npm run use-db -- postgres
```

This rewrites the whole datasource block in `prisma/schema.prisma`, including
the `directUrl` line, and prints the follow-up commands.

**3. Point your local `.env` at it.**

```
DATABASE_PROVIDER=postgresql
DATABASE_URL="postgres://…?sslmode=require&pgbouncer=true"   # pooled: the app
DIRECT_URL="postgres://…?sslmode=require"                    # direct: migrations
```

`DATABASE_PROVIDER=postgresql` also switches the hub's search from
case-sensitive `LIKE` to Postgres' `ILIKE`, so searching "budget" starts
matching "Budget" too.

**4. The schema.** `prisma/migrations/0_init/` is already in this repository —
the whole Postgres schema, generated from `schema.prisma` by Prisma itself. The
deployment applies it during its build, so there is nothing to run here for a
fresh database. If you would rather apply it from your machine first, or you
are changing the schema later:

```
npx prisma migrate deploy    # apply what exists
npx prisma migrate dev --name whatever   # after editing schema.prisma
```

**5. Load the starting data.** This is the one step that needs a database
connection from somewhere, because the hub is unusable without categories and
production roles — no category means no way to file a document.

```
npm run db:seed
```

Run it **once**: the categories, roles and people are upserts, but the
checklist templates, templates and sample documents are plain inserts, so a
second run duplicates them. Then, once you are signed in, Admin → Settings →
**Remove sample data** clears the demo documents and keeps your categories.

**6. Commit `prisma/schema.prisma` and `prisma/migrations/`.** Easy to miss and
confusing to debug: the deployment runs `prisma migrate deploy` during its
build, so if the migration files are not in the repository the build succeeds
and the site then reports missing tables.

Everything you set up in stages 1–2 lives in the old SQLite file, which does
not travel. If you had already done real work there, carry it over rather than
redoing it:

```
npm run use-db -- sqlite && npm run backup     # dump from SQLite
npm run use-db -- postgres                     # then, after step 4
npm run restore -- backups/<file>.json
```

Local development from here on uses Postgres too. The simplest arrangement for
a club is to point your local `.env` at the same database; if you would rather
not develop against live data, Neon can branch it.

### 3b. Deploy to Vercel

Push the repository to GitHub, then *Add New → Project* in Vercel and pick it.
It is a stock Next.js app: no build settings to change. Set these environment
variables (Project → Settings → Environment Variables) before the first
deploy:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the **pooled** Postgres URL |
| `DIRECT_URL` | the **direct** Postgres URL |
| `DATABASE_PROVIDER` | `postgresql` |
| `APP_URL` | `https://<your-domain>` — no trailing slash |
| `SESSION_SECRET` | fresh: `openssl rand -base64 48` |
| `APP_ENCRYPTION_KEY` | fresh: `openssl rand -base64 32` |
| `CRON_SECRET` | fresh: `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from stage 2b |
| `DRIVE_MODE` | `google` |
| `ALLOW_DEV_LOGIN` | `false` |
| `BOOTSTRAP_ADMIN_EMAILS` | your address, so you can sign in to an empty hub |
| `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` | only if you use Canva (2g) |

Set them for **Production** at least. Vercel also builds a Preview deployment
for every push, and one with no `DATABASE_URL` fails exactly as above — so
either give Preview the same values, or accept that preview URLs 500 and only
use the production domain. Be aware of what sharing means: a preview pointed at
the same database reads and writes the real data, and `vercel-build` will apply
migrations to it. For one club that is usually the sane trade; if it is not,
give Preview a Neon branch of its own.

**Generate new secrets; do not copy the local ones.** They have been in a file
on your laptop, in your shell history, and possibly in a screenshot. Note that
`APP_ENCRYPTION_KEY` is what the stored Google refresh token is encrypted with,
so a new key means reconnecting the Google account on the new deployment — 
which you have to do anyway, since the token does not travel.

Environment variables are read at build and boot, so **changing one requires a
redeploy** — Vercel does not apply it to the running deployment. Deployments →
⋯ → *Redeploy* on the latest one.

### 3c. Point Google at the real domain

Back in the OAuth client (stage 2b), add to **Authorised redirect URIs**:

```
https://<your-domain>/api/auth/google/callback
https://<your-domain>/api/google/callback
```

Leave the `localhost` ones in place; an OAuth client can have several, and you
will still want to run it locally. If you use Canva, add
`https://<your-domain>/api/canva/callback` to the Canva app's return URLs too.

Use the **stable production domain** (`<project>.vercel.app` or your own), and
make `APP_URL` exactly that, with no trailing slash. The hub builds its redirect
URI from `APP_URL`, so if the two disagree Google refuses with
`redirect_uri_mismatch`. This is also why sign-in does not work on preview
deployments: each one has its own generated hostname, which is neither
registered nor what `APP_URL` says.

Keep the app in **Testing** status with the board (and any company members who
sign in) as test users. That caps you at 100 accounts and shows an "unverified
app" screen once per person, and it avoids Google's verification review
entirely. Verification for `drive` scope means a security assessment (CASA)
repeated annually, at real cost — not worth it for one club. If you outgrow 100
people, the honest answer is a Google Workspace account rather than
verification.

### 3d. Switch the schedule on

`vercel.json` asks Vercel to call `/api/cron` once a day, at 08:00 UTC, and it
starts working as soon as `CRON_SECRET` is set. Check *Admin → Scheduled* the
day after the first deploy: "last scheduled run" should be recent.

**Daily is deliberate: Vercel's free Hobby plan allows cron jobs, but only at
daily granularity.** A more frequent expression such as `0 * * * *` is not
downgraded — it fails the build with *"Hobby accounts are limited to daily cron
jobs"*. Vercel also runs the job at any point inside the chosen hour, to spread
load, so 08:00 means "some time between 08:00 and 08:59".

Once a day is fine for the digest, which goes out weekly anyway, and for a
re-share sweep, which the admin page runs interactively while you watch.

Canva is the one that would suffer, so it does not rely on the schedule at all:
**opening a mirrored document checks Canva there and then**, and re-exports if
the design has moved on and been quiet for half an hour. Asking Canva is cheap,
it happens at the moment somebody is about to use the copy, and any viewer
triggers it — a cast member opening a poster is exactly who should not be handed
last week's version. A check less than five minutes old is trusted, so a page
that is reloaded repeatedly does not hammer Canva, and a design somebody is
still editing is reported rather than grabbed mid-edit. Turning off *keep Canva
copies up to date on their own* leaves the checks and stops the exports.

So the schedule is a backstop for mirrors nobody has opened, not the mechanism.

Three ways to get hourly:

1. **Vercel Pro.** Change the schedule in `vercel.json` to `0 * * * *` and
   redeploy. Nothing in the app changes.
2. **Any external scheduler**, free, and my recommendation while you are on
   Hobby. The endpoint is a plain authenticated GET, so anything that can make
   an HTTPS request on a timer works — GitHub Actions, cron-job.org, a Raspberry
   Pi, another always-on machine:

   ```
   curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron
   ```

   As a GitHub Actions workflow, with `HUB_URL` and `CRON_SECRET` set under
   *Settings → Secrets and variables → Actions*:

   ```yaml
   # .github/workflows/hub-cron.yml
   name: Hub scheduled jobs
   on:
     schedule:
       - cron: "0 * * * *"
     workflow_dispatch:
   jobs:
     run:
       runs-on: ubuntu-latest
       steps:
         - run: |
             curl -sS --fail-with-body \
               -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
               "${{ secrets.HUB_URL }}/api/cron"
   ```

   GitHub throttles scheduled workflows under load and skips them entirely on
   repositories with no activity for 60 days, so it is not a precision
   instrument either — which is exactly why every job here is idempotent and
   cheap to skip.
3. **Leave it daily.** For a club of this size this is a perfectly reasonable
   answer; press the buttons when you need something now.

Calling `/api/cron` more often than needed is harmless: each job checks whether
it has anything to do, and the Canva refresh will not re-export a design
somebody is still editing.

### 3e. First sign-in on the real thing

1. Sign in with your own address — `BOOTSTRAP_ADMIN_EMAILS` makes it an admin.
2. *Admin → Google connection*: connect the hub account (stage 2a). This is a
   separate connection from your sign-in and has to be done again per
   deployment.
3. *Admin → Settings*: set the board group address and the naming template.
4. *Admin → Members*: add the board. They get a welcome email if email is on.
5. *Admin → Import*: point it at your existing Drive folder.

### 3f. Back it up

The files live in Google Drive, so Google is backing those up. What is only
here is the *organisation* — categories, shows, the board list, who may see
what — and that is the part that makes the pile navigable.

```
npm run backup                     # writes backups/hub-<timestamp>.json
npm run restore -- <file> --dry-run
npm run restore -- <file>
```

The dump deliberately holds no Google or Canva tokens, so it is safe to keep in
Drive itself. Run it before each season rollover and before any upgrade. Your
Postgres host almost certainly also offers point-in-time restore — use both;
they fail differently.

If you ever lose the database *and* the dumps, every file the hub created or
imported carries its own labels in Drive (category, show, visibility), and:

```
npm run rebuild                    # reports what it would recover
npm run rebuild -- --apply
```

reconstructs the index from the folder tree. It cannot bring back tags,
descriptions written in the hub, per-person shares or the activity log, and it
files everything as read-only until you say otherwise — but it gets the
dashboard back.

---

## Troubleshooting

**Every page on the deployed site is a 500, and the log says `Environment
variable not found: DATABASE_URL` pointing at `provider = "sqlite"`.** The
deployment is still on the local database. Both halves need fixing and stage 3a
does both: run `npm run use-db -- postgres`, create and **commit** the
migration, and set `DATABASE_URL` / `DIRECT_URL` / `DATABASE_PROVIDER` in the
host's environment. Adding the variables alone is not enough — SQLite cannot
run on a host with a read-only, disposable filesystem, whatever `DATABASE_URL`
says.

**Sign-in bounces to `/login` or `/no-access` and the log shows a Prisma
error.** Sign-in is not broken; the database is unreachable. The OAuth round
trip stores its state in a table, so no database means no sign-in. Fix the
database and try again before looking at anything Google-related.

**The build succeeds but the site says a table does not exist.**
`prisma/migrations/` is not in the repository, so `prisma migrate deploy` had
nothing to apply. Commit it.

**A change to an environment variable had no effect.** They are read at build
and boot. Redeploy.

**The host's log shows `[DEP0169] DeprecationWarning: url.parse()` at error
level.** Harmless, and not yours: it comes from inside Google's client library,
and Vercel files anything Node writes to stderr — warnings included — as an
error. Judge a request by its status code, not by whether a line appeared. A
successful server action still logs `200`.

**`P1000: Authentication failed against database server … credentials for
`postgres` are not valid`.** Nine times in ten the connection string still
contains Supabase's placeholder — the literal text `[YOUR-PASSWORD]`, square
brackets included — because it is copied from the dashboard as one line and the
slot is easy to miss. Replace it, brackets and all, in **both** strings and in
**both** places (`.env` and the host's environment).

If you never noted the database password, it is not recoverable: Project
Settings → Database → **Reset database password**, which does not touch your
data. Take the one Supabase generates rather than inventing one, and if it
contains `@ : / ? #` or `%`, percent-encode those characters in the URL.

**Migrations fail with a prepared-statement error** (`prepared statement "s0"
already exists`, or `ERROR: prepared statement does not exist`). `DIRECT_URL`
is pointing at a transaction-mode pooler — Supabase's port 6543. Use the
session pooler on 5432 instead.

**"Can't reach database server" from your laptop or the build, with a password
you know is right.** On Supabase, `db.<ref>.supabase.co` is IPv6-only without
the IPv4 add-on. Use the session pooler string
(`aws-…pooler.supabase.com:5432`) for `DIRECT_URL`.

**The build fails at `prisma generate` with `Environment variable not found:
DIRECT_URL`.** Exactly what it says: the datasource needs both URLs. Add it to
the host's environment, using the same value as `DATABASE_URL` if your database
genuinely has no second endpoint.

**"Request is missing required authentication credential. Expected OAuth 2
access token…"** while connecting the hub's Google account. The consent
succeeded and the *next* step failed: the hub asks Google which account it just
connected, which needs the `openid` and `email` scopes. If you are running a
version of this project from before those were added to `DRIVE_SCOPES`, update
and connect again — Google will show the consent screen once more, now
including "See your primary Google Account email address".

**Admin → Google connection says "Reconnect needed".** The hub has been
upgraded and now asks Google for a scope the existing connection never granted
— creating Google Forms, for instance. Press *Reconnect / switch account* and
approve; nothing else is affected, and no files move.

**Creating a form fails with a permissions error, or "Google Forms API has not
been used in project…".** Enable the *Google Forms API* (2b), then reconnect
the hub account so the grant includes it.

**"Google did not return a refresh token."** The hub account has already
granted access. Remove *Penn Players Hub* from
<https://myaccount.google.com/permissions> on the hub account, then connect
again.

**"The hub's Google account cannot see that file."** Registering only works for
files the hub account can open. Share the file with the hub account as an
editor, or tick *just save the link*.

**"Could not share with …"** Google refused the group share. Check the group
address, and that the group accepts members/files from outside — Google Groups
can be configured to reject it.

**`Error 400: redirect_uri_mismatch`, and the URI in the message looks
correct.** It probably *is* correct — the hub builds it from `APP_URL` — and the
problem is that it has not been registered. Google Cloud console → APIs &
Services → **Credentials** → your OAuth 2.0 Client ID → **Authorised redirect
URIs** → add the one from the error, verbatim. Then:

- Paste under *Authorised redirect URIs*, not *Authorised JavaScript origins*.
  The second is for a different kind of app and will not help.
- Google matches the whole string exactly: scheme, host, path, no trailing
  slash. `https://…/api/auth/google/callback/` is a different URI.
- Add the sign-in **and** the Drive-connection callback while you are there,
  or connecting the hub account fails the same way one step later.
- If you have more than one OAuth client, check you are editing the one whose
  client ID is in the host's `GOOGLE_CLIENT_ID`. Editing the wrong client
  changes nothing and looks identical.
- Changes usually take effect immediately, occasionally a few minutes. Admin →
  Google & settings prints both URIs for whatever `APP_URL` the deployment
  currently has, so you can copy rather than retype.

**Access blocked / app not verified.** The signing-in address is not in the
OAuth **test users** list (2b).

**Everything still says "Simulated Drive".** `DRIVE_MODE` is not `google`, or
the app was not restarted after editing `.env`.
