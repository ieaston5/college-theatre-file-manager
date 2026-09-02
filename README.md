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

**Creating.** A single form: name, type (Doc / Sheet / Slides), category,
production, who can see it. From that the hub

- names the file from a rule you control, e.g. `[URINETOWN] Running budget — Budgets & finance`
- creates it in `Penn Players Hub / Productions / Urinetown / Budgets & finance`
- optionally copies one of your templates and fills in `{{TITLE}}`, `{{PRODUCTION}}`, `{{CATEGORY}}`, `{{OWNER}}`, `{{DATE}}`
- stamps a small header into new Docs so a file found in Drive still explains itself
- shares it: **Board** → the board's Google Group; **Private** → nobody but the creator

**Finding.** The dashboard is organised by *type of information* (the sidebar),
crossed with *production*. Every category and show has its own page; there is
one search box over titles, descriptions, tags, categories and shows; filters
for type, visibility, "filed by me" and archived.

**Access.** Nobody can see the hub unless an admin has added their email.
Three roles: `ADMIN` (settings, members, categories, productions, Google),
`BOARD` (create and edit), `MEMBER` (read board documents).

**Privacy.** `PRIVATE` means private, including from admins. A private document
is never listed for anyone but its creator and the people they add by hand, and
is never shared with the group in Drive. Flipping a document from Board back to
Private revokes the group's Drive access on the spot. The activity log
deliberately omits the titles of private documents.

**Institutional memory.** One dedicated Google account owns every document the
hub creates, so nothing disappears when a board member graduates. Existing
files can be registered (link + metadata) without changing their ownership.

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
    productions/          overview · per show
    admin/                Google & settings · members · categories · productions · templates · activity
  api/auth/               Google sign-in, local dev sign-in, sign-out
  api/google/             connecting the hub's document-owning account
  mock-drive/[id]/        the simulated Drive viewer
  actions/                server actions (every mutation)
lib/
  access.ts               who can see and edit a document — the one place
  auth.ts                 session cookie, role gates
  documents.ts            create / register / update / share, DB + Drive together
  google/                 oauth.ts · real.ts (Drive API) · mock.ts · index.ts (folder tree)
  constants.ts            roles, doc types, visibilities — the enum vocabulary
prisma/
  schema.prisma           SQLite now, portable to Postgres
  seed.ts                 sample categories, shows, members and documents
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

## Notes for whoever picks this up

- Sample content is tagged `"sample": true` in `Document.metadata`. Admin →
  Settings has a one-click **Remove sample data**.
- The seeded board group is a placeholder
  (`pennplayers-board@googlegroups.com`). Change it in Admin → Settings before
  connecting a real Google account.
- Text search uses Prisma `contains`, which is case-insensitive on SQLite. When
  moving to Postgres, add `mode: "insensitive"` in `lib/queries.ts`.
- Local sign-in must be switched off (`ALLOW_DEV_LOGIN=false`) before this goes
  anywhere public. It is disabled automatically in production builds.
