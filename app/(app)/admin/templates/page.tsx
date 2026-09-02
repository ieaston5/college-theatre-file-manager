import Link from "next/link";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { deleteTemplateAction } from "@/app/actions/admin";
import { FormCard, TemplateForm } from "@/components/forms/admin-forms";
import { Icon } from "@/components/icons";
import { Badge, Banner, Card, EmptyState, SectionHeader, buttonClass } from "@/components/ui";
import { DOC_TYPE_META, TEMPLATE_TOKENS } from "@/lib/constants";
import type { SearchParams } from "@/lib/queries";

export default async function AdminTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const editId = typeof params.edit === "string" ? params.edit : undefined;

  const [templates, categories, editing] = await Promise.all([
    prisma.template.findMany({
      orderBy: [{ docType: "asc" }, { name: "asc" }],
      include: { category: { select: { name: true } } },
    }),
    prisma.category.findMany({
      where: { archived: false },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    editId ? prisma.template.findUnique({ where: { id: editId } }) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <Banner tone="sky" icon="info" title="Templates save the most time of anything here">
        Set up a rehearsal report, a budget skeleton and a contact sheet once, and every member
        starts from the club's format instead of a blank page. Any of{" "}
        <span className="font-mono text-xs">{TEMPLATE_TOKENS.join(" ")}</span> inside the template
        gets replaced when a copy is made.
      </Banner>

      <FormCard
        title={editing ? `Edit “${editing.name}”` : "Add a template"}
        description="The file stays where it is — the hub copies it every time someone picks it."
      >
        <TemplateForm
          template={
            editing
              ? {
                  id: editing.id,
                  name: editing.name,
                  description: editing.description,
                  docType: editing.docType,
                  googleFileId: editing.googleFileId,
                  categoryId: editing.categoryId,
                }
              : undefined
          }
          categories={categories}
        />
      </FormCard>

      {templates.length === 0 ? (
        <EmptyState icon="copy" title="No templates yet">
          Until you add one, members get blank documents — which is fine to start with.
        </EmptyState>
      ) : (
        <Card className="p-0">
          <div className="p-5 pb-3">
            <SectionHeader icon="copy" title={`${templates.length} templates`} />
          </div>
          <ul className="divide-y divide-ink-100">
            {templates.map((template) => (
              <li key={template.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-lg"
                  style={{
                    backgroundColor: `${DOC_TYPE_META[template.docType as "DOC"]?.color}18`,
                    color: DOC_TYPE_META[template.docType as "DOC"]?.color,
                  }}
                >
                  <Icon name={DOC_TYPE_META[template.docType as "DOC"]?.icon ?? "file"} className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink-900">{template.name}</span>
                    <Badge tone="slate">
                      {DOC_TYPE_META[template.docType as "DOC"]?.label ?? template.docType}
                    </Badge>
                    <Badge tone="slate">{template.category?.name ?? "Any category"}</Badge>
                  </div>
                  {template.description ? (
                    <div className="mt-0.5 text-xs text-ink-500">{template.description}</div>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <a
                    href={
                      env.driveMode === "mock"
                        ? `/mock-drive/${template.googleFileId}`
                        : `https://drive.google.com/open?id=${template.googleFileId}`
                    }
                    target={env.driveMode === "mock" ? undefined : "_blank"}
                    rel="noreferrer"
                    className={buttonClass("ghost", "px-2")}
                    title="Open the template"
                  >
                    <Icon name="external" className="size-4" />
                  </a>
                  <Link
                    href={`/admin/templates?edit=${template.id}`}
                    className={buttonClass("ghost", "px-2")}
                    aria-label={`Edit ${template.name}`}
                  >
                    <Icon name="pencil" className="size-4" />
                  </Link>
                  <form action={deleteTemplateAction}>
                    <input type="hidden" name="id" value={template.id} />
                    <button
                      type="submit"
                      className={buttonClass("ghost", "px-2")}
                      aria-label={`Remove ${template.name}`}
                      title="Remove from the hub (the file itself is untouched)"
                    >
                      <Icon name="trash" className="size-4" />
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
