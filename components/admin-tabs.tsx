"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin", label: "Google & settings", icon: "settings" },
  { href: "/admin/members", label: "Members", icon: "users" },
  { href: "/admin/sharing", label: "Sharing", icon: "shield" },
  { href: "/admin/email", label: "Email", icon: "mail" },
  { href: "/admin/roles", label: "Production roles", icon: "user-cog" },
  { href: "/admin/categories", label: "Categories", icon: "grid" },
  { href: "/admin/import", label: "Import", icon: "download" },
  { href: "/admin/productions", label: "Productions", icon: "theater" },
  { href: "/admin/rollover", label: "Rollover", icon: "refresh" },
  { href: "/admin/templates", label: "Templates", icon: "copy" },
  { href: "/admin/activity", label: "Activity", icon: "clock" },
];

export function AdminTabs() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-ink-200 pb-px scroll-slim">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition",
              active
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-ink-500 hover:text-ink-800",
            )}
          >
            <Icon name={tab.icon} className="size-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
