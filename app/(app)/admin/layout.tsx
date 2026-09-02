import { requireRole } from "@/lib/auth";
import { AdminTabs } from "@/components/admin-tabs";
import { PageHeader } from "@/components/ui";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole("ADMIN");

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Hub settings"
        description="Who has access, how information is organised, and how the hub talks to Google."
      />
      <AdminTabs />
      {children}
    </div>
  );
}
