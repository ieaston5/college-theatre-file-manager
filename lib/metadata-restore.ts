type BackupRow = Record<string, unknown> & { id: string };

/** Format 1 omitted category links; preserve existing links when they are unknown. */
export function restoreProductionRole(row: BackupRow) {
  const { categoryIds, ...rest } = row as BackupRow & { categoryIds?: string[] };
  const links = categoryIds?.map((id) => ({ id }));
  return {
    create: { ...rest, ...(links ? { categories: { connect: links } } : {}) },
    update: { ...rest, ...(links ? { categories: { set: links } } : {}) },
  };
}

/** The join is authoritative, including an explicitly empty assignment list. */
export function restoreProductionMember(row: BackupRow) {
  const { roleIds, roleId, ...rest } = row as BackupRow & { roleIds?: string[]; roleId?: string | null };
  const ids = [...new Set(roleIds ?? (roleId ? [roleId] : []))];
  const createMany = { data: ids.map((id) => ({ roleId: id })), skipDuplicates: true };
  return {
    create: { ...rest, roleId: null, roles: { createMany } },
    update: {
      ...rest, roleId: null,
      roles: { deleteMany: { roleId: { notIn: ids } }, createMany },
    },
  };
}
