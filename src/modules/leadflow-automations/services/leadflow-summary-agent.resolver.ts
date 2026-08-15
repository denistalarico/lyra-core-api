import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LeadFlowAgentEntity } from '../../leadflow-agents/entities';
import { LeadFlowAgentStatus } from '../../leadflow-agents/enums/leadflow-agent-status.enum';
import { LeadFlowAgentType } from '../../leadflow-agents/enums/leadflow-agent-type.enum';
import type { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';

export interface SummaryAgentIdentity {
  id: string | null;
  name: string;
  type: string | null;
}

export interface SummaryAgentScope {
  tenantId: string;
  workspaceId: string;
  contextType: LeadFlowSettingsContextType;
  agencyClientId: string | null;
}

/** Used when the workspace has no agent at all yet. */
const FALLBACK_AGENT_NAME = 'Lyra';

/**
 * Decides which agent signs a message the platform writes on its own.
 *
 * The digest is not a conversation, so there is no channel binding to follow.
 * The rule is the one an operator would expect: whoever is on duty — an agent
 * that is active and published — preferring the receptionist, since greeting and
 * reporting are the same job of speaking for the house. Failing that, any agent
 * configured in the context, so the message still carries the name the team
 * recognises; failing even that, the product name.
 */
@Injectable()
export class LeadFlowSummaryAgentResolver {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async resolve(scope: SummaryAgentScope): Promise<SummaryAgentIdentity> {
    const agent =
      (await this.findAgent(scope, true)) ??
      (await this.findAgent(scope, false));

    return {
      id: agent?.id ?? null,
      name: agent?.name?.trim() || FALLBACK_AGENT_NAME,
      type: agent?.type ?? null,
    };
  }

  private async findAgent(
    scope: SummaryAgentScope,
    onlyLive: boolean,
  ): Promise<LeadFlowAgentEntity | null> {
    const repository = this.dataSource.getRepository(LeadFlowAgentEntity);
    const query = repository
      .createQueryBuilder('agent')
      .where('agent.tenant_id = :tenantId', { tenantId: scope.tenantId })
      .andWhere('agent.workspace_id = :workspaceId', {
        workspaceId: scope.workspaceId,
      })
      .andWhere('agent.context_type = :contextType', {
        contextType: scope.contextType,
      })
      .andWhere('agent.archived_at IS NULL');

    if (scope.agencyClientId) {
      query.andWhere('agent.agency_client_id = :agencyClientId', {
        agencyClientId: scope.agencyClientId,
      });
    } else {
      query.andWhere('agent.agency_client_id IS NULL');
    }

    if (onlyLive) {
      query
        .andWhere('agent.status = :status', {
          status: LeadFlowAgentStatus.Active,
        })
        .andWhere('agent.published_version_id IS NOT NULL');
    }

    return query
      .orderBy(
        `CASE WHEN agent.type = '${LeadFlowAgentType.Reception}' THEN 0 ELSE 1 END`,
        'ASC',
      )
      .addOrderBy('agent.updated_at', 'DESC')
      .getOne();
  }
}
