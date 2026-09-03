import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Banner, buttonClass } from "@/components/ui";
import { ROLE_META, isRole } from "@/lib/constants";

const ERRORS: Record<string, string> = {
  google_not_configured:
    "Google sign-in is not set up on this environment yet. Use the local sign-in below, or add a Google OAuth client to .env (SETUP.md step 2).",
  state_expired: "That sign-in link expired. Try again.",
  missing_code: "Google did not send back a sign-in code. Try again.",
  exchange_failed: "Google rejected the sign-in. Try again, or check the OAuth client settings.",
  dev_login_disabled: "Local sign-in is switched off on this environment.",
  missing_email: "Pick an account to sign in as.",
  access_denied: "You cancelled the Google sign-in.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/");

  const params = await searchParams;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const signedOut = params.signed_out === "1";
  const config = await getConfig();

  // Board first, then a few company members, so the two very different points
  // of view are both one click away while evaluating.
  const devUsers = env.allowDevLogin
    ? await prisma.user.findMany({
        where: { status: { not: "DISABLED" }, role: { in: ["ADMIN", "BOARD", "MEMBER"] } },
        orderBy: [{ role: "asc" }, { name: "asc" }],
        take: 6,
      })
    : [];
  const devCompany = env.allowDevLogin
    ? await prisma.user.findMany({
        where: { status: { not: "DISABLED" }, memberships: { some: { status: "ACTIVE" } } },
        orderBy: { name: "asc" },
        include: {
          memberships: {
            where: { status: "ACTIVE" },
            take: 1,
            include: {
              role: { select: { name: true } },
              production: { select: { name: true } },
            },
          },
        },
        take: 5,
      })
    : [];

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-10 text-white lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-brand-600/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-gold-500/20 blur-3xl"
        />
        <div className="relative flex items-center gap-2 text-sm font-semibold tracking-wide">
          <Icon name="theater" className="size-5 text-gold-300" />
          {config.orgName} Hub
        </div>
        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            Every budget, schedule and contact sheet, in one place.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            Create documents here instead of in Drive and they get named, filed and shared
            correctly the first time. Everything stays inside the board — nothing is ever public.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/80">
            {[
              ["folder-open", "Documents sorted by what they are, not who made them"],
              ["theater", "Linked to the production they belong to"],
              ["lock", "Private stays private — board work is shared with the group"],
            ].map(([icon, text]) => (
              <li key={text} className="flex items-start gap-3">
                <Icon name={icon} className="mt-0.5 size-4 shrink-0 text-gold-300" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">
          Private environment · not yet public-facing
        </p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <Icon name="theater" className="size-5 text-brand-600" />
            <span className="font-semibold">{config.orgName} Hub</span>
          </div>

          <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-ink-500">
            Access is limited to board members who have been added to the hub.
          </p>

          <div className="mt-6">
            {errorKey ? (
              <Banner tone="rose" icon="warning" title="Could not sign you in">
                {ERRORS[errorKey] ?? errorKey}
              </Banner>
            ) : null}
            {signedOut ? (
              <Banner tone="slate" icon="check">
                You have been signed out.
              </Banner>
            ) : null}

            {env.googleConfigured ? (
              <a href="/api/auth/google/start" className={buttonClass("primary", "w-full")}>
                <Icon name="mail" className="size-4" />
                Continue with Google
              </a>
            ) : (
              <div className="rounded-xl border border-dashed border-ink-300 bg-white p-4 text-sm text-ink-500">
                <div className="flex items-center gap-2 font-medium text-ink-700">
                  <Icon name="cloud_off" className="size-4" />
                  Google sign-in not configured
                </div>
                <p className="mt-1 text-xs leading-relaxed">
                  Add <code className="rounded bg-ink-100 px-1">GOOGLE_CLIENT_ID</code> and{" "}
                  <code className="rounded bg-ink-100 px-1">GOOGLE_CLIENT_SECRET</code> to{" "}
                  <code className="rounded bg-ink-100 px-1">.env</code> to switch it on — see
                  SETUP.md step 2.
                </p>
              </div>
            )}
          </div>

          {devUsers.length > 0 ? (
            <div className="mt-8">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-px flex-1 bg-ink-200" />
                <span className="text-xs font-medium uppercase tracking-wider text-ink-400">
                  Local sign-in
                </span>
                <span className="h-px flex-1 bg-ink-200" />
              </div>
              <p className="mb-3 text-xs leading-relaxed text-ink-500">
                This environment is private, so you can sign in as any seeded member to try the
                hub from their point of view. This list disappears once{" "}
                <code className="rounded bg-ink-100 px-1">ALLOW_DEV_LOGIN</code> is off.
              </p>
              <ul className="card divide-y divide-ink-100 overflow-hidden p-0">
                {devUsers.map((member) => (
                  <li key={member.id}>
                    <form action="/api/auth/dev" method="post">
                      <input type="hidden" name="email" value={member.email} />
                      <button
                        type="submit"
                        className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-ink-50"
                      >
                        <Avatar name={member.name} email={member.email} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink-900">
                            {member.name ?? member.email}
                          </span>
                          <span className="block truncate text-xs text-ink-500">
                            {member.position ?? member.email}
                          </span>
                        </span>
                        <Badge tone={member.role === "ADMIN" ? "indigo" : "slate"}>
                          {isRole(member.role) ? ROLE_META[member.role].label : member.role}
                        </Badge>
                      </button>
                    </form>
                  </li>
                ))}
              </ul>

              {devCompany.length > 0 ? (
                <>
                  <p className="mb-2 mt-5 text-xs font-medium uppercase tracking-wider text-ink-400">
                    Company members
                  </p>
                  <ul className="card divide-y divide-ink-100 overflow-hidden p-0">
                    {devCompany.map((member) => {
                      const membership = member.memberships[0];
                      return (
                        <li key={member.id}>
                          <form action="/api/auth/dev" method="post">
                            <input type="hidden" name="email" value={member.email} />
                            <button
                              type="submit"
                              className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-ink-50"
                            >
                              <Avatar name={member.name} email={member.email} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-ink-900">
                                  {member.name ?? member.email}
                                </span>
                                <span className="block truncate text-xs text-ink-500">
                                  {membership?.title ?? membership?.production.name}
                                </span>
                              </span>
                              <Badge tone="green">{membership?.role?.name ?? "Company"}</Badge>
                            </button>
                          </form>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-xs leading-relaxed text-ink-500">
                    Sign in as one of these to see the hub from a cast or crew point of view — the
                    difference is the point of the access layer.
                  </p>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
