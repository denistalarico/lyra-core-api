import {
  BadRequestException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ClientAreaSettingsRegistry,
  type ClientAreaOAuthBinding,
} from '../../common/client-area-bridge/client-area-settings.registry';
import type { RequestContext } from '../../common/context/request-context.interface';
import { toCompanyAwareScope } from '../client-area/client-area-scope';
import type { ClientAreaContext } from '../client-area/client-area.types';
import type {
  ClientAreaCompleteWhatsAppDto,
  ClientAreaIntegrationProvider,
} from '../client-area/controllers/client-area-product-settings.controller';
import { PlatformBusinessProfileService } from '../platform-settings/services/platform-business-profile.service';
import type { UpdateBusinessProfileDto } from '../platform-settings/dto/update-business-profile.dto';
import type { PublishCompanyContextDto } from '../leadflow-settings/dto/publish-company-context.dto';
import { LeadFlowBusinessModeTemplateService } from '../leadflow-settings/services/leadflow-business-mode-template.service';
import { mapBusinessModeSummaryResponse } from '../platform-settings/dto/business-mode-summary.view';
import { MetaAdsOAuthService } from '../social-integrations/services/meta-ads-oauth.service';
import { SocialAdConnectionService } from '../social-integrations/services/social-ad-connection.service';
import { SocialOrganicOAuthService } from '../social-organic/connections/social-organic-oauth.service';
import { SocialOrganicConnectionService } from '../social-organic/connections/social-organic-connection.service';
import { CONNECTION_MODES } from '../social-organic/connections/social-organic.controller';
import { FacebookInstagramOAuthService } from '../inbox/channels/instagram/oauth/facebook/facebook-instagram-oauth.service';
import { FacebookMessengerOAuthService } from '../inbox/channels/facebook-messenger/oauth/facebook/facebook-messenger-oauth.service';
import { WhatsAppEmbeddedSignupService } from '../inbox/channels/whatsapp/embedded-signup/whatsapp-embedded-signup.service';
import { InboxService } from '../inbox/inbox.service';
import { InboxChannelLifecycleService } from '../inbox/services/inbox-channel-lifecycle.service';

type IntegrationInput = {
  provider: ClientAreaIntegrationProvider;
  connectionId: string;
  sessionId: string;
  externalIds: string[];
  acceptedRules?: boolean;
  key?: string;
};

/** Composition adapter: every product mutation remains in its canonical service. */
@Injectable()
export class ClientAreaProductSettingsService implements OnModuleInit {
  constructor(
    private readonly registry: ClientAreaSettingsRegistry,
    private readonly business: PlatformBusinessProfileService,
    private readonly modes: LeadFlowBusinessModeTemplateService,
    private readonly adsOAuth: MetaAdsOAuthService,
    private readonly ads: SocialAdConnectionService,
    private readonly organicOAuth: SocialOrganicOAuthService,
    private readonly organic: SocialOrganicConnectionService,
    private readonly instagram: FacebookInstagramOAuthService,
    private readonly messenger: FacebookMessengerOAuthService,
    private readonly whatsapp: WhatsAppEmbeddedSignupService,
    private readonly inbox: InboxService,
    private readonly lifecycle: InboxChannelLifecycleService,
  ) {}

  onModuleInit() {
    this.registry.register('business.get', async (ctx) =>
      this.projectBusiness(
        await this.business.getBusinessProfile(
          this.requestContext(ctx),
          ctx.agencyClientId,
        ),
      ),
    );
    this.registry.register('business.update', async (ctx, dto) =>
      this.projectBusiness(
        await this.business.updateBusinessProfile(
          this.requestContext(ctx),
          ctx.agencyClientId,
          dto as UpdateBusinessProfileDto,
        ),
      ),
    );
    this.registry.register('business.publish', async (ctx, dto) =>
      this.projectBusiness(
        await this.business.publishCompanyContext(
          this.requestContext(ctx),
          ctx.agencyClientId,
          (dto as PublishCompanyContextDto).expectedDraftHash,
        ),
      ),
    );
    this.registry.register('business.modes', async (ctx) => ({
      items: (await this.modes.listTemplates(this.requestContext(ctx))).map(
        mapBusinessModeSummaryResponse,
      ),
    }));
    this.registry.register('integrations.list', (ctx, input) =>
      this.list(ctx, input as IntegrationInput),
    );
    this.registry.register('integrations.connect', (ctx, input) =>
      this.connect(ctx, input as IntegrationInput),
    );
    this.registry.register('integrations.select', (ctx, input) =>
      this.select(ctx, input as IntegrationInput),
    );
    this.registry.register('integrations.session', (ctx, input) =>
      this.session(ctx, input as IntegrationInput),
    );
    this.registry.register('integrations.disconnect', (ctx, input) =>
      this.disconnect(ctx, input as IntegrationInput),
    );
    this.registry.register(
      'integrations.whatsapp.complete',
      async (ctx, input) => {
        const result = await this.whatsapp.complete({
          ...(input as ClientAreaCompleteWhatsAppDto),
          ...toCompanyAwareScope(ctx),
          scopeKind: 'company',
          clientAreaSessionId: ctx.sessionId,
        });
        return { success: true, channelId: result.channelId };
      },
    );
  }

  private requestContext(ctx: ClientAreaContext): RequestContext {
    const scope = toCompanyAwareScope(ctx);
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      role: 'client_area_actor',
      managedContext: {
        operatingMode: 'client',
        productKey:
          ctx.modules.leadflow_inbox || ctx.modules.leadflow_agents
            ? 'leadflow'
            : 'social',
        clientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        managedTenantId: null,
      },
    };
  }
  private projectBusiness(
    value: Awaited<
      ReturnType<PlatformBusinessProfileService['getBusinessProfile']>
    >,
  ) {
    return {
      businessModeKey: value.businessModeKey,
      companyContextDraft: value.companyContextDraft,
      companyContextPublished: value.companyContextPublished,
      companyContextSchemaVersion: value.companyContextSchemaVersion,
      companyContextDraftHash: value.companyContextDraftHash,
      companyContextPublishedVersion: value.companyContextPublishedVersion,
      companyContextPublishedHash: value.companyContextPublishedHash,
      companyContextPublishedAt: value.companyContextPublishedAt,
    };
  }
  private binding(
    ctx: ClientAreaContext,
    provider: ClientAreaIntegrationProvider,
  ): ClientAreaOAuthBinding {
    return {
      ...toCompanyAwareScope(ctx),
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      companyContextId: ctx.companyContextId,
      module: provider.startsWith('inbox_')
        ? 'leadflow_inbox'
        : provider === 'meta_ads'
          ? 'social_campaigns'
          : 'social_planner',
    };
  }
  private inboxInput(ctx: ClientAreaContext) {
    return {
      ...toCompanyAwareScope(ctx),
      scopeKind: 'company' as const,
      userId: ctx.userId,
    };
  }
  private organicMode(provider: ClientAreaIntegrationProvider) {
    if (
      provider === 'facebook' ||
      provider === 'instagram_facebook' ||
      provider === 'instagram_direct'
    )
      return { ...CONNECTION_MODES[provider], connectionMode: provider };
    throw new NotFoundException('Integration is unavailable.');
  }

  async connect(ctx: ClientAreaContext, input: IntegrationInput) {
    const scope = toCompanyAwareScope(ctx),
      clientAreaBinding = this.binding(ctx, input.provider);
    if (input.provider === 'meta_ads')
      return this.adsOAuth.start({
        ...scope,
        userId: ctx.userId,
        clientAreaBinding,
      });
    if (
      input.provider === 'inbox_instagram' ||
      input.provider === 'inbox_messenger'
    )
      return (
        input.provider === 'inbox_instagram' ? this.instagram : this.messenger
      ).start({ ...this.inboxInput(ctx), metadata: { clientAreaBinding } });
    if (input.provider === 'inbox_whatsapp')
      return this.whatsapp.start({
        ...this.inboxInput(ctx),
        acceptedRules: input.acceptedRules,
        metadata: { clientAreaBinding },
      });
    return this.organicOAuth.start({
      ...scope,
      userId: ctx.userId,
      ...this.organicMode(input.provider),
      clientAreaBinding,
    });
  }
  async list(ctx: ClientAreaContext, input: IntegrationInput) {
    const scope = toCompanyAwareScope(ctx);
    if (input.provider === 'meta_ads')
      return {
        items: (
          await this.ads.list({ ...scope, clientAreaSessionId: ctx.sessionId })
        ).map((row) => ({
          id: row.id,
          provider: row.provider,
          state: row.state,
          status: row.status,
          maskedAccountId: row.maskedAccountId,
          accountName: row.accountName,
          currency: row.currency,
          timezone: row.timezone,
          tokenExpiresAt: row.tokenExpiresAt,
          hasCredential: row.hasCredential,
          availableAccounts: row.availableAccounts?.map((account) => ({
            externalAccountId: account.externalAccountId,
            accountName: account.accountName,
            currency: account.currency,
            timezone: account.timezone,
          })),
        })),
      };
    if (input.provider.startsWith('inbox_')) {
      const type =
        input.provider === 'inbox_instagram'
          ? 'instagram'
          : input.provider === 'inbox_messenger'
            ? 'facebook_messenger'
            : 'whatsapp';
      const rows = await this.inbox.listChannels(this.requestContext(ctx));
      return {
        items: rows
          .filter((row) => row.type === type)
          .map((row) => ({
            id: row.id,
            name: row.name,
            type: row.type,
            status: row.status,
            connectionStatus: row.connectionStatus,
            hasCredential: row.hasAccessToken,
          })),
      };
    }
    const mode = this.organicMode(input.provider);
    return {
      items: (
        await this.organic.list({
          ...scope,
          clientAreaSessionId: ctx.sessionId,
        })
      )
        .filter((row) => row.connectionMode === mode.connectionMode)
        .map((row) => ({
          id: row.id,
          provider: row.provider,
          connectionMode: row.connectionMode,
          state: row.state,
          status: row.status,
          hasCredential: row.hasCredential,
          tokenExpiresAt: row.tokenExpiresAt,
          assets: row.assets.map((asset) => ({
            id: asset.id,
            assetType: asset.assetType,
            displayName: asset.displayName,
            username: asset.username,
            avatarUrl: asset.avatarUrl,
            status: asset.status,
          })),
          availableAssets: row.availableAssets?.map((asset) => ({
            externalAssetId: asset.externalAssetId,
            assetType: asset.assetType,
            displayName: asset.displayName,
            username: asset.username,
          })),
        })),
    };
  }
  async select(ctx: ClientAreaContext, input: IntegrationInput) {
    const scope = toCompanyAwareScope(ctx);
    if (input.provider === 'meta_ads') {
      if (input.externalIds.length !== 1)
        throw new BadRequestException('Select one account.');
      await this.adsOAuth.select({
        ...scope,
        userId: ctx.userId,
        clientAreaSessionId: ctx.sessionId,
        connectionId: input.connectionId,
        externalAccountId: input.externalIds[0],
      });
    } else if (
      input.provider === 'inbox_instagram' ||
      input.provider === 'inbox_messenger'
    ) {
      if (input.externalIds.length !== 1)
        throw new BadRequestException('Select one page.');
      await (
        input.provider === 'inbox_instagram' ? this.instagram : this.messenger
      ).select({
        ...this.inboxInput(ctx),
        sessionId: input.connectionId,
        clientAreaSessionId: ctx.sessionId,
        pageId: input.externalIds[0],
      });
    } else {
      await this.organicOAuth.select({
        ...scope,
        userId: ctx.userId,
        provider: this.organicMode(input.provider).provider,
        clientAreaSessionId: ctx.sessionId,
        connectionId: input.connectionId,
        externalAssetIds: input.externalIds,
      });
    }
    return this.list(ctx, input);
  }
  async session(ctx: ClientAreaContext, input: IntegrationInput) {
    if (input.provider === 'inbox_whatsapp') {
      const value = await this.whatsapp.getStatus({
        ...this.inboxInput(ctx),
        sessionId: input.sessionId,
      });
      return {
        sessionId: value.sessionId,
        status: value.status,
        channelId: value.channelId,
        expiresAt: value.expiresAt,
      };
    }
    if (
      input.provider !== 'inbox_instagram' &&
      input.provider !== 'inbox_messenger'
    )
      throw new NotFoundException('Session is unavailable.');
    const value = await (
      input.provider === 'inbox_instagram' ? this.instagram : this.messenger
    ).getSessionAssets({
      ...this.inboxInput(ctx),
      sessionId: input.sessionId,
      clientAreaSessionId: ctx.sessionId,
    });
    const assets: unknown = value.assets;
    if (!Array.isArray(assets))
      throw new BadRequestException('Invalid channel assets payload.');
    return {
      sessionId: value.sessionId,
      assets: assets.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object')
          throw new BadRequestException('Invalid channel asset.');
        const asset = entry as Record<string, unknown>;
        if (
          typeof asset.pageId !== 'string' ||
          (asset.pageName !== null && typeof asset.pageName !== 'string')
        )
          throw new BadRequestException('Invalid channel asset.');
        return { pageId: asset.pageId, pageName: asset.pageName };
      }),
    };
  }
  async disconnect(ctx: ClientAreaContext, input: IntegrationInput) {
    const scope = toCompanyAwareScope(ctx);
    if (input.provider === 'meta_ads')
      await this.ads.disconnect({ ...scope, connectionId: input.connectionId });
    else if (input.provider.startsWith('inbox_')) {
      const channel = await this.inbox.assertChannelInContext(
        this.requestContext(ctx),
        input.connectionId,
      );
      const type =
        input.provider === 'inbox_instagram'
          ? 'instagram'
          : input.provider === 'inbox_messenger'
            ? 'facebook_messenger'
            : 'whatsapp';
      if (channel.type !== type)
        throw new NotFoundException('Channel is unavailable.');
      await this.lifecycle.execute(
        this.requestContext(ctx),
        input.connectionId,
        'disconnect',
        input.key,
        'Requested by the Client Area Owner.',
      );
    } else
      await this.organic.disconnect({
        ...scope,
        connectionId: input.connectionId,
      });
    return this.list(ctx, input);
  }
}
