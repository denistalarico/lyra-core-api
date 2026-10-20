import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { getPermissionDefinition } from '../permissions/catalog/permission-keys.catalog';
import { CLIENT_AREA_MODULE_KEYS } from './client-area.types';
import { projectAgencyPermissions } from './client-area-agency-permission-projection';

const digest = (value: string) =>
  createHash('sha256').update(value.trim()).digest('hex');
describe('CA7 production route boundaries and Agency preservation', () => {
  it('keeps the Agency PermissionsGuard body byte-for-byte after the isolated dispatch', () => {
    const source = readFileSync(
      resolve(__dirname, '../permissions/guards/permissions.guard.ts'),
      'utf8',
    );
    const method = source
      .slice(
        source.indexOf('  async canActivate('),
        source.indexOf('  private async authorizeClientArea'),
      )
      .replace(
        /\n\n {4}if \(user\?\.surface === 'client_area'\)\n {6}return this\.authorizeClientArea\(executionContext, request\);/,
        '',
      );
    expect(digest(method)).toBe(
      '215cd01b8fc4f0c24ea0d7b8640df2dd19fb0053e6646f6c1499f3e4eca7898f',
    );
  });
  it('keeps every existing Agency scope evaluator method byte-for-byte', () => {
    const source = readFileSync(
      resolve(
        __dirname,
        '../permissions/services/permission-scope-evaluator.service.ts',
      ),
      'utf8',
    );
    expect(digest(source.slice(source.indexOf('  async assertScope(')))).toBe(
      'a67a3bed34a180f20dca3e10e143082bab9ad5970fe7e9c28e13f8eed4ec03c9',
    );
  });
  it('projects only real, non-dangerous keys and no workspace configuration or automations', () => {
    for (const module of CLIENT_AREA_MODULE_KEYS)
      for (const level of ['viewer', 'operator', 'manager'] as const)
        for (const entry of projectAgencyPermissions(module, level)) {
          expect(getPermissionDefinition(entry.key)).toBeDefined();
          expect(getPermissionDefinition(entry.key)?.isDangerous).toBe(false);
          expect(entry.key).not.toMatch(
            /owner_only|danger_zone|settings.users|automations|stages.manage/,
          );
        }
  });
  it('snapshots production opt-ins and rejects unguarded, dangerous or automation routes', () => {
    // CA10: `src/common` hosts product controllers too (publishing media).
    const roots = [
      resolve(__dirname, '..'),
      resolve(__dirname, '../../common'),
    ];
    const exposed: string[] = [];
    const decorators = (node: ts.Node) =>
      ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
    const names = (node: ts.Node) =>
      decorators(node).map((d) =>
        ts.isCallExpression(d.expression)
          ? d.expression.expression.getText()
          : d.expression.getText(),
      );
    for (const [relative, root] of roots.flatMap((root) =>
      readdirSync(root, { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith('.controller.ts'))
        .map((file) => [file, root] as const),
    )) {
      const source = ts.createSourceFile(
        relative,
        readFileSync(resolve(root, relative), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const item of source.statements)
        if (ts.isClassDeclaration(item)) {
          expect(names(item)).not.toContain('ClientAreaExposed');
          for (const method of item.members)
            if (names(method).includes('ClientAreaExposed')) {
              const effective = [...names(item), ...names(method)];
              expect(
                effective.some((n) =>
                  ['RequirePermission', 'RequireAnyPermission'].includes(n),
                ),
              ).toBe(true);
              expect(effective).not.toContain('DangerousAction');
              expect(relative).not.toMatch(/automations/);
              exposed.push(`${relative}:${method.name?.getText()}`);
            }
        }
    }
    expect(exposed.sort()).toMatchInlineSnapshot(`
     [
       "media-assets/media-asset.controller.ts:getContent",
       "media-assets/media-asset.controller.ts:list",
       "media-assets/media-asset.controller.ts:upload",
       "projects/controllers/project-boards.controller.ts:getMyTasksBoard",
       "projects/controllers/project-boards.controller.ts:getProjectTasksBoard",
       "projects/controllers/project-boards.controller.ts:getProjectsBoard",
       "projects/controllers/project-boards.controller.ts:getWorkspaceTasksBoard",
       "projects/controllers/project-events.controller.ts:create",
       "projects/controllers/project-events.controller.ts:list",
       "projects/controllers/project-followers-attachments.controller.ts:listAttachments",
       "projects/controllers/project-followers-attachments.controller.ts:listFollowers",
       "projects/controllers/project-followers-attachments.controller.ts:uploadAttachment",
       "projects/controllers/projects-crud.controller.ts:archive",
       "projects/controllers/projects-crud.controller.ts:create",
       "projects/controllers/projects-crud.controller.ts:findOne",
       "projects/controllers/projects-crud.controller.ts:list",
       "projects/controllers/projects-crud.controller.ts:update",
       "projects/controllers/task-workspace.controller.ts:createChecklistItem",
       "projects/controllers/task-workspace.controller.ts:createComment",
       "projects/controllers/task-workspace.controller.ts:getChecklistItem",
       "projects/controllers/task-workspace.controller.ts:listChecklist",
       "projects/controllers/task-workspace.controller.ts:listComments",
       "projects/controllers/task-workspace.controller.ts:updateChecklistItem",
       "projects/controllers/tasks-crud.controller.ts:archive",
       "projects/controllers/tasks-crud.controller.ts:createMyTask",
       "projects/controllers/tasks-crud.controller.ts:createWorkspaceTask",
       "projects/controllers/tasks-crud.controller.ts:findOne",
       "projects/controllers/tasks-crud.controller.ts:listAttachments",
       "projects/controllers/tasks-crud.controller.ts:listMyAssignedSubtasks",
       "projects/controllers/tasks-crud.controller.ts:listMyTasks",
       "projects/controllers/tasks-crud.controller.ts:listWorkspaceTasks",
       "projects/controllers/tasks-crud.controller.ts:remove",
       "projects/controllers/tasks-crud.controller.ts:update",
       "projects/controllers/tasks-crud.controller.ts:uploadAttachment",
       "projects/controllers/tasks-crud.controller.ts:uploadCover",
       "social-campaigns/social-campaigns.controller.ts:acknowledgeAlert",
       "social-campaigns/social-campaigns.controller.ts:actionAvailability",
       "social-campaigns/social-campaigns.controller.ts:actionHistory",
       "social-campaigns/social-campaigns.controller.ts:actionPolicy",
       "social-campaigns/social-campaigns.controller.ts:confirmBudget",
       "social-campaigns/social-campaigns.controller.ts:confirmSchedule",
       "social-campaigns/social-campaigns.controller.ts:confirmStatus",
       "social-campaigns/social-campaigns.controller.ts:evaluateMonitor",
       "social-campaigns/social-campaigns.controller.ts:generateRecommendations",
       "social-campaigns/social-campaigns.controller.ts:list",
       "social-campaigns/social-campaigns.controller.ts:listRecommendations",
       "social-campaigns/social-campaigns.controller.ts:metaHierarchy",
       "social-campaigns/social-campaigns.controller.ts:monitorOverview",
       "social-campaigns/social-campaigns.controller.ts:preflightBudget",
       "social-campaigns/social-campaigns.controller.ts:preflightSchedule",
       "social-campaigns/social-campaigns.controller.ts:preflightStatus",
       "social-campaigns/social-campaigns.controller.ts:recommendationAvailability",
       "social-creative-studio/creative-image-generation.controller.ts:generateImages",
       "social-creative-studio/creative-image-generation.controller.ts:getGeneration",
       "social-creative-studio/creative-image-generation.controller.ts:outputContent",
       "social-creative-studio/creative-image-generation.controller.ts:promote",
       "social-creative-studio/creative-image-generation.controller.ts:promoteAsVersion",
       "social-creative-studio/creative-image-generation.controller.ts:regenerate",
       "social-creative-studio/creative-image-generation.controller.ts:varyOutput",
       "social-creative-studio/creative-image-generation.controller.ts:varyVersion",
       "social-creative-studio/creative-production.controller.ts:view",
       "social-creative-studio/creative-studio.controller.ts:brandContextForStudio",
       "social-creative-studio/creative-studio.controller.ts:content",
       "social-creative-studio/creative-studio.controller.ts:createFolder",
       "social-creative-studio/creative-studio.controller.ts:detail",
       "social-creative-studio/creative-studio.controller.ts:foldersList",
       "social-creative-studio/creative-studio.controller.ts:list",
       "social-creative-studio/creative-studio.controller.ts:thumbnail",
       "social-creative-studio/creative-studio.controller.ts:update",
       "social-creative-studio/creative-studio.controller.ts:updateFolder",
       "social-creative-studio/creative-studio.controller.ts:upload",
       "social-creative-studio/creative-studio.controller.ts:version",
       "social-creative-studio/creative-studio.controller.ts:versions",
       "social-creative-studio/creative-video-generation.controller.ts:content",
       "social-creative-studio/creative-video-generation.controller.ts:generate",
       "social-creative-studio/creative-video-generation.controller.ts:get",
       "social-creative-studio/creative-video-generation.controller.ts:list",
       "social-creative-studio/creative-video-generation.controller.ts:poster",
       "social-creative-studio/creative-video-generation.controller.ts:preview",
       "social-creative-studio/creative-video-generation.controller.ts:promote",
       "social-creative-studio/creative-video-generation.controller.ts:promoteAsVersion",
       "social-integrations/social-analytics.controller.ts:connections",
       "social-integrations/social-analytics.controller.ts:timeseries",
       "social-organic/publication/destination-creative.controller.ts:list",
       "social-organic/publication/destination-creative.controller.ts:remove",
       "social-organic/publication/destination-creative.controller.ts:replace",
       "social-organic/publication/destination-creative.controller.ts:replaceCollection",
       "social-organic/publication/social-publication.controller.ts:cancel",
       "social-organic/publication/social-publication.controller.ts:capabilities",
       "social-organic/publication/social-publication.controller.ts:create",
       "social-organic/publication/social-publication.controller.ts:get",
       "social-organic/publication/social-publication.controller.ts:list",
       "social-organic/publication/social-publication.controller.ts:publishNow",
       "social-organic/publication/social-publication.controller.ts:reschedule",
       "social-organic/publication/social-publication.controller.ts:retry",
       "social-organic/publication/social-publication.controller.ts:targets",
       "social-planner/social-content-reference.controller.ts:link",
       "social-planner/social-content-reference.controller.ts:list",
       "social-planner/social-content-reference.controller.ts:remove",
       "social-planner/social-content-reference.controller.ts:reorder",
       "social-planner/social-content-reference.controller.ts:update",
       "social-planner/social-planner.controller.ts:acceptCopyProposals",
       "social-planner/social-planner.controller.ts:archiveContent",
       "social-planner/social-planner.controller.ts:archiveContentBatch",
       "social-planner/social-planner.controller.ts:archivePlan",
       "social-planner/social-planner.controller.ts:cancelCopyGenerationRun",
       "social-planner/social-planner.controller.ts:convertIdea",
       "social-planner/social-planner.controller.ts:copyGenerationAvailability",
       "social-planner/social-planner.controller.ts:createCampaign",
       "social-planner/social-planner.controller.ts:createCampaignTemplate",
       "social-planner/social-planner.controller.ts:createContent",
       "social-planner/social-planner.controller.ts:createIdea",
       "social-planner/social-planner.controller.ts:createPillar",
       "social-planner/social-planner.controller.ts:createPlan",
       "social-planner/social-planner.controller.ts:createRevision",
       "social-planner/social-planner.controller.ts:discardIdea",
       "social-planner/social-planner.controller.ts:duplicateContent",
       "social-planner/social-planner.controller.ts:exportPlanContent",
       "social-planner/social-planner.controller.ts:generatePlan",
       "social-planner/social-planner.controller.ts:getCadence",
       "social-planner/social-planner.controller.ts:getContent",
       "social-planner/social-planner.controller.ts:getCopyGenerationRun",
       "social-planner/social-planner.controller.ts:getPillarCoverage",
       "social-planner/social-planner.controller.ts:getPlan",
       "social-planner/social-planner.controller.ts:getSettings",
       "social-planner/social-planner.controller.ts:listCampaignTemplates",
       "social-planner/social-planner.controller.ts:listCampaigns",
       "social-planner/social-planner.controller.ts:listCommemorativeDates",
       "social-planner/social-planner.controller.ts:listContent",
       "social-planner/social-planner.controller.ts:listCopyGeneration",
       "social-planner/social-planner.controller.ts:listIdeas",
       "social-planner/social-planner.controller.ts:listPillars",
       "social-planner/social-planner.controller.ts:listPlans",
       "social-planner/social-planner.controller.ts:listRevisions",
       "social-planner/social-planner.controller.ts:rejectCopyProposals",
       "social-planner/social-planner.controller.ts:replaceDestinations",
       "social-planner/social-planner.controller.ts:requestCopyGeneration",
       "social-planner/social-planner.controller.ts:requestCopyGenerationForPlan",
       "social-planner/social-planner.controller.ts:requestCopyGenerationForSelection",
       "social-planner/social-planner.controller.ts:restoreContent",
       "social-planner/social-planner.controller.ts:restoreContentBatch",
       "social-planner/social-planner.controller.ts:restoreRevision",
       "social-planner/social-planner.controller.ts:updateCadence",
       "social-planner/social-planner.controller.ts:updateCampaign",
       "social-planner/social-planner.controller.ts:updateCampaignTemplate",
       "social-planner/social-planner.controller.ts:updateContent",
       "social-planner/social-planner.controller.ts:updateIdea",
       "social-planner/social-planner.controller.ts:updatePillar",
       "social-planner/social-planner.controller.ts:updatePlan",
       "social-planner/social-planner.controller.ts:updateSettings",
     ]
    `);
  });
});
