import { MODULE_METADATA } from '@nestjs/common/constants';
import { DataSource } from 'typeorm';
import { PROJECT_CLIENT_ROUTES } from '../projects/client-area/projects-client-area-scope.service';
import { SocialApprovalPieceActionsService } from '../social-approvals/social-approval-piece-actions.service';
import { SocialApprovalsModule } from '../social-approvals/social-approvals.module';
import { SocialApprovalTransitionRegistry } from '../social-approvals/approval-transition.port';
import { SocialContentLifecycleService } from '../social-planner/services/social-content-lifecycle.service';
import { SocialPlanContentChangeRegistry } from '../social-planner/services/social-plan-content-change.port';
import { SocialPlanGenerationService } from '../social-planner/services/social-plan-generation.service';
import { SocialPlannerService } from '../social-planner/services/social-planner.service';
import { SocialPlannerModule } from '../social-planner/social-planner.module';
import {
  SocialPlanWorkController,
  SocialSubtaskApprovalsController,
} from './social-project-work.controller';
import { SocialPlanWorkService } from './social-plan-work.service';
import { SocialProjectWorkModule } from './social-project-work.module';
import { SocialSubtaskApprovalsService } from './social-subtask-approvals.service';
import { SocialWorkGateService } from './social-work-gate.service';
import { SocialWorkStatusService } from './social-work-status.service';

jest.mock('otplib', () => ({}));

type Token = unknown;

const metadata = (key: string, target: object): Token[] =>
  Reflect.getMetadata(key, target) ?? [];
const isModule = (token: Token): token is object =>
  typeof token === 'function' &&
  (Reflect.getMetadataKeys(token).includes(MODULE_METADATA.PROVIDERS) ||
    Reflect.getMetadataKeys(token).includes(MODULE_METADATA.IMPORTS));

/** What importing `module` provides, following re-exported modules only. */
function exportedBy(module: object, seen = new Set<object>()): Token[] {
  if (seen.has(module)) return [];
  seen.add(module);
  return metadata(MODULE_METADATA.EXPORTS, module).flatMap((token) =>
    isModule(token) ? [token, ...exportedBy(token, seen)] : [token],
  );
}

function reachable(module: object): Set<Token> {
  return new Set([
    ...metadata(MODULE_METADATA.PROVIDERS, module),
    ...metadata(MODULE_METADATA.IMPORTS, module).flatMap((item) =>
      isModule(item) ? exportedBy(item) : [],
    ),
  ]);
}

function unresolved(provider: object, module: object): string[] {
  const available = reachable(module);
  const params = (Reflect.getMetadata('design:paramtypes', provider) ??
    []) as Array<{ name?: string }>;
  return params
    .filter((param) => param !== DataSource && !available.has(param))
    .map((param) => param?.name ?? String(param));
}

/**
 * AR4 — D-30's failure mode is a boot error, and exports are not transitive.
 * No other test loads these modules together.
 */
describe('AR4 module wiring', () => {
  it.each([
    SocialWorkGateService,
    SocialWorkStatusService,
    SocialPlanWorkService,
    SocialSubtaskApprovalsService,
  ])('%p resolves in the join module', (provider) => {
    expect(unresolved(provider, SocialProjectWorkModule)).toEqual([]);
  });

  // `@Optional()` would otherwise turn a broken provider into a silent no-op.
  it.each([
    SocialPlannerService,
    SocialContentLifecycleService,
    SocialPlanGenerationService,
  ])('%p really reaches the change registry', (provider) => {
    expect(Reflect.getMetadata('design:paramtypes', provider)).toContain(
      SocialPlanContentChangeRegistry,
    );
    expect(reachable(SocialPlannerModule)).toContain(
      SocialPlanContentChangeRegistry,
    );
  });

  it('a finished piece really reaches the observers', () => {
    expect(
      Reflect.getMetadata(
        'design:paramtypes',
        SocialApprovalPieceActionsService,
      ),
    ).toContain(SocialApprovalTransitionRegistry);
    expect(reachable(SocialApprovalsModule)).toContain(
      SocialApprovalTransitionRegistry,
    );
  });

  it('declares both controllers', () => {
    expect(
      metadata(MODULE_METADATA.CONTROLLERS, SocialProjectWorkModule),
    ).toEqual(
      expect.arrayContaining([
        SocialPlanWorkController,
        SocialSubtaskApprovalsController,
      ]),
    );
  });

  // Plan AR4 item 7: the Client Area reads through its own route, never the
  // Projects Bridge, whose list is exact.
  it('does not expose any new route through the Projects Bridge', () => {
    expect(
      Object.keys(PROJECT_CLIENT_ROUTES).filter((route) =>
        /work-link|project-approvals|approval/.test(route),
      ),
    ).toEqual([]);
  });
});
