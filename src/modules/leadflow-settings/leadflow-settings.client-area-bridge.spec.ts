import { CLIENT_AREA_EXPOSED_METADATA } from '../client-area/client-area.decorators';
import { PERMISSION_KEY_METADATA } from '../permissions/decorators/permissions.decorators';
import { LeadFlowAgencySettingsController } from './leadflow-agency-settings.controller';
import { LeadFlowBusinessModesController } from './leadflow-business-modes.controller';
import { LeadFlowClientSettingsController } from './leadflow-client-settings.controller';

type ControllerClass = { prototype: Record<string, unknown> };

function metadata(controller: ControllerClass, method: string) {
  const handler = controller.prototype[method];
  const modules = Reflect.getMetadata(
    CLIENT_AREA_EXPOSED_METADATA,
    handler as object,
  ) as unknown;
  const methodPermission = Reflect.getMetadata(
    PERMISSION_KEY_METADATA,
    handler as object,
  ) as unknown;
  const classPermission = Reflect.getMetadata(
    PERMISSION_KEY_METADATA,
    controller as object,
  ) as unknown;
  return {
    modules,
    permission: methodPermission ?? classPermission,
  };
}

describe('R2 LeadFlow settings Client Area Bridge matrix', () => {
  const view = 'leadflow.settings.general.view.admin';
  const update = 'leadflow.settings.general.update.admin';
  const owner = 'leadflow.settings.danger_zone.manage.owner_only';

  it.each([
    [LeadFlowBusinessModesController, 'listBusinessModes', view],
    [LeadFlowBusinessModesController, 'getBusinessMode', view],
    [LeadFlowClientSettingsController, 'listClients', view],
    [LeadFlowClientSettingsController, 'getCapacity', view],
    [LeadFlowClientSettingsController, 'getSettings', view],
    [LeadFlowClientSettingsController, 'validateSettings', view],
    [LeadFlowClientSettingsController, 'previewCompanyContext', view],
    [LeadFlowClientSettingsController, 'createSettings', update],
    [LeadFlowClientSettingsController, 'updateSettings', update],
    [LeadFlowClientSettingsController, 'publishCompanyContext', update],
    [LeadFlowClientSettingsController, 'setDeveloperMode', owner],
    [LeadFlowAgencySettingsController, 'getSettings', view],
    [LeadFlowAgencySettingsController, 'validateSettings', view],
    [LeadFlowAgencySettingsController, 'previewCompanyContext', view],
    [LeadFlowAgencySettingsController, 'createSettings', update],
    [LeadFlowAgencySettingsController, 'updateSettings', update],
    [LeadFlowAgencySettingsController, 'publishCompanyContext', update],
    [LeadFlowAgencySettingsController, 'setDeveloperMode', owner],
  ])(
    '%s.%s is opt-in and keeps its Manager/Owner permission',
    (controller, method, permission) => {
      expect(
        metadata(controller as unknown as ControllerClass, method),
      ).toEqual({
        modules: ['leadflow_agents'],
        permission,
      });
    },
  );

  it('does not expose destructive deletion as a settings side effect', () => {
    const handler = (
      LeadFlowClientSettingsController as unknown as ControllerClass
    ).prototype.deleteSettings;
    expect(
      Reflect.getMetadata(
        CLIENT_AREA_EXPOSED_METADATA,
        handler as object,
      ) as unknown,
    ).toBeUndefined();
  });

  it('forces the agency client from the authenticated membership context', async () => {
    const getSettings = jest.fn().mockResolvedValue({});
    const controller = new LeadFlowClientSettingsController({
      getSettings,
    } as never);
    const forced = '00000000-0000-4000-8000-000000000001';
    await controller.getSettings(
      {
        tenantId: '00000000-0000-4000-8000-000000000002',
        role: 'client_area_actor',
        managedContext: {
          productKey: 'leadflow',
          operatingMode: 'client',
          clientId: forced,
          companyContextId: '00000000-0000-4000-8000-000000000003',
          managedTenantId: null,
        },
      },
      'forged-browser-value',
    );
    expect(getSettings).toHaveBeenCalledWith(expect.anything(), forced);
  });

  it('keeps the agency client catalog exclusive to Agency and agency_self', () => {
    const controller = new LeadFlowClientSettingsController({} as never);
    expect(() =>
      controller.listClients(
        { tenantId: 'tenant', role: 'client_area_actor' },
        {} as never,
      ),
    ).toThrow();
  });
});
