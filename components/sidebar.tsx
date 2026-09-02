"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { Avatar, Badge } from "./ui";
import { cn } from "@/lib/utils";
import { ROLE_META, isRole } from "@/lib/constants";

export type SidebarCategory = {
  name: string;
  slug: string;
  icon: string;
  color: string;
  count: number;
};

export type SidebarProduction = {
  name: string;
  slug: string;
  status: string;
  count: number;
};

export type SidebarProps = {
  orgName: string;
  user: { name: string | null; email: string; role: string; position: string | null };
  categories: SidebarCategory[];
  productions: SidebarProduction[];
  isAdmin: boolean;
  driveMode: "google" | "mock";
};

const MAIN_LINKS = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/documents", label: "All documents", icon: "list" },
  { href: "/productions", label: "Productions", icon: "theater" },
  { href: "/categories", label: "Categories", icon: "grid" },
];

export function Sidebar(props: SidebarProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  const body = (
    <div className="flex h-full flex-col gap-6 overflow-y-auto scroll-slim px-3 py-4">
      <Link href="/" className="flex items-center gap-2 px-2" onClick={() => setOpen(false)}>
        <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-white">
          <Icon name="theater" className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink-900">
            {props.orgName}
          </span>
          <span className="block text-xs text-ink-500">Document hub</span>
        </span>
      </Link>

      <nav className="space-y-0.5">
        {MAIN_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition",
              isActive(link.href)
                ? "bg-brand-50 text-brand-700"
                : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
            )}
          >
            <Icon name={link.icon} className="size-4" />
            {link.label}
          </Link>
        ))}
      </nav>

      {props.categories.length > 0 ? (
        <div>
          <div className="px-2.5 pb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
            Information
          </div>
          <nav className="space-y-0.5">
            {props.categories.map((category) => {
              const href = `/categories/${category.slug}`;
              return (
                <Link
                  key={category.slug}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition",
                    isActive(href)
                      ? "bg-ink-100 font-medium text-ink-900"
                      : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                  )}
                >
                  <span
                    className="grid size-5 shrink-0 place-items-center rounded"
                    style={{ backgroundColor: `${category.color}1a`, color: category.color }}
                  >
                    <Icon name={category.icon} className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{category.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-400">
                    {category.count}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
      ) : null}

      {props.productions.length > 0 ? (
        <div>
          <div className="px-2.5 pb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
            This season
          </div>
          <nav className="space-y-0.5">
            {props.productions.map((production) => {
              const href = `/productions/${production.slug}`;
              return (
                <Link
                  key={production.slug}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition",
                    isActive(href)
                      ? "bg-ink-100 font-medium text-ink-900"
                      : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                  )}
                >
                  <Icon
                    name={production.status === "ACTIVE" ? "star" : "theater"}
                    className={cn(
                      "size-4 shrink-0",
                      production.status === "ACTIVE" ? "text-gold-500" : "text-ink-400",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{production.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-400">
                    {production.count}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
      ) : null}

      <div className="mt-auto space-y-3">
        {props.driveMode === "mock" ? (
          <Link
            href="/admin"
            onClick={() => setOpen(false)}
            className="block rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-900"
          >
            <span className="flex items-center gap-1.5 font-semibold">
              <Icon name="cloud_off" className="size-3.5" />
              Simulated Drive
            </span>
            Documents are fake while no Google account is connected. Nothing is written to Drive.
          </Link>
        ) : null}

        {props.isAdmin ? (
          <Link
            href="/admin"
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition",
              isActive("/admin")
                ? "bg-brand-50 text-brand-700"
                : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
            )}
          >
            <Icon name="settings" className="size-4" />
            Admin
          </Link>
        ) : null}

        <div className="rounded-lg border border-ink-200 bg-white p-2.5">
          <div className="flex items-center gap-2.5">
            <Avatar name={props.user.name} email={props.user.email} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink-900">
                {props.user.name ?? props.user.email}
              </div>
              <div className="truncate text-xs text-ink-500">
                {props.user.position ?? props.user.email}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Badge tone={props.user.role === "ADMIN" ? "indigo" : "slate"}>
              {isRole(props.user.role) ? ROLE_META[props.user.role].label : props.user.role}
            </Badge>
            <form action="/api/auth/signout" method="post">
              <button
                type="submit"
                className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-ink-500 transition hover:bg-ink-100 hover:text-ink-800"
              >
                <Icon name="logout" className="size-3.5" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile header */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-brand-600 text-white">
            <Icon name="theater" className="size-4" />
          </span>
          <span className="text-sm font-semibold">{props.orgName} Hub</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? "Close menu" : "Open menu"}
          className="rounded-lg border border-ink-200 p-2 text-ink-600"
        >
          <Icon name={open ? "x" : "list"} className="size-4" />
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-ink-900/30"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-ink-200 bg-white shadow-xl">
            {body}
          </div>
        </div>
      ) : null}

      <aside className="hidden w-64 shrink-0 border-r border-ink-200 bg-white lg:sticky lg:top-0 lg:block lg:h-screen">
        {body}
      </aside>
    </>
  );
}
