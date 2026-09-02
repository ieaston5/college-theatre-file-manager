import { prisma } from "@/lib/db";
import { getSetupState } from "@/lib/config";
import { driveRedirectUri, env, loginRedirectUri } from "@/lib/env";
import {
  bootstrapFoldersAction,
  disconnectDriveAction,
  reapplySharingAction,
  removeSampleDataAction,
} from "@/app/actions/admin";
import { ConfigForm, FormCard } from "@/components/forms/admin-forms";
import { Icon } from "@/components/icons";
import { Badge, Banner, Card, SectionHeader, buttonClass } from "@/components/ui";
import { formatDateTime, pluralize } from "@/lib/utils";
import type { SearchParams } from "@/lib/queries";

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const setup = await getSetupState();
  const [documentCount, sampleCount] = await Promise.all([
    prisma.document.count({ where: { googleFileId: { not: null } } }),
    prisma.document.count({ where: { metadata: { contains: '"sample":true' } } }),
  ]);

  const rootFolderLink = setup.account?.rootFolderId
    ? env.driveMode === "mock"
      ? `/mock-drive/${setup.account.rootFolderId}`
      : `https://drive.google.com/drive/folders/${setup.account.rootFolderId}`
    : null;

  return (
    <div className="space-y-6">
      {params.connected === "1" ? (
        <Banner tone="green" icon="check-circle" title="Google account connected">
          The folder structure has been created. New documents will be owned by that account.
        </Banner>
      ) : null}
      {params.disconnected === "1" ? (
        <Banner tone="slate" icon="info" title="Google account disconnected">
          Existing documents keep working in Drive, but the hub can no longer create, move or share
          files until an account is connected again.
        </Banner>
      ) : null}
      {params.sample_removed === "1" ? (
        <Banner tone="green" icon="check">
          Sample data removed.
        </Banner>
      ) : null}
      {typeof params.error === "string" ? (
        <Banner tone="rose" icon="warning" title="Google returned an error">
          {params.error}
        </Banner>
      ) : null}

      <Card>
        <SectionHeader
          icon="shield"
          title="Google connection"
          description="One Google account owns every document the hub creates, so nothing is lost when a board member graduates."
        />

        {!env.googleConfigured ? (
          <div className="space-y-3 text-sm">
            <Badge tone="amber" icon="warning">
              No OAuth client configured
            </Badge>
            <p className="text-ink-600">
              Add a Google OAuth client to <code className="rounded bg-ink-100 px-1">.env</code>,
              then restart the app. SETUP.md walks through it — it takes about five minutes in the
              Google Cloud console.
            </p>
            <div className="rounded-lg bg-ink-50 p-3 text-xs">
              <div className="font-medium text-ink-700">Authorised redirect URIs to register</div>
              <ul className="mt-1 space-y-1 font-mono text-ink-600">
                <li>{loginRedirectUri()}</li>
                <li>{driveRedirectUri()}</li>
              </ul>
            </div>
            <p className="text-ink-500">
              Until then the hub runs on a simulated Drive: everything works, but no file is really
              created.
            </p>
          </div>
        ) : setup.driveConnected && setup.account ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="green" icon="check-circle">
                Connected
              </Badge>
              <span className="text-sm font-medium text-ink-900">{setup.account.email}</span>
              <span className="text-xs text-ink-500">
                since {formatDateTime(setup.account.connectedAt)}
              </span>
            </div>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-lg bg-ink-50 p-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Root folder
                </dt>
                <dd className="mt-1">
                  {rootFolderLink ? (
                    <a
                      href={rootFolderLink}
                      target={env.driveMode === "mock" ? undefined : "_blank"}
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                    >
                      {setup.config.driveRootName}
                      <Icon name="external" className="size-3.5" />
                    </a>
                  ) : (
                    <span className="text-ink-500">Not created yet</span>
                  )}
                </dd>
              </div>
              <div className="rounded-lg bg-ink-50 p-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Files under management
                </dt>
                <dd className="mt-1 font-medium">
                  {documentCount} {pluralize(documentCount, "file")}
                </dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-2">
              <form action={bootstrapFoldersAction}>
                <button type="submit" className={buttonClass("secondary")}>
                  <Icon name="folder-open" className="size-4" />
                  Rebuild folder structure
                </button>
              </form>
              <form action={reapplySharingAction}>
                <button type="submit" className={buttonClass("secondary")}>
                  <Icon name="refresh" className="size-4" />
                  Re-apply sharing everywhere
                </button>
              </form>
              <a href="/api/google/connect" className={buttonClass("secondary")}>
                <Icon name="mail" className="size-4" />
                Reconnect / switch account
              </a>
              <form action={disconnectDriveAction}>
                <button type="submit" className={buttonClass("danger")}>
                  <Icon name="cloud_off" className="size-4" />
                  Disconnect
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <Badge tone="amber" icon="warning">
              Not connected
            </Badge>
            <div className="space-y-2 text-ink-600">
              <p>
                Sign in as the account that should own the club's documents — a dedicated account
                such as <span className="font-medium">pennplayers.hub@gmail.com</span> rather than
                anyone's personal login. Every file the hub creates lives in that account's Drive
                and is shared out from there.
              </p>
              <p className="text-ink-500">
                The hub asks for Drive, Docs, Sheets and Slides access on that account only. Members
                never grant Drive access — they only sign in.
              </p>
            </div>
            <a href="/api/google/connect" className={buttonClass("primary")}>
              <Icon name="mail" className="size-4" />
              Connect the hub's Google account
            </a>
          </div>
        )}

        {env.driveMode === "mock" ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
            <span className="font-semibold">Simulated Drive is on.</span> Set{" "}
            <code className="rounded bg-white/60 px-1">DRIVE_MODE=google</code> in{" "}
            <code className="rounded bg-white/60 px-1">.env</code> once an account is connected —
            the hub otherwise keeps making fake files.
          </div>
        ) : null}
      </Card>

      <FormCard
        title="Hub settings"
        description="Naming, the board group and what new documents look like."
      >
        <ConfigForm
          config={{
            orgName: setup.config.orgName,
            groupEmail: setup.config.groupEmail,
            groupCanEdit: setup.config.groupCanEdit,
            namingTemplate: setup.config.namingTemplate,
            driveRootName: setup.config.driveRootName,
            currentSeason: setup.config.currentSeason,
            stampDocHeader: setup.config.stampDocHeader,
          }}
        />
      </FormCard>

      {sampleCount > 0 ? (
        <Card className="border-amber-200">
          <SectionHeader
            icon="info"
            title="Sample data"
            description={`${sampleCount} seeded ${pluralize(
              sampleCount,
              "document",
            )} and the demo members are loaded so the hub does not look empty while you evaluate it.`}
          />
          <form action={removeSampleDataAction}>
            <button type="submit" className={buttonClass("danger")}>
              <Icon name="trash" className="size-4" />
              Remove sample data
            </button>
          </form>
        </Card>
      ) : null}

      <Card className="bg-ink-50">
        <SectionHeader icon="info" title="Environment" />
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label="Mode">{env.isProduction ? "production" : "development"}</Row>
          <Row label="Drive">{env.driveMode === "mock" ? "simulated" : "Google Drive"}</Row>
          <Row label="Local sign-in">{env.allowDevLogin ? "enabled" : "off"}</Row>
          <Row label="App URL">{env.appUrl}</Row>
        </dl>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded-lg bg-white px-3 py-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="font-mono text-xs text-ink-800">{children}</dd>
    </div>
  );
}
