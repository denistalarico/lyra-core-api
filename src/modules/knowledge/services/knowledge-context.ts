export type KnowledgeContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  role?: string;
};

export function parseOptionalDate(value?: string | null): Date | null {
  if (!value) return null;

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}
