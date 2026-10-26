import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, QueryFailedError, Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import type { UpdateAnalyticsOverviewHeaderDto } from './analytics-overview-header.dto';
import { AnalyticsOverviewHeaderEntity } from './analytics-overview-header.entity';

export const DEFAULT_OVERVIEW_TITLE = 'Visão Geral';
export const OVERVIEW_TITLE_MAX = 120;
export const OVERVIEW_DESCRIPTION_MAX = 500;

export interface AnalyticsOverviewHeaderView {
  title: string;
  description: string | null;
  /** Null while the scope still answers with the fallback. */
  updatedAt: string | null;
}

/**
 * Reads and writes the shared Visão Geral header (D-AN-12).
 *
 * `get` never writes: a scope without a row answers with the fallback, so
 * merely opening Analytics in a new company leaves no trace. The first
 * `update` creates the row.
 */
@Injectable()
export class AnalyticsOverviewHeaderService {
  constructor(
    @InjectRepository(AnalyticsOverviewHeaderEntity, 'agency')
    private readonly repository: Repository<AnalyticsOverviewHeaderEntity>,
  ) {}

  async get(scope: CompanyAwareScope): Promise<AnalyticsOverviewHeaderView> {
    const row = await this.findRow(scope);
    return row
      ? toView(row)
      : { title: DEFAULT_OVERVIEW_TITLE, description: null, updatedAt: null };
  }

  async update(
    scope: CompanyAwareScope,
    actorId: string | null,
    dto: UpdateAnalyticsOverviewHeaderDto,
  ): Promise<AnalyticsOverviewHeaderView> {
    const title =
      dto.title === undefined ? undefined : normalizeTitle(dto.title);
    const description =
      dto.description === undefined
        ? undefined
        : normalizeDescription(dto.description);

    try {
      return await this.upsert(scope, actorId, title, description);
    } catch (error) {
      // Two first saves raced to create the scope's row: the loser re-reads
      // and applies its change on top of the winner's.
      if (!isUniqueViolation(error)) throw error;
      return this.upsert(scope, actorId, title, description);
    }
  }

  private async upsert(
    scope: CompanyAwareScope,
    actorId: string | null,
    title: string | undefined,
    description: string | null | undefined,
  ): Promise<AnalyticsOverviewHeaderView> {
    const row =
      (await this.findRow(scope)) ??
      this.repository.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        title: DEFAULT_OVERVIEW_TITLE,
        description: null,
      });

    // Field by field: the editor sends one field at a time, and a spread of
    // the DTO would blank the other (feedback_dto_spread_undefined_overwrite).
    if (title !== undefined) row.title = title;
    if (description !== undefined) row.description = description;
    row.updatedById = actorId;

    return toView(await this.repository.save(row));
  }

  private findRow(scope: CompanyAwareScope) {
    return this.repository.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId ?? IsNull(),
        companyContextId: scope.companyContextId ?? IsNull(),
      },
    });
  }
}

function normalizeTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new BadRequestException('O título não pode ficar vazio.');
  if (title.length > OVERVIEW_TITLE_MAX)
    throw new BadRequestException(
      `O título deve ter no máximo ${OVERVIEW_TITLE_MAX} caracteres.`,
    );
  return title;
}

function normalizeDescription(value: string | null): string | null {
  const description = value?.trim() || null;
  if (description && description.length > OVERVIEW_DESCRIPTION_MAX)
    throw new BadRequestException(
      `A descrição deve ter no máximo ${OVERVIEW_DESCRIPTION_MAX} caracteres.`,
    );
  return description;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error as QueryFailedError & { code?: string }).code === '23505'
  );
}

function toView(
  row: AnalyticsOverviewHeaderEntity,
): AnalyticsOverviewHeaderView {
  return {
    title: row.title,
    description: row.description ?? null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}
