import { getConfig } from "@/lib/config";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { buttonClass } from "@/components/ui";
import { signOutAction } from "@/app/actions/auth";

export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const email = typeof params.email === "string" ? params.email : undefined;
  const reason = typeof params.reason === "string" ? params.reason : undefined;
  const need = typeof params.need === "string" ? params.need : undefined;
  const config = await getConfig();

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { name: true, email: true, position: true },
    take: 4,
  });

  const heading = need === "admin"
    ? "That area is for admins"
    : need
      ? "You cannot add documents"
      : reason === "disabled"
      ? "This account has been switched off"
      : "You are not on the hub's member list";

  const body = need === "admin"
    ? "Your account does not have the admin role, so this part of the hub is hidden. Ask a current admin if you need it."
    : need
      ? "Your role is read-only, so you can open everything that has been shared with you but cannot file anything new. An admin — or whoever runs your show — can change that if you need it."
      : reason === "disabled"
      ? "Your account was switched off by an admin. If you are still working on a show and this is a mistake, ask them — a board term ending on its own does not close an account."
      : `The hub opens for board members an admin has added, and for cast and crew who have been added to a show.${
          email ? ` Nothing is set up for ${email} yet.` : ""
        }`;

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="card w-full max-w-md p-8 text-center">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-amber-50 text-amber-700">
          <Icon name="lock" className="size-6" />
        </span>
        <h1 className="text-lg font-semibold tracking-tight">{heading}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">{body}</p>

        {admins.length > 0 ? (
          <div className="mt-6 rounded-lg bg-ink-50 p-4 text-left">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Who to ask
            </div>
            <ul className="mt-2 space-y-1.5 text-sm">
              {admins.map((admin) => (
                <li key={admin.email} className="flex items-center justify-between gap-3">
                  <span className="truncate">
                    <span className="font-medium text-ink-800">{admin.name ?? admin.email}</span>
                    {admin.position ? (
                      <span className="text-ink-500"> · {admin.position}</span>
                    ) : null}
                  </span>
                  <a
                    href={`mailto:${admin.email}`}
                    className="shrink-0 text-xs font-medium text-brand-600 hover:underline"
                  >
                    Email
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-6 flex justify-center gap-2">
          <form action={signOutAction}>
            <button type="submit" className={buttonClass("secondary")}>
              Sign in as someone else
            </button>
          </form>
          <a href="/" className={buttonClass("ghost")}>
            Try the dashboard
          </a>
        </div>

        <p className="mt-6 text-xs text-ink-400">{config.orgName} Hub</p>
      </div>
    </main>
  );
}
