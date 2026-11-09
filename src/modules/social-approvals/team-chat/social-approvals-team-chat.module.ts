import { Module, type OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../../permissions';
import { AgencyChatMessage } from '../../team-chat/entities';
import { TeamChatCardResolverRegistry } from '../../team-chat/services/team-chat-card-resolver.port';
import { TeamChatModule } from '../../team-chat/team-chat.module';
import { SocialApprovalsModule } from '../social-approvals.module';
import { TeamChatApprovalCardRegistry } from '../team-chat-approval-card.port';
import { TeamChatApprovalCardsController } from './team-chat-approval-cards.controller';
import { TeamChatApprovalCardsService } from './team-chat-approval-cards.service';

/**
 * AR5 / D-30 — the join between Approvals and the Team Chat. Each domain
 * declares a registry for what it needs and this module fills both, so neither
 * imports the other.
 */
@Module({
  imports: [
    SocialApprovalsModule,
    TeamChatModule,
    PermissionsModule,
    TypeOrmModule.forFeature([AgencyChatMessage], 'agency'),
  ],
  controllers: [TeamChatApprovalCardsController],
  providers: [TeamChatApprovalCardsService],
})
export class SocialApprovalsTeamChatModule implements OnModuleInit {
  constructor(
    private readonly cards: TeamChatApprovalCardsService,
    private readonly publisherRegistry: TeamChatApprovalCardRegistry,
    private readonly resolverRegistry: TeamChatCardResolverRegistry,
  ) {}

  onModuleInit(): void {
    this.publisherRegistry.register(this.cards);
    this.resolverRegistry.register(this.cards);
  }
}
