import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClientAreaSettingsRegistry } from '../../common/client-area-bridge/client-area-settings.registry';
import type { ClientAreaContext } from '../client-area/client-area.types';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { PlatformBusinessProfileService } from '../platform-settings/services/platform-business-profile.service';
import { LeadFlowSettingsModule } from '../leadflow-settings/leadflow-settings.module';
import { LeadFlowBusinessModeTemplateService } from '../leadflow-settings/services/leadflow-business-mode-template.service';
import { SocialIntegrationsModule } from '../social-integrations/social-integrations.module';
import { MetaAdsOAuthService } from '../social-integrations/services/meta-ads-oauth.service';
import { SocialAdConnectionService } from '../social-integrations/services/social-ad-connection.service';
import { SocialOrganicModule } from '../social-organic/social-organic.module';
import { SocialOrganicOAuthService } from '../social-organic/connections/social-organic-oauth.service';
import { SocialOrganicConnectionService } from '../social-organic/connections/social-organic-connection.service';
import { InboxModule } from '../inbox/inbox.module';
import { FacebookInstagramOAuthService } from '../inbox/channels/instagram/oauth/facebook/facebook-instagram-oauth.service';
import { FacebookMessengerOAuthService } from '../inbox/channels/facebook-messenger/oauth/facebook/facebook-messenger-oauth.service';
import { WhatsAppEmbeddedSignupService } from '../inbox/channels/whatsapp/embedded-signup/whatsapp-embedded-signup.service';
import { InboxService } from '../inbox/inbox.service';
import { InboxChannelLifecycleService } from '../inbox/services/inbox-channel-lifecycle.service';
import { ClientAreaProductSettingsModule } from './client-area-product-settings.module';

jest.mock('otplib', () => ({ verify: jest.fn() }));
const business = {
  getBusinessProfile: jest.fn().mockResolvedValue({
    businessModeKey: 'business',
    companyContextDraft: {},
    companyContextPublished: {},
    secret: 'must-not-escape',
  }),
  updateBusinessProfile: jest.fn().mockResolvedValue({
    businessModeKey: 'updated',
    companyContextDraft: {},
    companyContextPublished: {},
    developerOverrides: { secret: 'must-not-escape' },
  }),
};
const ads = {
  list: jest.fn().mockResolvedValue([
    {
      id: 'connection',
      provider: 'meta_ads',
      state: 'connected',
      accessTokenEncrypted: 'must-not-escape',
      metadata: { clientAreaBinding: { sessionId: 'internal' } },
      availableAccounts: [
        { externalAccountId: 'account', accessToken: 'must-not-escape' },
      ],
    },
  ]),
};
const adsOAuth = {
  start: jest
    .fn()
    .mockResolvedValue({ authorizationUrl: 'https://provider.example.test' }),
};
const whatsapp = {
  complete: jest
    .fn()
    .mockResolvedValue({ channelId: 'channel', secret: 'must-not-escape' }),
};
const tokens = [
  PlatformBusinessProfileService,
  LeadFlowBusinessModeTemplateService,
  MetaAdsOAuthService,
  SocialAdConnectionService,
  SocialOrganicOAuthService,
  SocialOrganicConnectionService,
  FacebookInstagramOAuthService,
  FacebookMessengerOAuthService,
  WhatsAppEmbeddedSignupService,
  InboxService,
  InboxChannelLifecycleService,
];
const values = [business, {}, adsOAuth, ads, {}, {}, {}, {}, whatsapp, {}, {}];
@Module({
  providers: tokens.map((provide, index) => ({
    provide,
    useValue: values[index],
  })),
  exports: tokens,
})
class StubProductDomains {}

describe('CA14 product settings real module/registry wiring', () => {
  it('registers the production adapter at init, derives scope and projects facade fields', async () => {
    const builder = Test.createTestingModule({
      imports: [ClientAreaProductSettingsModule],
    });
    for (const module of [
      PlatformSettingsModule,
      LeadFlowSettingsModule,
      SocialIntegrationsModule,
      SocialOrganicModule,
      InboxModule,
    ])
      builder.overrideModule(module).useModule(StubProductDomains);
    const ref = await builder.compile();
    await ref.init();
    const registry = ref.get(ClientAreaSettingsRegistry);
    const context = {
      tenantId: 'tenant',
      workspaceId: 'workspace',
      agencyClientId: 'client',
      companyContextId: 'company',
      userId: 'user',
      sessionId: 'session',
      modules: { leadflow_inbox: true },
    } as ClientAreaContext;
    expect(await registry.call('business.get', context)).toEqual(
      expect.objectContaining({ businessModeKey: 'business' }),
    );
    const updated = await registry.call('business.update', context, {
      businessModeKey: 'updated',
    });
    expect(JSON.stringify(updated)).not.toContain('must-not-escape');
    expect(business.updateBusinessProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant',
        workspaceId: 'workspace',
        userId: 'user',
        managedContext: {
          clientId: 'client',
          companyContextId: 'company',
          operatingMode: 'client',
          productKey: 'leadflow',
          managedTenantId: null,
        },
      }),
      'client',
      { businessModeKey: 'updated' },
    );
    const listed = await registry.call('integrations.list', context, {
      provider: 'meta_ads',
    });
    expect(JSON.stringify(listed)).not.toMatch(
      /must-not-escape|clientAreaBinding|metadata/,
    );
    await registry.call('integrations.connect', context, {
      provider: 'meta_ads',
      companyContextId: 'forged',
    });
    expect(adsOAuth.start).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant',
        workspaceId: 'workspace',
        agencyClientId: 'client',
        companyContextId: 'company',
        clientAreaBinding: {
          tenantId: 'tenant',
          workspaceId: 'workspace',
          agencyClientId: 'client',
          userId: 'user',
          sessionId: 'session',
          companyContextId: 'company',
          module: 'social_campaigns',
        },
      }),
    );
    expect(
      await registry.call('integrations.whatsapp.complete', context, {
        sessionId: 'oauth-session',
        state: 'state',
        code: 'code',
        companyContextId: 'forged',
      }),
    ).toEqual({ success: true, channelId: 'channel' });
    expect(whatsapp.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        companyContextId: 'company',
        scopeKind: 'company',
      }),
    );
    await ref.close();
  });
  it('fails closed when no product adapter or OAuth validator was registered', async () => {
    const registry = new ClientAreaSettingsRegistry();
    expect(() =>
      registry.call('business.get', {} as ClientAreaContext),
    ).toThrow('Product settings are unavailable');
    await expect(
      registry.assertOAuthBinding(
        { tenantId: 't', companyContextId: 'c' },
        { tenantId: 't', companyContextId: 'c' },
      ),
    ).rejects.toThrow();
  });
});
