# Penn Players Hub

One dashboard for everything the board keeps. Members create documents **here**
instead of in Google Drive; the hub names the file, files it in the right Drive
folder, links it to a production and shares it with exactly the right people.

Built for a private environment first — it runs end to end on your laptop with
no Google account at all, and switches to real Google Drive when you add
credentials.

```bash
npm install
npm run setup     # generate the client, create the database, load sample data
npm run dev       # http://localhost:3000
```

Sign in with the local sign-in list on the login screen (no Google needed
while `ALLOW_DEV_LOGIN=true`). `ieaston@upenn.edu` is seeded as the admin.

---

## What it does

**Creating.** A single form: name, type (Doc / Sheet / Slides / **upload a
file**), category, production, who can see it. From that the hub

- names the file from a rule you control, e.g. `[URINETOWN] Running budget — Budgets & finance`
- creates it in `Penn Players Hub / Productions / Urinetown / Budgets & finance`
- optionally copies one of your templates and fills in `{{TITLE}}`, `{{PRODUCTION}}`, `{{CATEGORY}}`, `{{OWNER}}`, `{{DATE}}`
- stamps a small header into new Docs so a file found in Drive still explains itself
- shares it according to its visibility (see below)

**Uploading.** Any file type, under exactly the same rules — a PDF script, a
ticket-sales export from Penn Live Arts, a scan, a photo, a vocal score. Drop
several at once and each takes its own filename as its title. The extension is
preserved through the naming rule, so you get
`[URINETOWN] Script — Scripts & scores.pdf`.

Uploaded files also get **new versions**: upload an updated file over the old
one and the Drive file id, link and sharing stay the same while Drive keeps the
previous revision. That is the end of `Script_FINAL_v3.pdf`.

Bytes go straight from the browser to Google through a resumable session the
server opens, so large files are not limited by the host's request-body cap,
and the file's name, folder and metadata are fixed server-side where the
browser cannot change them.

**Canva.** Canva's API cannot grant a person access to a design — there is no
design-permission endpoint, and the links it returns work only for the calling
account and expire after 30 days. So the hub *mirrors* a design instead: paste
the Canva link, and the hub exports the design and files the export in Drive,
where Private / Company / Board already works. Canva stays the place it is
edited; the hub owns the copy people read.

The hub tracks the design's `updated_at`, so a mirror whose original has moved
on is flagged "Canva newer" in lists and offers a one-click re-export — which
replaces the same Drive file, keeping its link, its sharing and its Drive
revision history.

Canva has no "design updated" webhook, so freshness is checked three ways, in
order of usefulness: **when somebody opens the document** (any viewer, throttled
to one check per five minutes, skipping designs edited in the last half hour),
on the scheduled run, and on demand from the button. The first is what makes a
daily schedule survivable — the copy is refreshed at the moment somebody is
about to use it, rather than whenever the host next calls.

**Finding.** The dashboard is organised by *type of information* (the sidebar),
crossed with *production*. Every category and show has its own page; there is
one search box over titles, descriptions, tags, categories and shows; filters
for type, visibility, "filed by me" and archived.

**Access.** Nobody can see the hub unless they have been added. Board roles:
`ADMIN` (settings, members, categories, productions, Google), `BOARD` (create
and edit), `MEMBER` (read board documents). Plus a fourth population:

**Company members.** Cast and crew are added *from a production*, not from the
board list, and get a `COMPANY` account with no board access at all. What they
see is computed, not hardcoded:

```
production membership  →  production role  →  categories the role covers
```

Production roles (Cast, Stage management, Design & tech, Costumes & props,
Music by default) are admin-editable, as is which categories may be offered to
a company at all. Budgets, casting, box office, governance, grants and venue
are board-only out of the box, so they are never even offered as "Company" and
never appear to a company member. Adding somebody to a show backfills their
Drive access to everything already filed; removing them revokes it.

Three visibility levels on every document:

| | Who |
|---|---|
| **Private** | the creator, plus anyone they add by hand |
| **Company** | the board, plus people on that production whose role covers this category |
| **Board** | everyone with board access |

Mirrored Canva designs obey the same three levels, because what is being shared
is the exported copy in Drive rather than the Canva design.

**Privacy.** `PRIVATE` means private, including from admins. A private document
is never listed for anyone but its creator and the people they add by hand, and
is never shared with the group in Drive. Flipping a document down a level
revokes the wider Drive access on the spot. The activity log deliberately omits
the titles of private documents.

**Institutional memory.** One dedicated Google account owns every document the
hub creates, so nothing disappears when a board member graduates. Existing
files can be registered (link + metadata) without changing their ownership.

**On its own.** One scheduled request to `/api/cron` (Vercel Cron, or anything
else that can call a URL on a timer) finishes re-share sweeps, re-exports Canva
copies whose originals have moved on and gone quiet, and sends the weekly
digest on the chosen day. Every job decides for itself whether there is
anything to do, so a missed run costs nothing and a double run does nothing
twice. `vercel.json` ships daily, because Vercel's free plan rejects anything
more frequent; SETUP.md step 3d covers hourly. Admin → Scheduled shows what ran
and lets you trigger it by hand.

**If it all goes wrong.** `npm run backup` writes the whole index — categories,
shows, members, documents, who may see what — to one JSON file with no
credentials in it, and `npm run restore` puts it back. Failing that, every file
the hub created or imported carries its category, show and visibility in its own
Drive `appProperties`, and `npm run rebuild` reconstructs the dashboard from the
folder tree alone.

---

## Two modes

| | `DRIVE_MODE=mock` (default with no credentials) | `DRIVE_MODE=google` |
|---|---|---|
| Files | Simulated, browsable at `/mock-drive/<id>` | Real Google Docs / Sheets / Slides |
| Sharing | Recorded and shown on the mock file page | Real Drive permissions |
| Google account needed | None | One, connected in Admin |

Mock mode exists so you can click through the whole thing — including the
sharing rules — before deciding to point it at the club's Google account.
See [SETUP.md](SETUP.md) to switch it on for real.

---

## Layout

```
app/
  (app)/                  everything behind the sign-in gate
    page.tsx              dashboard
    documents/            list · new · register · detail · edit
    categories/           overview · per category
    productions/          overview · per show · per show's company
    admin/                Google & settings · members · production roles · categories · productions · templates · activity
  api/auth/               Google sign-in, local dev sign-in, sign-out
  api/google/             connecting the hub's document-owning account
  api/uploads/            start · finish · proxy · mock · blob (upload plumbing)
  api/canva/              connect · callback (the hub's Canva account)
  mock-drive/[id]/        the simulated Drive viewer
  actions/                server actions (every mutation)
lib/
  access.ts               who can see and edit a document — the one place
  auth.ts                 session cookie, role gates
  documents.ts            create / upload / register / update / share, DB + Drive together
  upload-client.ts        browser side of the upload flow
  google/                 oauth.ts · real.ts (Drive API) · mock.ts · upload.ts · index.ts
  canva/                  oauth.ts (PKCE) · real.ts (Connect API) · mock.ts · index.ts
  constants.ts            roles, doc types, visibilities — the enum vocabulary
  cron.ts                 the scheduled jobs; each one decides if it has work
  rate-limit.ts           database-backed fixed-window limits
  db-portability.ts       the SQLite/Postgres differences, in one place
prisma/
  schema.prisma           SQLite now, portable to Postgres
  seed.ts                 sample categories, shows, members and documents
scripts/
  export-metadata.ts      npm run backup
  restore-metadata.ts     npm run restore
  rebuild-from-drive.ts   npm run rebuild — the no-backup disaster path
  use-database.mjs        npm run use-db
```

## Scripts

| | |
|---|---|
| `npm run dev` | development server |
| `npm run setup` | generate client + create DB + seed |
| `npm run db:reset` | wipe the local DB and reseed |
| `npm run db:studio` | browse the database |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | production build |
| `npm run backup` | dump the index to `backups/hub-<timestamp>.json` |
| `npm run restore -- <file> [--dry-run]` | put a dump back, row by row |
| `npm run rebuild -- [--apply]` | reconstruct documents from Drive's own labels |
| `npm run use-db -- <sqlite\|postgres>` | switch the Prisma datasource |

## Notes for whoever picks this up

- Sample content is tagged `"sample": true` in `Document.metadata`. Admin →
  Settings has a one-click **Remove sample data**. The seed also creates a
  sample company for the active show so the access layer is visible; sign in as
  one of them from the login screen.
- The seeded board group is a placeholder
  (`pennplayers-board@googlegroups.com`). Change it in Admin → Settings before
  connecting a real Google account.
- Text search goes through `containsInsensitive` in `lib/db-portability.ts`,
  which adds Prisma's `mode: "insensitive"` only when `DATABASE_PROVIDER` says
  Postgres — the option does not exist for SQLite and Prisma rejects it.
- Rate limits live in `lib/rate-limit.ts`, counted in the database rather than
  in memory because a serverless host may answer each request from a different
  process. Response headers, including the CSP, are in `next.config.ts`.
- Local sign-in must be switched off (`ALLOW_DEV_LOGIN=false`) before this goes
  anywhere public. It is disabled automatically in production builds.
- **Restart `npm run dev` after any schema change.** Changing
  `prisma/schema.prisma` means `prisma db push && prisma generate`, and a
  running dev server keeps the old generated client in memory — the symptom is
  `Cannot read properties of undefined (reading 'findMany')` on the new model.
