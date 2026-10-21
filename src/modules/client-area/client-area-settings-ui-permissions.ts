import type { ClientAreaContext } from './client-area.types';

/** UX projection only. Every facade independently authorizes the live identity/membership. */
export function clientAreaSettingsUiPermissions(
  context: ClientAreaContext,
): string[] {
  const keys = [
    'client_area.settings.security.manage_self',
    'client_area.settings.privacy.view',
  ];
  if (context.modules.conversations)
    keys.push('client_area.settings.requests.deletion.create');
  if (context.role !== 'client_owner') return keys;
  keys.push(
    'client_area.settings.members.manage',
    'client_area.settings.business.manage',
    'client_area.settings.audit.view',
    'client_area.settings.consent.decide',
  );
  if (context.modules.conversations)
    keys.push('client_area.settings.requests.invitation.create');
  if (context.modules.social_campaigns)
    keys.push('client_area.settings.integrations.meta_ads.manage');
  if (context.modules.social_planner)
    keys.push('client_area.settings.integrations.social_organic.manage');
  if (context.modules.leadflow_inbox)
    keys.push('client_area.settings.integrations.inbox.manage');
  return keys;
}
