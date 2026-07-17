import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { MetaGraphService } from '../../meta/services/meta-graph.service';

type WhatsAppConnectionState =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'needs_action';

@Injectable()
export class WhatsAppChannelHealthService {
  constructor(
    @InjectRepository(InboxChannelEntity, 'agency')
    private readonly channelsRepository: Repository<InboxChannelEntity>,
    private readonly cryptoService: SettingsCryptoService,
    private readonly metaGraphService: MetaGraphService,
  ) {}

  async listStatus(input: { tenantId: string; workspaceId: string }) {
    const channels = await this.channelsRepository.find({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        type: 'whatsapp',
        provider: 'meta',
        deletedAt: IsNull(),
      },
      order: {
        createdAt: 'DESC',
      },
    });

    if (!channels.length) {
      return {
        state: 'not_connected' as WhatsAppConnectionState,
        primaryChannel: null,
        channels: [],
      };
    }

    const mapped = channels.map((channel) => this.mapChannelStatus(channel));
    const primaryChannel = this.resolvePrimaryChannel(mapped);

    return {
      state: this.resolveWorkspaceState(mapped.map((item) => item.state)),
      primaryChannel,
      channels: mapped,
    };
  }

  async getHealth(input: {
    tenantId: string;
    workspaceId: string;
    channelId: string;
  }) {
    const channel = await this.findChannel(input);

    return this.mapChannelStatus(channel);
  }

  async runHealthCheck(input: {
    tenantId: string;
    workspaceId: string;
    channelId: string;
  }) {
    const channel = await this.findChannel(input);

    const missing: string[] = [];

    if (!channel.externalPhoneNumberId) missing.push('externalPhoneNumberId');
    if (!channel.accessTokenEncrypted) missing.push('accessTokenEncrypted');

    const warnings: string[] = [];

    if (!channel.externalAccountId) {
      warnings.push('externalAccountId_missing');
    }

    if (missing.length) {
      channel.status = 'draft';
      channel.settings = {
        ...(channel.settings ?? {}),
        connectionHealth: 'needs_action',
        lastHealthCheckStatus: 'needs_action',
        lastHealthCheckAt: new Date().toISOString(),
        missingRequirements: missing,
        setupStep:
          typeof channel.settings?.setupStep === 'string'
            ? channel.settings.setupStep
            : 'missing_requirements',
      };

      await this.channelsRepository.save(channel);

      return this.mapChannelStatus(channel);
    }

    const accessToken = this.cryptoService.decrypt(
      channel.accessTokenEncrypted,
    );

    if (!accessToken) {
      throw new BadRequestException(
        'WhatsApp access token could not be decrypted.',
      );
    }

    try {
      const phone = await this.metaGraphService.getWhatsAppPhoneNumber({
        phoneNumberId: channel.externalPhoneNumberId!,
        accessToken,
      });

      channel.status = 'active';
      channel.name = phone.display_phone_number
        ? `WhatsApp ${phone.display_phone_number}`
        : channel.name;

      const previousSetupStep =
        typeof channel.settings?.setupStep === 'string'
          ? channel.settings.setupStep
          : null;

      const shouldNormalizeSetupStep =
        !previousSetupStep ||
        previousSetupStep === 'missing_requirements' ||
        previousSetupStep.includes('failed');

      channel.settings = {
        ...(channel.settings ?? {}),
        connectionMode:
          typeof channel.settings?.connectionMode === 'string'
            ? channel.settings.connectionMode
            : 'manual',
        connectionHealth: 'connected',
        lastHealthCheckStatus: 'ok',
        lastHealthCheckAt: new Date().toISOString(),
        healthWarnings: warnings,
        setupStep: shouldNormalizeSetupStep ? 'active' : previousSetupStep,
        tokenConfigured: true,
      };

      channel.metadata = {
        ...(channel.metadata ?? {}),
        displayPhoneNumber:
          phone.display_phone_number ??
          channel.metadata?.displayPhoneNumber ??
          null,
        verifiedName: phone.verified_name ?? null,
        qualityRating: phone.quality_rating ?? null,
        messagingLimitTier: phone.messaging_limit_tier ?? null,
        platformType: phone.platform_type ?? null,
        codeVerificationStatus: phone.code_verification_status ?? null,
        lastHealthCheckResponse: phone,
      };

      await this.channelsRepository.save(channel);

      return this.mapChannelStatus(channel);
    } catch (error) {
      channel.status = 'draft';
      channel.settings = {
        ...(channel.settings ?? {}),
        connectionHealth: 'failed',
        lastHealthCheckStatus: 'failed',
        lastHealthCheckAt: new Date().toISOString(),
        lastHealthCheckError:
          error instanceof Error ? error.message : 'Unknown health check error',
      };

      await this.channelsRepository.save(channel);

      throw error;
    }
  }

  private async findChannel(input: {
    tenantId: string;
    workspaceId: string;
    channelId: string;
  }) {
    const channel = await this.channelsRepository.findOne({
      where: {
        id: input.channelId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        type: 'whatsapp',
        provider: 'meta',
        deletedAt: IsNull(),
      },
    });

    if (!channel) {
      throw new NotFoundException('WhatsApp channel not found.');
    }

    return channel;
  }

  private mapChannelStatus(channel: InboxChannelEntity) {
    const setupStep =
      typeof channel.settings?.setupStep === 'string'
        ? channel.settings.setupStep
        : null;

    const connectionHealth =
      typeof channel.settings?.connectionHealth === 'string'
        ? channel.settings.connectionHealth
        : null;

    const state = this.resolveChannelState(
      channel,
      setupStep,
      connectionHealth,
    );

    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      provider: channel.provider,
      status: channel.status,
      state,
      setupStep,
      connectionHealth,
      externalAccountId: channel.externalAccountId,
      externalPhoneNumberId: channel.externalPhoneNumberId,
      displayPhoneNumber:
        typeof channel.metadata?.displayPhoneNumber === 'string'
          ? channel.metadata.displayPhoneNumber
          : null,
      hasToken: Boolean(channel.accessTokenEncrypted),
      webhookSubscribed: Boolean(channel.settings?.webhookSubscribed),
      phoneRegistered: Boolean(channel.settings?.phoneRegistered),
      tokenConfigured: Boolean(channel.settings?.tokenConfigured),
      lastHealthCheckAt:
        typeof channel.settings?.lastHealthCheckAt === 'string'
          ? channel.settings.lastHealthCheckAt
          : null,
      lastHealthCheckStatus:
        typeof channel.settings?.lastHealthCheckStatus === 'string'
          ? channel.settings.lastHealthCheckStatus
          : null,
      qualityRating:
        typeof channel.metadata?.qualityRating === 'string'
          ? channel.metadata.qualityRating
          : null,
      messagingLimitTier:
        typeof channel.metadata?.messagingLimitTier === 'string'
          ? channel.metadata.messagingLimitTier
          : null,
      metadata: channel.metadata,
    };
  }

  private resolveChannelState(
    channel: InboxChannelEntity,
    setupStep: string | null,
    connectionHealth: string | null,
  ): WhatsAppConnectionState {
    if (connectionHealth === 'connected') return 'connected';
    if (connectionHealth === 'failed') return 'failed';
    if (connectionHealth === 'needs_action') return 'needs_action';

    if (channel.status === 'active' && channel.accessTokenEncrypted) {
      return 'connected';
    }

    if (channel.status === 'draft') {
      if (
        setupStep?.includes('failed') ||
        setupStep === 'token_exchange_failed' ||
        setupStep === 'embedded_signup_failed'
      ) {
        return 'failed';
      }

      if (setupStep) {
        return 'connecting';
      }

      return 'needs_action';
    }

    if (channel.status === 'inactive' || channel.status === 'archived') {
      return 'needs_action';
    }

    return 'not_connected';
  }

  private resolvePrimaryChannel(
    channels: Array<ReturnType<typeof this.mapChannelStatus>>,
  ) {
    if (!channels.length) return null;

    const score = (channel: ReturnType<typeof this.mapChannelStatus>) => {
      if (channel.state === 'connected') return 100;
      if (channel.status === 'active' && channel.hasToken) return 90;
      if (channel.state === 'connecting') return 70;
      if (channel.state === 'needs_action') return 50;
      if (channel.state === 'failed') return 30;
      return 10;
    };

    return [...channels].sort((a, b) => score(b) - score(a))[0] ?? null;
  }

  private resolveWorkspaceState(
    states: WhatsAppConnectionState[],
  ): WhatsAppConnectionState {
    if (states.includes('connected')) return 'connected';
    if (states.includes('connecting')) return 'connecting';
    if (states.includes('failed')) return 'failed';
    if (states.includes('needs_action')) return 'needs_action';

    return 'not_connected';
  }
}
