<div align="center">

# Penn Players Hub

**A theatre file manager built for the people behind the production.**

Create, find, and share the paperwork that keeps a student theatre company running.

[Explore the app](docs/DEMO.md) · [Run locally](#run-locally) · [Architecture](docs/ARCHITECTURE.md) · [Deployment guide](SETUP.md)

</div>

![Penn Players Hub dashboard with pinned files, production navigation, and information categories](docs/screenshots/dashboard.png)

*The existing application, running locally with fictional seeded people and sample documents. Google Drive is simulated in these screenshots.*

## Why this exists

A production leaves behind budgets, rehearsal reports, contact sheets, scripts, and design files. When those files live in individual accounts and scattered folders, finding the current version—and handing it to next year's board—becomes its own job.

Penn Players Hub gives that information a consistent home. Each document has a category, an optional production, and explicit access settings. The Hub handles naming and filing, while Google Drive remains the place to open and edit the files. Documents created through a connected Hub belong to its dedicated Google account, preserving continuity between boards.

## What you can do

| Workflow | What the application provides |
| --- | --- |
| **File it once** | Create Docs, Sheets, Slides, and Forms; upload files; or register an existing file. Apply naming rules, category folders, production context, and optional templates. |
| **Find the right version** | Search titles, descriptions, tags, categories, and productions. Filter by type, visibility, ownership, and archive status with shareable URLs. Pin frequently used documents. |
| **Give people the right access** | Separate private, board, and company visibility. Assign multiple production roles whose category permissions combine, with creation rights checked separately. |
| **Keep recordings and revisions together** | Resumable uploads for recordings up to 20 GiB, using 8 MiB chunks sent directly to Drive. Replace uploaded files while preserving their Drive ID and link. |
| **Bring design work into the library** | Mirror Canva designs as Drive exports, check freshness, and refresh the existing copy. Canva remains the editing source. |
| **Carry knowledge forward** | Production filing coverage, configurable categories and templates, season rollover, scheduled maintenance, and metadata backup/restore tools. |

The focus is document filing, discovery, availability, and access. Production filing coverage shows where shared files exist; it does not represent task completion or approval.

## A look inside

### A home for each production

Show-specific documents, company membership, and filing coverage stay connected to the production.

![Urinetown production page showing file counts, filters, and category-grouped documents](docs/screenshots/production.png)

### A view shaped by membership

Company members see the productions and information categories their roles allow.

![Company member dashboard with role-appropriate production files](docs/screenshots/company.png)

[View the document creation screen and reproduce the walkthrough →](docs/DEMO.md)

## Engineering choices

- **One access policy across the Hub.** `lib/access.ts` builds viewer context and document access predicates. Board status, production membership, category eligibility, and named shares determine what a person can discover or open.
- **Fast local saves, eventual Drive updates.** PostgreSQL stores document metadata and pending reconciliation state. Background work applies naming, filing, and permission changes to Drive; status endpoints expose outstanding work and scheduled sweeps retry it.
- **File bytes bypass the app server.** The server authorizes resumable upload sessions and finalization; the browser transfers chunks directly to Google. Recovery uses Drive's acknowledged offset.
- **A credential-free evaluation path.** Real and mock provider implementations share an interface. The seeded local app demonstrates navigation, filing, and access without connecting a Google or Canva account.

| Layer | Stack |
| --- | --- |
| Application | Next.js 15 App Router, React 19, TypeScript |
| Interface | Tailwind CSS 4, Lucide icons |
| Data | PostgreSQL, Prisma schema and migrations |
| Authentication | Google OAuth, signed session cookies with `jose`, local development sign-in |
| Integrations | Google Drive, Docs, Sheets, Slides, Forms, Gmail; optional Canva Connect |
| Operations | Scheduled `/api/cron` endpoint, Vercel deployment configuration, metadata recovery scripts |

[Read the architecture and access model →](docs/ARCHITECTURE.md)

## Run locally

Use **Node.js 22.10+** and **Docker Compose**, or an existing dedicated PostgreSQL database. No Google account is needed for the local demo.

```bash
git clone https://github.com/ieaston5/college-theatre-file-manager.git
cd college-theatre-file-manager
npm ci
docker compose up -d db
npm run setup
npm run dev
```

Open [localhost:3000](http://localhost:3000) and select **Production Manager** on the local sign-in screen. The default seeded admin is `admin@pennplayers.example`; `BOOTSTRAP_ADMIN_EMAILS` can override it.

`npm run setup` creates `.env` with local database defaults and random secrets if absent, generates Prisma Client, applies migrations, and seeds the demo. It preserves an existing `.env`, so check its database target before running setup. The seed contains 26 documents, 14 categories, 3 productions, and fictional accounts.

For an existing PostgreSQL instance, copy `.env.example` to `.env` first and configure `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, and `APP_ENCRYPTION_KEY`. Use a separate development database. [SETUP.md](SETUP.md) covers configuration, real integrations, and deployment.

## Development

```bash
npm run typecheck   # TypeScript checks
npm test            # Node test runner: access, uploads, and intent regressions
npm run build       # Prisma generation and Next.js production build
```

Endpoint integration harnesses also live in [`tests/integration/`](tests/integration/); their file headers document the required environment. The existing `lint` script invokes `next lint`, but no ESLint configuration is checked in; the commands above are the reproducible checks for this snapshot.

| Command | Purpose |
| --- | --- |
| `npm run db:studio` | Inspect the configured database |
| `npm run db:seed` | Load sample configuration and content |
| `npm run backup` | Export Hub metadata to an ignored local backup file |
| `npm run restore -- <file> --dry-run` | Preview a metadata restore |
| `npm run rebuild` | Preview reconstruction from Drive metadata; `-- --apply` writes changes |

## Integration boundaries

The local demo simulates Drive and Canva; it does not demonstrate live provider permissions or large-file transfers. Mock uploads are limited to 4 MiB. Real uploads depend on Google credentials, quota, permissions, and network availability, and the page must remain open during transfer. Reselecting the same unchanged file with the same filing choices within 24 hours can resume a saved session.

Hub access and Drive permissions are separate enforcement layers. Pending Drive changes must finish before relying on a revocation. File owners and inherited folder permissions remain relevant, and registered files retain collaborators the Hub does not manage. Canva mirroring shares an exported copy, not access to the original design.

Before deployment, configure real sign-in and provider accounts, disable local development sign-in, and follow the [deployment and operations guide](SETUP.md). Local sign-in is also disabled by the application in production mode.
