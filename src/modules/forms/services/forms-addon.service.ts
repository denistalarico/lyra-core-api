import { ForbiddenException, Injectable } from '@nestjs/common';
import { AgencySettingsService } from '../../agency/agency-settings.service';

export const FORMS_APP_KEY = 'forms';

/**
 * Addon switch (D-F11): only the agency workspace turns Forms on, in
 * Settings > Apps & integrations. When on, it serves the agency and every
 * managed LeadFlow client; billing, if any, is per agency.
 *
 * Stored as `{ appKey: 'forms', enabled }` in `workspace_apps_settings.apps`.
 * Forms is not one of the default app keys, so a workspace without a saved
 * row has it off.
 */
@Injectable()
export class FormsAddonService {
  constructor(private readonly agencySettings: AgencySettingsService) {}

  async isEnabled(tenantId: string, workspaceId: string): Promise<boolean> {
    const settings = await this.agencySettings.getApps(tenantId, workspaceId);
    return (settings.apps ?? []).some(
      (app) => app.appKey === FORMS_APP_KEY && app.enabled === true,
    );
  }

  async assertEnabled(tenantId: string, workspaceId: string) {
    if (!(await this.isEnabled(tenantId, workspaceId)))
      throw new ForbiddenException({
        code: 'FORMS_ADDON_DISABLED',
        message:
          'Ative o addon Formulários em Configurações > Apps e integrações.',
      });
  }

  /** Merges the forms entry; every other app entry (and its permissions) is kept as is. */
  async setEnabled(tenantId: string, workspaceId: string, enabled: boolean) {
    const settings = await this.agencySettings.getApps(tenantId, workspaceId);
    const apps = (settings.apps ?? []).filter(
      (app) => app.appKey !== FORMS_APP_KEY,
    );
    const previous = (settings.apps ?? []).find(
      (app) => app.appKey === FORMS_APP_KEY,
    );
    apps.push({ ...(previous ?? {}), appKey: FORMS_APP_KEY, enabled });
    await this.agencySettings.patchApps(tenantId, workspaceId, { apps });
    return { enabled };
  }
}
