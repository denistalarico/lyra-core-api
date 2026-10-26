import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { resolveCompanyAwareScope } from '../../../common/context/company-aware-scope';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { AgencyContactsService } from '../../agency/agency-contacts.service';
import { CrmService } from '../../crm/crm.service';
import type { LeadFlowOperationsActionResponse } from '../../leadflow-agents/dto';
import type { LeadFlowOperationsActionIntent } from '../../leadflow-agents/entities';
import { LEADFLOW_AGENTS_PERMISSIONS } from '../../leadflow-agents/leadflow-agents.permissions';
import { LeadFlowAgentService } from '../../leadflow-agents/services/leadflow-agent.service';
import {
  APPOINTMENT_TYPES,
  CONTACT_FIELD_ALLOWLIST,
  contactFields,
  readString,
} from '../../leadflow-agents/services/leadflow-operations-action-domain';
import { LeadFlowOperationsActionService } from '../../leadflow-agents/services/leadflow-operations-action.service';
import { OrionConfigService } from '../orion-config.service';
import type { OrionProposal } from '../orion.types';
import {
  OrionToolAccessService,
  type OrionAccess,
  type OrionToolRequirement,
} from './orion-tool-access.service';

export const ORION_PROPOSAL_INTENTS = [
  'pause_agent',
  'activate_agent',
  'create_contact',
  'move_opportunity',
  'update_contact_fields',
  'create_appointment',
] as const satisfies readonly LeadFlowOperationsActionIntent[];
export type OrionProposalIntent = (typeof ORION_PROPOSAL_INTENTS)[number];

export { APPOINTMENT_TYPES, CONTACT_FIELD_ALLOWLIST };

export type OrionProposalRun = {
  ctx: RequestContext;
  access: OrionAccess;
  /** The user's own words, stored on the proposal for the audit trail. */
  requestText: string;
  /** Stable per tool call, so a replayed turn never proposes twice. */
  idempotencyKey: string;
};

export type OrionProposalOutcome = {
  payload: unknown;
  proposal?: OrionProposal;
};

type Args = Record<string, unknown>;
type Resolved<T> = { ok: T } | { error: string; candidates?: string[] };

/** Reads used to resolve names, with the read route each one stands in for. */
const READS = {
  agents: (): OrionToolRequirement => ({
    agency: {
      anyOf: [LEADFLOW_AGENTS_PERMISSIONS.view],
      routePath: '/leadflow/agents',
    },
    clientArea: {
      module: 'leadflow_agents',
      key: LEADFLOW_AGENTS_PERMISSIONS.view,
      routePath: '/leadflow/agents',
    },
  }),
  opportunities: (): OrionToolRequirement => ({
    agency: {
      anyOf: ['leadflow.crm.records.view.client'],
      routePath: '/crm/opportunities',
    },
    clientArea: {
      module: 'leadflow_crm',
      key: 'leadflow.crm.records.view.client',
      routePath: '/crm/opportunities',
    },
  }),
  contacts: (company: boolean): OrionToolRequirement => ({
    agency: {
      anyOf: ['shared.contacts.view.client', 'shared.contacts.view.all'],
      routePath: company
        ? '/agency/contacts/leadflow/company-contacts'
        : '/agency/contacts',
    },
    clientArea: {
      module: 'leadflow_crm',
      key: 'shared.contacts.view.client',
      routePath: '/agency/contacts/leadflow/company-contacts',
    },
  }),
};

/**
 * OR5 — the Orion's only write: a proposal (D-OR-7). The model names things
 * ("a Ana", "o lead da Maria", "etapa Proposta"); this service resolves the
 * names to records **under the caller's scope** (each read with its explicit
 * permission check), builds the payload and hands it to
 * `LeadFlowOperationsActionService.propose`, which checks the caller's write
 * permission for the route the confirmation will run. Nothing executes here:
 * the user confirms the card. The Orion proposes with no `agentId`, so its
 * limit is the user's permission (OR5 item 4).
 *
 * What goes back to the model is the card text, never record IDs.
 */
@Injectable()
export class OrionProposalService {
  constructor(
    private readonly actions: LeadFlowOperationsActionService,
    private readonly agents: LeadFlowAgentService,
    private readonly crm: CrmService,
    private readonly contacts: AgencyContactsService,
    private readonly access: OrionToolAccessService,
    private readonly config: OrionConfigService,
  ) {}

  async propose(
    intent: OrionProposalIntent,
    args: Args,
    run: OrionProposalRun,
  ): Promise<OrionProposalOutcome> {
    const built = await this.payloadFor(intent, args, run);
    if ('error' in built)
      return {
        payload: { error: built.error, candidates: built.candidates ?? [] },
      };
    let created: LeadFlowOperationsActionResponse;
    try {
      created = await this.actions.propose(
        run.ctx,
        {
          intent,
          requestText: run.requestText.slice(0, 4000),
          payload: { ...built.ok, timezone: this.config.timeZone },
          idempotencyKey: run.idempotencyKey,
        },
        run.access,
      );
    } catch (error) {
      // The user may not do this (or the record left the scope): say so,
      // without the message (it may carry data).
      if (error instanceof ForbiddenException)
        return { payload: { error: 'permission_denied' } };
      if (error instanceof NotFoundException)
        return { payload: { error: 'not_found' } };
      if (error instanceof BadRequestException)
        return { payload: { error: 'invalid_request' } };
      throw error;
    }
    const proposal = toOrionProposal(created);
    return {
      proposal,
      payload: {
        proposal: {
          title: proposal.title,
          summary: proposal.summary,
          canConfirm: proposal.canConfirm,
          pendingIssues: proposal.validationIssues,
          next: 'O usuário precisa confirmar no cartão; nada foi alterado ainda.',
        },
      },
    };
  }

  private async payloadFor(
    intent: OrionProposalIntent,
    args: Args,
    run: OrionProposalRun,
  ): Promise<Resolved<Args>> {
    switch (intent) {
      case 'pause_agent':
      case 'activate_agent': {
        const agent = await this.resolveAgent(readString(args.agent), run);
        if ('error' in agent) return agent;
        return {
          ok: {
            targetAgentId: agent.ok.id,
            targetAgentName: agent.ok.name,
            ...(intent === 'pause_agent'
              ? { effectivePeriod: { endsAt: readString(args.until) } }
              : {}),
          },
        };
      }
      case 'create_contact':
        return {
          ok: {
            displayName: readString(args.name),
            email: readString(args.email),
            phone: readString(args.phone),
          },
        };
      case 'update_contact_fields': {
        const contact = await this.resolveContact(
          readString(args.contact),
          run,
        );
        if ('error' in contact) return contact;
        return {
          ok: {
            contactId: contact.ok.id,
            contactName: contact.ok.name,
            fields: contactFields(args.fields),
          },
        };
      }
      case 'move_opportunity':
        return this.resolveMove(
          readString(args.opportunity),
          readString(args.stage),
          run,
        );
      case 'create_appointment': {
        const contactName = readString(args.contact);
        const contact = contactName
          ? await this.resolveContact(contactName, run)
          : null;
        if (contact && 'error' in contact) return contact;
        return {
          ok: {
            title: readString(args.title),
            type: readString(args.type) ?? 'meeting',
            startAt: readString(args.startAt),
            endAt: readString(args.endAt),
            contactId: contact?.ok.id ?? null,
            contactName: contact?.ok.name ?? null,
          },
        };
      }
    }
  }

  private async resolveAgent(
    name: string | null,
    run: OrionProposalRun,
  ): Promise<Resolved<{ id: string; name: string }>> {
    if (!name) return { error: 'agent_name_required' };
    if (!(await this.access.allowed(run.access, READS.agents())))
      return { error: 'permission_denied' };
    const listed = await this.agents.list(run.ctx);
    return pick(
      listed.items
        .filter((agent) => !agent.archivedAt && !agent.deletedAt)
        .map((agent) => ({ id: agent.id, name: agent.name })),
      name,
      'agent',
    );
  }

  private async resolveContact(
    name: string | null,
    run: OrionProposalRun,
  ): Promise<Resolved<{ id: string; name: string }>> {
    if (!name) return { error: 'contact_name_required' };
    const company = resolveCompanyAwareScope(run.ctx).companyContextId !== null;
    if (!(await this.access.allowed(run.access, READS.contacts(company))))
      return { error: 'permission_denied' };
    const found = (await this.contacts.listContacts(run.ctx, {
      q: name,
      limit: '6',
    })) as { items?: Array<{ id: string; displayName?: string | null }> };
    return pick(
      (found.items ?? []).map((item) => ({
        id: item.id,
        name: item.displayName ?? '',
      })),
      name,
      'contact',
    );
  }

  private async resolveMove(
    title: string | null,
    stageName: string | null,
    run: OrionProposalRun,
  ): Promise<Resolved<Args>> {
    if (!title) return { error: 'opportunity_required' };
    if (!stageName) return { error: 'stage_required' };
    if (!(await this.access.allowed(run.access, READS.opportunities())))
      return { error: 'permission_denied' };
    const open = await this.crm.listOpportunities(run.ctx, {
      status: 'open',
      search: title,
    });
    const opportunity = pick(
      open.slice(0, 20).map((row) => ({ id: row.id, name: row.title, row })),
      title,
      'opportunity',
    );
    if ('error' in opportunity) return opportunity;
    const stages = await this.crm.listStages(
      run.ctx,
      opportunity.ok.row.pipelineId,
    );
    const stage = pick(
      stages.map((row) => ({ id: row.id, name: row.name })),
      stageName,
      'stage',
    );
    if ('error' in stage) return stage;
    return {
      ok: {
        opportunityId: opportunity.ok.id,
        opportunityTitle: opportunity.ok.name,
        pipelineId: opportunity.ok.row.pipelineId,
        stageId: stage.ok.id,
        stageName: stage.ok.name,
      },
    };
  }
}

/** Exact (accent/case-insensitive) match first, then a unique partial one. */
function pick<T extends { id: string; name: string }>(
  rows: T[],
  query: string,
  kind: string,
): Resolved<T> {
  const wanted = normalizeName(query);
  const exact = rows.filter((row) => normalizeName(row.name) === wanted);
  const partial = exact.length
    ? exact
    : rows.filter((row) => normalizeName(row.name).includes(wanted));
  if (partial.length === 1) return { ok: partial[0] };
  if (!partial.length) return { error: `${kind}_not_found` };
  return {
    error: `${kind}_ambiguous`,
    candidates: partial.slice(0, 5).map((row) => row.name.slice(0, 80)),
  };
}

function normalizeName(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function toOrionProposal(
  action: LeadFlowOperationsActionResponse,
): OrionProposal {
  return {
    id: action.id,
    intent: action.intent,
    status: action.status,
    revision: action.revision,
    canConfirm: action.canConfirm,
    validationIssues: action.validationIssues,
    title: readString(action.preview.title) ?? 'Alteração',
    summary: readString(action.preview.summary) ?? '',
    effectiveFrom: action.effectiveFrom,
    effectiveUntil: action.effectiveUntil,
    timezone: action.timezone,
  };
}
