import { prisma } from "@/lib/db";
import { getSetupState } from "@/lib/config";
import { canvaRedirectUri, driveRedirectUri, env, loginRedirectUri } from "@/lib/env";
import { canvaProvider, canvaReady, getCanvaAccount } from "@/lib/canva";
import { disconnectCanvaAction } from "@/app/actions/canva";
import { CANVA_SCOPES } from "@/lib/constants";
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
  const [
    documentCount,
    sampleCount,
    canvaAccount,
    canvaConnected,
    canvaMirrorCount,
    boardMemberCount,
  ] = await Promise.all([
    prisma.document.count({ where: { googleFileId: { not: null } } }),
    prisma.document.count({ where: { metadata: { contains: '"sample":true' } } }),
    getCanvaAccount(),
    canvaReady(),
    prisma.document.count({ where: { canvaDesignId: { not: null } } }),
    prisma.user.count({
      where: { role: { in: ["ADMIN", "BOARD", "MEMBER"] }, status: { not: "DISABLED" } },
    }),
  ]);

  const canvaLabel =
    env.canvaMode === "mock"
      ? await canvaProvider().accountLabel()
      : (canvaAccount?.displayName ?? null);
  const canvaCapabilities: string[] = canvaAccount?.capabilities
    ? (JSON.parse(canvaAccount.capabilities) as string[])
    : [];

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
      {params.canva_connected === "1" ? (
        <Banner tone="green" icon="check-circle" title="Canva account connected">
          Canva designs can now be mirrored into the hub.
        </Banner>
      ) : null}
      {params.canva_disconnected === "1" ? (
        <Banner tone="slate" icon="info" title="Canva account disconnected">
          Existing mirrored copies stay in Drive and keep working; they just cannot be re-exported
          until an account is connected again.
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

        {setup.driveAccountIsSimulated ? (
          <div className="space-y-3 text-sm">
            <Badge tone="amber" icon="warning">
              Left over from the simulation
            </Badge>
            <p className="text-ink-600">
              There is an account row for{" "}
              <span className="font-medium">{setup.account?.email}</span>, but it holds no Google
              token — it was written while the hub was running on the simulated Drive, most likely
              by the sample data. Nothing can be filed to Drive until a real account is connected.
            </p>
            <p className="text-ink-500">
              <strong>Connect the hub&rsquo;s Google account</strong> below replaces it. The
              simulated folder ids are discarded, so the folder tree is created afresh in the real
              account.
            </p>
          </div>
        ) : null}

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

      {env.canvaMode !== "off" ? (
        <Card>
          <SectionHeader
            icon="canva"
            title="Canva connection"
            description="Optional. Lets the hub keep an exported copy of a Canva design in Drive, so Canva content can follow the hub's own Private / Company / Board rules."
          />

          <div className="mb-4 rounded-lg border border-ink-200 bg-ink-50 p-3 text-xs leading-relaxed text-ink-600">
            <span className="font-semibold text-ink-800">Why a copy, and not real sharing?</span>{" "}
            Canva's API has no way to grant a person access to a design — there is no
            design-permission endpoint, and the links it hands back only work for the account that
            asked and expire after 30 days. Mirroring is the only way to put Canva content behind
            the hub's access rules. The design itself stays in Canva, shared however your designers
            already share it.
          </div>

          {!env.canvaConfigured ? (
            <div className="space-y-3 text-sm">
              <Badge tone="amber" icon="warning">
                No Canva integration configured
              </Badge>
              <p className="text-ink-600">
                Create an integration in the Canva Developer Portal, then add{" "}
                <code className="rounded bg-ink-100 px-1">CANVA_CLIENT_ID</code> and{" "}
                <code className="rounded bg-ink-100 px-1">CANVA_CLIENT_SECRET</code> to{" "}
                <code className="rounded bg-ink-100 px-1">.env</code>. SETUP.md has the steps.
              </p>
              <div className="rounded-lg bg-ink-50 p-3 text-xs">
                <div className="font-medium text-ink-700">Redirect URL to register with Canva</div>
                <p className="mt-1 font-mono text-ink-600">{canvaRedirectUri()}</p>
                <p className="mt-1.5 text-ink-500">
                  Canva rejects <code>localhost</code>, so the hub uses <code>127.0.0.1</code> for
                  this one flow. Scopes needed: {CANVA_SCOPES.join(", ")}.
                </p>
              </div>
            </div>
          ) : canvaConnected && canvaAccount ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone="green" icon="check-circle">
                  Connected
                </Badge>
                <span className="text-sm font-medium text-ink-900">
                  {canvaLabel ?? "Canva account"}
                </span>
                <span className="text-xs text-ink-500">
                  since {formatDateTime(canvaAccount.connectedAt)}
                </span>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg bg-ink-50 p-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                    Designs mirrored
                  </dt>
                  <dd className="mt-1 font-medium">
                    {canvaMirrorCount} {pluralize(canvaMirrorCount, "design")}
                  </dd>
                </div>
                <div className="rounded-lg bg-ink-50 p-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                    Canva plan features
                  </dt>
                  <dd className="mt-1 text-xs text-ink-600">
                    {canvaCapabilities.length > 0 ? canvaCapabilities.join(", ") : "standard"}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <a href="/api/canva/connect" className={buttonClass("secondary")}>
                  <Icon name="refresh" className="size-4" />
                  Reconnect / switch account
                </a>
                <form action={disconnectCanvaAction}>
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
              <p className="text-ink-600">
                Connect the Canva account that can open the club's designs — the same dedicated
                account is ideal. Designers keep using their own Canva accounts; they just need to
                share each design with this one.
              </p>
              <a href="/api/canva/connect" className={buttonClass("primary")}>
                <Icon name="canva" className="size-4" />
                Connect the hub's Canva account
              </a>
            </div>
          )}

          {env.canvaMode === "mock" ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              <span className="font-semibold">Simulated Canva is on.</span> Mirroring works
              end to end but produces a placeholder PDF. Set{" "}
              <code className="rounded bg-white/60 px-1">CANVA_MODE=canva</code> once an account is
              connected, or <code className="rounded bg-white/60 px-1">CANVA_MODE=off</code> to hide
              the feature.
            </div>
          ) : null}
        </Card>
      ) : null}

      <FormCard
        title="Hub settings"
        description="Naming, the board group and what new documents look like."
      >
        <ConfigForm
          boardCount={boardMemberCount}
          config={{
            orgName: setup.config.orgName,
            shareMode: setup.config.shareMode,
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
          <Row label="Canva">{env.canvaMode}</Row>
          <Row label="Local sign-in">{env.allowDevLogin ? "enabled" : "off"}</Row>
          <Row label="App URL">
            {env.appUrl}
            {env.appUrlWasIncomplete ? (
              <span className="ml-1 text-xs text-amber-700">
                — repaired: <code>APP_URL</code> is missing its <code>https://</code> or has a
                trailing slash. Every redirect URI is built from it, so set it exactly as shown
                here and redeploy.
              </span>
            ) : null}
          </Row>
        </dl>

        {/* Always shown, not only when Google is unconfigured. These are needed
            again every time the domain changes — a new deployment URL, a custom
            domain — and that is exactly when the app *is* configured and the
            setup panel above is hidden. Being unable to find them is how an
            afternoon goes on redirect_uri_mismatch. */}
        <div className="mt-3 rounded-lg bg-white p-3 text-xs">
          <div className="font-medium text-ink-700">
            Authorised redirect URIs for this deployment
          </div>
          <p className="mt-1 text-ink-500">
            Register both in the Google Cloud console (APIs &amp; Services → Credentials → your
            OAuth client). Google matches them exactly, so a missing one answers{" "}
            <code>redirect_uri_mismatch</code> and no sign-in is possible.
          </p>
          <ul className="mt-2 space-y-1 font-mono text-ink-700">
            <li>{loginRedirectUri()}</li>
            <li>{driveRedirectUri()}</li>
          </ul>
          {env.canvaMode !== "off" ? (
            <>
              <div className="mt-2 text-ink-500">Canva return URL, if you use Canva:</div>
              <ul className="mt-1 font-mono text-ink-700">
                <li>{canvaRedirectUri()}</li>
              </ul>
            </>
          ) : null}
        </div>
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
