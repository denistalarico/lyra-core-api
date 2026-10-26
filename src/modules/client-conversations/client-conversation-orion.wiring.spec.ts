import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClientAreaModule } from '../client-area/client-area.module';
import { ClientAreaManagementService } from '../client-area/services/client-area-management.service';
import { AgencyClient } from '../clients/entities/agency-client.entity';
import { OrionConfigService } from '../orion/orion-config.service';
import { OrionModule } from '../orion/orion.module';
import { OrionService } from '../orion/orion.service';
import { PermissionsModule } from '../permissions';
import { PlatformPermissionService } from '../permissions/services/platform-permission.service';
import {
  ClientConversationAssistantRegistry,
  type ClientConversationMention,
} from './client-conversation-assistant.port';
import { ClientConversationOrionModule } from './client-conversation-orion.module';
import { ClientConversationsModule } from './client-conversations.module';
import { AgencyClientConversationsGateway } from './gateways/agency-client-conversations.gateway';
import { ClientConversationsGateway } from './gateways/client-conversations.gateway';
import { AgencyClientConversationAccessService } from './services/agency-client-conversation-access.service';
import { ClientConversationOrionMentionService } from './services/client-conversation-orion-mention.service';
import { ClientConversationsService } from './services/client-conversations.service';

jest.mock('otplib', () => ({ verify: jest.fn() }));

const fixture = (...tokens: unknown[]) => {
  @Module({
    providers: tokens.map((provide) => ({
      provide: provide as never,
      useValue: {},
    })),
    exports: tokens as never[],
  })
  class Fixture {}
  return Fixture;
};

/**
 * OR7 — the production join module resolves the mention service from the
 * exports of the modules it imports, and fills the registry on init. The
 * sides are fixtures exporting the exact tokens the service consumes, so a
 * missing export fails here instead of at the API boot.
 */
describe('ClientConversationOrionModule wiring', () => {
  it('resolves the mention service and fills the assistant registry', async () => {
    const registry = new ClientConversationAssistantRegistry();
    @Module({
      providers: [
        { provide: ClientConversationAssistantRegistry, useValue: registry },
        ...[
          ClientConversationsService,
          AgencyClientConversationAccessService,
          ClientConversationsGateway,
          AgencyClientConversationsGateway,
        ].map((provide) => ({ provide, useValue: {} })),
      ],
      exports: [
        ClientConversationAssistantRegistry,
        ClientConversationsService,
        AgencyClientConversationAccessService,
        ClientConversationsGateway,
        AgencyClientConversationsGateway,
      ],
    })
    class ConversationsFixture {}

    const mod = await Test.createTestingModule({
      imports: [ClientConversationOrionModule],
    })
      .overrideModule(ClientConversationsModule)
      .useModule(ConversationsFixture)
      .overrideModule(OrionModule)
      .useModule(fixture(OrionService, OrionConfigService))
      .overrideModule(ClientAreaModule)
      .useModule(fixture(ClientAreaManagementService))
      .overrideModule(PermissionsModule)
      .useModule(fixture(PlatformPermissionService))
      .overrideProvider(getRepositoryToken(AgencyClient, 'agency'))
      .useValue({})
      .compile();
    try {
      const mentions = mod.get(ClientConversationOrionMentionService);
      const schedule = jest
        .spyOn(mentions, 'schedule')
        .mockImplementation(() => undefined);
      await mod.init();
      const mention = { message: { id: 'm' } } as ClientConversationMention;
      registry.schedule(mention);
      expect(schedule).toHaveBeenCalledWith(mention);
    } finally {
      await mod.close();
    }
  });
});
