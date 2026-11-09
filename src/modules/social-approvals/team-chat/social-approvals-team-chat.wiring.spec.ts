import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlatformPermissionService } from '../../permissions';
import { AgencyChatMessage } from '../../team-chat/entities';
import { TeamChatCardPostService } from '../../team-chat/services/team-chat-card-post.service';
import { TeamChatCardResolverRegistry } from '../../team-chat/services/team-chat-card-resolver.port';
import { TeamChatChannelsService } from '../../team-chat/services/team-chat-channels.service';
import {
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStepEntity,
} from '../entities';
import { SocialApprovalAuthorityService } from '../social-approval-authority.service';
import { SocialApprovalSettingsService } from '../social-approval-settings.service';
import { SocialApprovalsService } from '../social-approvals.service';
import { TeamChatApprovalCardRegistry } from '../team-chat-approval-card.port';
import { SocialApprovalsTeamChatModule } from './social-approvals-team-chat.module';
import { TeamChatApprovalCardsService } from './team-chat-approval-cards.service';

// The module graph reaches the auth stack, whose `otplib` is ESM-only.
jest.mock('otplib', () => ({}));

/** D-30: an unfilled registry fails in silence, so the handoff is asserted. */
describe('SocialApprovalsTeamChatModule wiring', () => {
  it('starts empty, and fills both registries on init', async () => {
    const publisher = new TeamChatApprovalCardRegistry();
    const resolver = new TeamChatCardResolverRegistry();
    expect(publisher.get()).toBeNull();
    expect(resolver.get()).toBeNull();

    const repositories = [
      SocialApprovalRequestEntity,
      SocialApprovalStepEntity,
      SocialApprovalPieceEntity,
      AgencyChatMessage,
    ].map((entity) => ({
      provide: getRepositoryToken(entity, 'agency'),
      useValue: {},
    }));
    const collaborators = [
      TeamChatCardPostService,
      TeamChatChannelsService,
      SocialApprovalsService,
      SocialApprovalSettingsService,
      SocialApprovalAuthorityService,
      PlatformPermissionService,
    ].map((provide) => ({ provide, useValue: {} }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        TeamChatApprovalCardsService,
        ...repositories,
        ...collaborators,
      ],
    }).compile();

    const cards = moduleRef.get(TeamChatApprovalCardsService);
    new SocialApprovalsTeamChatModule(
      cards,
      publisher,
      resolver,
    ).onModuleInit();

    expect(publisher.get()).toBe(cards);
    expect(resolver.get()).toBe(cards);
  });
});
