import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import type { UpdateApprovalBoardPreferencesDto } from './dto/social-approval-piece.dto';
import {
  SOCIAL_APPROVAL_BOARD_COLUMNS,
  SocialApprovalBoardPreferencesEntity,
  type SocialApprovalBoardColumn,
  type SocialApprovalStagePreference,
} from './entities';

export type ApprovalBoardPreferences = {
  order: SocialApprovalBoardColumn[];
  stages: Partial<
    Record<SocialApprovalBoardColumn, SocialApprovalStagePreference>
  >;
};

/** Saved columns first, in their saved order; any column not saved keeps its default place. */
export function normalizeStageOrder(
  saved: readonly string[],
): SocialApprovalBoardColumn[] {
  const known = new Set<string>(SOCIAL_APPROVAL_BOARD_COLUMNS);
  const kept = [...new Set(saved)].filter((column) =>
    known.has(column),
  ) as SocialApprovalBoardColumn[];
  return [
    ...kept,
    ...SOCIAL_APPROVAL_BOARD_COLUMNS.filter((column) => !kept.includes(column)),
  ];
}

@Injectable()
export class SocialApprovalBoardPreferencesService {
  constructor(
    @InjectRepository(SocialApprovalBoardPreferencesEntity, 'agency')
    private readonly preferences: Repository<SocialApprovalBoardPreferencesEntity>,
  ) {}

  async get(scope: CompanyAwareScope): Promise<ApprovalBoardPreferences> {
    const row = await this.preferences.findOne({
      where: { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
    });
    return {
      order: normalizeStageOrder(row?.stageOrder ?? []),
      stages: row?.stages ?? {},
    };
  }

  /** One statement, so two admins saving different stages cannot erase each other. */
  async update(
    scope: CompanyAwareScope,
    actorUserId: string,
    dto: UpdateApprovalBoardPreferencesDto,
  ): Promise<ApprovalBoardPreferences> {
    const order = dto.order ? normalizeStageOrder(dto.order) : null;
    const stage = dto.stage
      ? {
          [dto.stage.column]: {
            color: dto.stage.color,
            description: dto.stage.description.trim(),
          },
        }
      : {};
    await this.preferences.query(
      `INSERT INTO "social_approval_board_preferences"
         ("tenant_id", "workspace_id", "stage_order", "stages", "updated_by_user_id")
       VALUES ($1, $2, COALESCE($3::jsonb, '[]'::jsonb), $4::jsonb, $5)
       ON CONFLICT ("tenant_id", "workspace_id") DO UPDATE SET
         "stage_order" = COALESCE($3::jsonb, "social_approval_board_preferences"."stage_order"),
         "stages" = "social_approval_board_preferences"."stages" || $4::jsonb,
         "updated_by_user_id" = $5,
         "updated_at" = now()`,
      [
        scope.tenantId,
        scope.workspaceId,
        order ? JSON.stringify(order) : null,
        JSON.stringify(stage),
        actorUserId,
      ],
    );
    return this.get(scope);
  }
}
