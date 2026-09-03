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
   API*, *Google Sheets API*, *Google Slides API*.
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
3. Sign in as `pennplayers.hub@gmail.com` and approve Drive, Docs, Sheets and
   Slides access. This is the only account that ever grants Drive access —
   board members only sign in.
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

Adding someone does not email them — send them the address yourself. They must
also be in the OAuth **test users** list from 2b until the app is verified.

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

### 2g. Templates (the biggest time-saver)

Make your ideal rehearsal report, budget skeleton and contact sheet in the hub
account's Drive, then **Admin → Templates → Add a template** with the link. Put
`{{TITLE}}`, `{{PRODUCTION}}`, `{{CATEGORY}}`, `{{OWNER}}`, `{{DATE}}` anywhere
in the file and they get filled in on each copy.

### 2h. Check it end to end

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

---

## Stage 3 — when you want it public-facing

Not done yet; this is the third pass of the plan. What it involves:

1. **Postgres.** Change `datasource db { provider = "postgresql" }` in
   `prisma/schema.prisma`, point `DATABASE_URL` at a hosted database (Neon and
   Supabase both have free tiers), run `npx prisma migrate dev --name init`.
   Add `mode: "insensitive"` to the search clauses in `lib/queries.ts`.
2. **Deploy** to Vercel from GitHub. Environment variables: `DATABASE_URL`,
   `APP_URL` (the real https URL), `SESSION_SECRET`, `APP_ENCRYPTION_KEY`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DRIVE_MODE=google`,
   `ALLOW_DEV_LOGIN=false`.
3. **New secrets for production** — do not reuse the local ones:
   `openssl rand -base64 48` for `SESSION_SECRET`, `openssl rand -base64 32`
   for `APP_ENCRYPTION_KEY`. Note that changing `APP_ENCRYPTION_KEY` makes the
   stored Google refresh token unreadable; reconnect the account afterwards.
4. **Redirect URIs** — add `https://<your-domain>/api/auth/google/callback` and
   `https://<your-domain>/api/google/callback` to the OAuth client.
5. **Google verification** — either keep the app in testing mode with the board
   as test users (simplest, and fine for a club), or submit for verification if
   you want to drop the warning screen.
6. **Backups** — whatever your Postgres host offers. The documents themselves
   live in Google Drive, so the database is metadata only, but it is the part
   that makes the pile navigable.

---

## Troubleshooting

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

**Access blocked / app not verified.** The signing-in address is not in the
OAuth **test users** list (2b).

**Everything still says "Simulated Drive".** `DRIVE_MODE` is not `google`, or
the app was not restarted after editing `.env`.
