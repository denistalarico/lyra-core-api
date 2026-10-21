import { projectAgencyPermissions } from '../client-area/client-area-agency-permission-projection';
import { SOCIAL_CLIENT_AREA_ROUTES } from './social-client-area.routes';
import { socialRoutes } from './social-client-area.routes.inventory';

describe('CA10 Social routes on the Surface Bridge', () => {
  const routes = socialRoutes();
  const exposed = routes.filter((route) => route.exposed);

  it('keeps the decorator opt-ins and the adapter table identical', () => {
    expect(exposed).toHaveLength(123);
    expect(exposed.map((route) => route.key).sort()).toEqual(
      Object.keys(SOCIAL_CLIENT_AREA_ROUTES).sort(),
    );
    for (const route of exposed)
      expect([route.handler, route.module]).toEqual([
        route.handler,
        SOCIAL_CLIENT_AREA_ROUTES[route.key].module,
      ]);
  });

  it('reaches every opt-in with the Manager projection of its module, reads with Viewer', () => {
    for (const route of exposed) {
      const grants = (level: 'viewer' | 'manager') =>
        projectAgencyPermissions(route.module, level).filter(
          (grant) =>
            grant.methods.includes(route.verb) &&
            route.permissions.includes(grant.key),
        );
      expect([route.handler, grants('manager').length > 0]).toEqual([
        route.handler,
        true,
      ]);
      if (route.verb === 'GET')
        expect([route.handler, grants('viewer').length > 0]).toEqual([
          route.handler,
          true,
        ]);
    }
  });

  it('marks every AI generation and media spend route with its D-13 cost', () => {
    const ai =
      /copy-generation$|\/generate$|generations\/images$|regenerate$|\/vary$|video-generations$|recommendations\/generate$/;
    const media = /meta\/actions\/(status|budget|schedule)\//;
    for (const [key, rule] of Object.entries(SOCIAL_CLIENT_AREA_ROUTES)) {
      if (!key.startsWith('POST ')) continue;
      if (ai.test(key)) expect([key, rule.cost]).toEqual([key, 'ai']);
      else if (media.test(key))
        expect([key, rule.cost]).toEqual([key, 'media']);
      else expect([key, rule.cost]).toEqual([key, undefined]);
      if (rule.cost) expect([key, rule.manager]).toEqual([key, true]);
    }
  });

  it('never exposes deletes, approval submission, production writes, costs or ad governance', () => {
    const forbidden = [
      'SocialPlannerController.removePlan',
      'SocialPlannerController.removeContent',
      'SocialPlannerController.discardContent',
      'SocialPlannerController.removeContentBatch',
      'SocialPlannerController.sendRevisionForApproval',
      'CreativeStudioController.archive',
      'CreativeStudioController.deleteFolder',
      'CreativeVersionApprovalController.sendForApproval',
      'CreativeVersionApprovalController.approvalState',
      'SocialPublicationController.deleteFailed',
      'SocialCampaignsController.preflightBoost',
      'SocialCampaignsController.confirmBoost',
      'SocialCampaignsController.searchBoostTargeting',
      'SocialCampaignsController.preflightDelete',
      'SocialCampaignsController.confirmDelete',
      'SocialCampaignsController.updateActionPolicy',
      'SocialCampaignsController.updateMonitorPolicy',
      'SocialCampaignsController.create',
      'SocialCampaignsController.update',
    ];
    const byHandler = new Map(routes.map((route) => [route.handler, route]));
    for (const handler of forbidden)
      if (byHandler.has(handler))
        expect([handler, byHandler.get(handler)!.exposed]).toEqual([
          handler,
          false,
        ]);
    for (const route of routes)
      if (
        route.handler.startsWith('CreativeProductionController.') ||
        route.handler.startsWith('CreativeCostController.') ||
        route.handler.startsWith('CreativeVersionApprovalController.')
      )
        expect([route.handler, route.exposed]).toEqual([
          route.handler,
          route.handler === 'CreativeProductionController.view',
        ]);
    for (const route of exposed)
      expect(route.verb === 'DELETE' ? route.path : 'ok').toMatch(
        /^ok$|\/references\/:referenceId$|\/destinations\/:destinationId\/creative$/,
      );
  });

  it('exposes only the two read routes of Social Analytics the Campaigns page needs', () => {
    expect(
      exposed
        .filter((route) =>
          route.handler.startsWith('SocialAnalyticsController.'),
        )
        .map((route) => route.key)
        .sort(),
    ).toEqual([
      'GET /social/analytics/connections',
      'GET /social/analytics/timeseries',
    ]);
  });
});
