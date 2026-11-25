import { projectAgencyPermissions } from '../client-area/client-area-agency-permission-projection';
import { DANGEROUS_ACTION_METADATA } from '../permissions';
import { CreativeStudioController } from '../social-creative-studio/creative-studio.controller';
import { SocialPlannerController } from '../social-planner/social-planner.controller';
import {
  SOCIAL_CLIENT_AREA_ROUTES,
  socialRuleModules,
} from './social-client-area.routes';
import { socialRoutes } from './social-client-area.routes.inventory';
import { SOCIAL_CLIENT_AREA_MODULES } from './social-client-area-scope.service';

describe('CA10 Social routes on the Surface Bridge', () => {
  const routes = socialRoutes();
  const exposed = routes.filter((route) => route.exposed);
  // CA-AN1: one entry per module; the CA10 modules keep their own checks and
  // the Analytics module is checked below with its Owner rule.
  const ca10 = exposed.filter((route) =>
    (SOCIAL_CLIENT_AREA_MODULES as readonly string[]).includes(route.module),
  );
  const analytics = exposed.filter((route) => route.module === 'analytics');

  it('keeps the decorator opt-ins and the adapter table identical, module by module', () => {
    // +1 (2026-11-20, GA-DET): GET social/campaigns/google/campaigns/:campaignId/details.
    // +7 (2026-11-24, F2): Planner deletes (4) and Studio archive/delete/restore (3).
    // +2 (2026-11-24, F3): Studio retention GET/PUT (Settings › Armazenamento, level manager).
    expect(ca10).toHaveLength(140);
    // +1 (2026-11-20, AN-CRM): GET social/analytics/crm-leads (Owner only).
    expect(analytics).toHaveLength(36);
    expect(
      exposed.map((route) => `${route.key} ${route.module}`).sort(),
    ).toEqual(
      Object.entries(SOCIAL_CLIENT_AREA_ROUTES)
        .flatMap(([key, rule]) =>
          socialRuleModules(rule).map((module) => `${key} ${module}`),
        )
        .sort(),
    );
  });

  it('reaches Analytics reads with Operator, writes only with the Owner, nothing with Viewer (D-AN-13)', () => {
    const reaches = (
      route: (typeof analytics)[number],
      level: 'viewer' | 'operator' | 'manager',
      role: 'client_owner' | 'client_member',
    ) =>
      projectAgencyPermissions('analytics', level, role).some(
        (grant) =>
          grant.methods.includes(route.verb) &&
          route.permissions.includes(grant.key),
      );
    for (const route of analytics) {
      const at = `${route.verb} ${route.path}`;
      const read =
        route.verb === 'GET' || /\/reports\/(preview|pdf)$/.test(route.path);
      expect([at, reaches(route, 'viewer', 'client_member')]).toEqual([
        at,
        false,
      ]);
      for (const level of ['operator', 'manager'] as const)
        expect([at, level, reaches(route, level, 'client_member')]).toEqual([
          at,
          level,
          read,
        ]);
      expect([at, reaches(route, 'manager', 'client_owner')]).toEqual([
        at,
        true,
      ]);
    }
  });

  it('reaches every opt-in with the Manager projection of its module, reads with Viewer', () => {
    for (const route of ca10) {
      // Superseded by F2 (2026-11-24): the Manager projection is the Owner's
      // (`client_owner` is `manager` everywhere), because the Planner deletes
      // are Owner-only; the non-Owner Manager is checked in the F2 test below.
      const grants = (level: 'viewer' | 'manager') =>
        projectAgencyPermissions(
          route.module,
          level,
          level === 'manager' ? 'client_owner' : undefined,
        ).filter(
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

  it('F2: Planner deletes and Studio archive/delete/restore reach only the Owner', () => {
    const planner = [
      'SocialPlannerController.removePlan',
      'SocialPlannerController.removeContent',
      'SocialPlannerController.discardContent',
      'SocialPlannerController.removeContentBatch',
    ];
    const studio = [
      'CreativeStudioController.archive',
      'CreativeStudioController.removeAsset',
      'CreativeStudioController.restore',
    ];
    const reaches = (
      route: (typeof ca10)[number],
      level: 'viewer' | 'operator' | 'manager',
      role?: 'client_owner' | 'client_member',
    ) =>
      projectAgencyPermissions(route.module, level, role).some(
        (grant) =>
          grant.methods.includes(route.verb) &&
          route.permissions.includes(grant.key),
      );
    const byHandler = new Map(ca10.map((route) => [route.handler, route]));
    for (const handler of [...planner, ...studio]) {
      const route = byHandler.get(handler);
      expect([handler, route?.exposed]).toEqual([handler, true]);
      for (const level of ['viewer', 'operator'] as const)
        expect([
          handler,
          level,
          reaches(route!, level, 'client_owner'),
        ]).toEqual([handler, level, false]);
      expect([handler, reaches(route!, 'manager', 'client_owner')]).toEqual([
        handler,
        true,
      ]);
      expect([handler, reaches(route!, 'manager', 'client_member')]).toEqual([
        handler,
        false,
      ]);
      expect([
        handler,
        Boolean(
          Reflect.getMetadata(
            DANGEROUS_ACTION_METADATA,
            Reflect.get(
              handler.startsWith('SocialPlanner')
                ? SocialPlannerController.prototype
                : CreativeStudioController.prototype,
              handler.split('.')[1],
            ) as object,
          ),
        ),
      ]).toEqual([handler, planner.includes(handler)]);
    }
  });

  it('never exposes deletes, approval submission, production writes, costs or ad governance', () => {
    // Superseded by F2 (2026-11-24): Planner deletes and Studio asset
    // archive/delete/restore left this list (see the F2 test above).
    const forbidden = [
      'SocialPlannerController.sendRevisionForApproval',
      'CreativeStudioController.deleteFolder',
      'CreativeStudioController.archiveFolder',
      'CreativeStudioController.emptyTrash',
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
    // Superseded by F2 (2026-11-24): + Planner plan/content deletes and the
    // Studio asset delete.
    for (const route of exposed)
      expect(route.verb === 'DELETE' ? route.path : 'ok').toMatch(
        /^ok$|\/references\/:referenceId$|\/destinations\/:destinationId\/creative$|^\/social\/analytics\/dashboards\/:id$|^\/social\/planner\/plans\/:planId$|^\/social\/planner\/content\/:contentId(\/discard)?$|^\/social\/creative-studio\/assets\/:id$/,
      );
    // CA-AN1: the report archive is deleted by the agency only; the Orion
    // insights stay out.
    for (const route of exposed)
      expect(route.path).not.toMatch(/\/insights|reports\/:id$/);
  });

  it('exposes only the two read routes of Social Analytics the Campaigns page needs', () => {
    expect(
      ca10
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
