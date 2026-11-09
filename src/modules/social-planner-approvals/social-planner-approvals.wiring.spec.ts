import { MODULE_METADATA } from '@nestjs/common/constants';
import { DataSource } from 'typeorm';
import { ClientAreaApprovalsModule } from '../social-approvals/client/client-approvals.module';
import { ClientApprovalTextEditService } from '../social-approvals/client/client-approval-text-edit.service';
import { SocialApprovalPiecesService } from '../social-approvals/social-approval-pieces.service';
import { SocialCreativeStudioModule } from '../social-creative-studio/social-creative-studio.module';
import { SocialPlannerModule } from '../social-planner/social-planner.module';
import { SocialPlannerApprovalsModule } from './social-planner-approvals.module';
import { SocialPlannerApprovalsService } from './social-planner-approvals.service';

jest.mock('otplib', () => ({}));

type Token = unknown;

const imported = (module: object): object[] =>
  Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) ?? [];
const exportsOf = (module: object): Token[] =>
  Reflect.getMetadata(MODULE_METADATA.EXPORTS, module) ?? [];
const providersOf = (module: object): Token[] =>
  Reflect.getMetadata(MODULE_METADATA.PROVIDERS, module) ?? [];

/** Exactly what Nest will resolve: own providers and direct imports' exports. */
function reachable(module: object): Set<Token> {
  return new Set([
    ...providersOf(module),
    ...imported(module).flatMap((item) => exportsOf(item)),
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
 * AR3 — D-30's failure mode is a boot error in production, and no other test
 * loads these modules together. Exports are not transitive, so this checks
 * each constructor against what its own module can actually see.
 */
describe('AR3 module wiring', () => {
  it('the join module sees everything its service needs', () => {
    expect(
      unresolved(SocialPlannerApprovalsService, SocialPlannerApprovalsModule),
    ).toEqual([]);
  });

  it('the client edit reaches the Planner through its own module', () => {
    expect(
      unresolved(ClientApprovalTextEditService, ClientAreaApprovalsModule),
    ).toEqual([]);
  });

  // `@Optional()` would otherwise turn a broken import into a silent no-op
  // of D-20, exactly the CCOM2 failure D-30 warns about.
  it('the D-20 hooks can really reach the projection', () => {
    expect(
      reachable(SocialPlannerModule).has(SocialApprovalPiecesService),
    ).toBe(true);
    expect(
      reachable(SocialCreativeStudioModule).has(SocialApprovalPiecesService),
    ).toBe(true);
  });

  it('the Studio exports what the join module takes from it', () => {
    expect(exportsOf(SocialCreativeStudioModule).length).toBe(2);
  });
});
