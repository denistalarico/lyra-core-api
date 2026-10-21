/** Navigation only. OAuth authority remains the hashed, single-use domain state. */
export function clientAreaOAuthRedirect(
  target: string,
  metadata: Record<string, unknown> | null | undefined,
) {
  const binding = metadata?.clientAreaBinding;
  if (!binding || typeof binding !== 'object') return target;
  const company = (binding as Record<string, unknown>).companyContextId;
  if (typeof company !== 'string' || !/^[a-f0-9-]{36}$/i.test(company))
    return target;
  const url = new URL(target);
  url.pathname = `/client-area/c/${company}/settings/integrations`;
  return url.toString();
}
