import { ForbiddenException, Injectable } from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { TeamChatChannelKind } from '../../team-chat/enums';
import { TeamChatChannelsService } from '../../team-chat/services/team-chat-channels.service';
import {
  LeadFlowSummaryAgentResolver,
  type SummaryAgentIdentity,
} from './leadflow-summary-agent.resolver';

export interface LeadFlowTeamChatChannelOption {
  id: string;
  name: string;
  kind: string;
  visibility: string;
}

export interface LeadFlowTeamChatDeliveryOptions {
  channels: LeadFlowTeamChatChannelOption[];
  sender: { name: string; type: string | null } | null;
}

/**
 * What the Team Chat delivery section needs to render: the channels the
 * operator may publish into, and who the post will appear to come from.
 *
 * Both answers are the server's. The channel list is already scoped by the
 * chat's own visibility rules — an operator cannot route a digest into a room
 * they cannot see — and the sender is resolved the same way the executor will
 * resolve it at fire time, so the screen never promises a different name than
 * the one that shows up in the channel.
 */
@Injectable()
export class LeadFlowTeamChatDeliveryService {
  constructor(
    private readonly channels: TeamChatChannelsService,
    private readonly agents: LeadFlowSummaryAgentResolver,
  ) {}

  async getOptions(
    ctx: RequestContext,
  ): Promise<LeadFlowTeamChatDeliveryOptions> {
    // Publishing into the agency's Team Chat is an agency decision. A client
    // context has no room of its own to point at, and the schema does not even
    // declare the fields there.
    if (ctx.managedContext?.operatingMode === 'client') {
      throw new ForbiddenException(
        'A entrega no Team Chat é uma configuração da agência.',
      );
    }
    const workspaceId = ctx.workspaceId;
    if (!workspaceId) {
      throw new ForbiddenException('Workspace context is required.');
    }

    const channels = await this.channels.list(
      {
        tenantId: ctx.tenantId,
        workspaceId,
        userId: ctx.userId ?? null,
        role: ctx.role ?? null,
      },
      { kind: TeamChatChannelKind.CHANNEL },
    );

    const agent: SummaryAgentIdentity = await this.agents.resolve({
      tenantId: ctx.tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
    });

    return {
      channels: channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        kind: channel.kind,
        visibility: channel.visibility,
      })),
      sender: { name: agent.name, type: agent.type },
    };
  }
}
