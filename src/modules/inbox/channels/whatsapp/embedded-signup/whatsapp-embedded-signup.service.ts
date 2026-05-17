import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { InboxChannelConnectionSessionEntity } from '../../../entities/inbox-channel-connection-session.entity';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { MetaGraphService } from '../../meta/services/meta-graph.service';

type StartInput = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
  acceptedRules?: boolean;
};

type CompleteInput = {
  sessionId: string;
  state: string;
  code: string;
  businessId?: string;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  phoneRegistrationPin?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class WhatsAppEmbeddedSignupService {
  constructor(
    @InjectRepository(InboxChannelConnectionSessionEntity)
    private readonly sessionsRepository: Repository<InboxChannelConnectionSessionEntity>,
    @InjectRepository(InboxChannelEntity)
    private readonly channelsRepository: Repository<InboxChannelEntity>,
    private readonly metaGraphService: MetaGraphService,
    private readonly cryptoService: SettingsCryptoService,
  ) {}

  async start(input: StartInput) {
    if (!input.acceptedRules) {
      throw new BadRequestException(
        'You must accept WhatsApp Business Platform rules before continuing.',
      );
    }

    const state = this.createState();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const session = await this.sessionsRepository.save(
      this.sessionsRepository.create({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        userId: input.userId ?? null,
        provider: 'meta',
        channelType: 'whatsapp',
        status: 'pending',
        state,
        expiresAt,
        payload: {},
        metadata: {
          acceptedRules: true,
          startedAt: new Date().toISOString(),
          connectionMode: 'embedded_signup',
        },
      }),
    );

    return {
      sessionId: session.id,
      state: session.state,
      status: session.status,
      expiresAt: session.expiresAt,
      provider: 'meta',
      channelType: 'whatsapp',
      appId: process.env.META_APP_ID ?? null,
      configId: process.env.META_CONFIG_ID ?? null,
      graphApiVersion: process.env.META_GRAPH_API_VERSION ?? 'v24.0',
    };
  }

  async getStatus(sessionId: string) {
    const session = await this.sessionsRepository.findOne({
      where: {
        id: sessionId,
      },
    });

    if (!session) {
      throw new NotFoundException('Embedded signup session not found.');
    }

    if (session.status === 'pending' && session.expiresAt < new Date()) {
      session.status = 'expired';
      session.errorMessage = 'Connection session expired.';
      await this.sessionsRepository.save(session);
    }

    const channel = await this.findChannelForSession(session);

    return {
      sessionId: session.id,
      provider: session.provider,
      channelType: session.channelType,
      status: session.status,
      businessId: session.businessId,
      wabaId: session.wabaId,
      phoneNumberId: session.phoneNumberId,
      displayPhoneNumber: session.displayPhoneNumber,
      channelId: channel?.id ?? null,
      channelStatus: channel?.status ?? null,
      setupStep:
        typeof channel?.settings?.setupStep === 'string'
          ? channel.settings.setupStep
          : null,
      errorMessage: session.errorMessage,
      expiresAt: session.expiresAt,
      completedAt: session.completedAt,
      metadata: session.metadata,
    };
  }

  async complete(input: CompleteInput) {
    const session = await this.sessionsRepository.findOne({
      where: {
        id: input.sessionId,
      },
    });

    if (!session) {
      throw new NotFoundException('Embedded signup session not found.');
    }

    if (session.status !== 'pending') {
      throw new BadRequestException(
        `Embedded signup session is not pending. Current status: ${session.status}`,
      );
    }

    if (session.expiresAt < new Date()) {
      session.status = 'expired';
      session.errorMessage = 'Connection session expired.';
      await this.sessionsRepository.save(session);
      throw new BadRequestException('Embedded signup session expired.');
    }

    if (session.state !== input.state) {
      session.status = 'failed';
      session.errorMessage = 'Invalid embedded signup state.';
      await this.sessionsRepository.save(session);
      throw new BadRequestException('Invalid embedded signup state.');
    }

    if (!input.phoneNumberId && !input.wabaId) {
      throw new BadRequestException(
        'Embedded signup completion requires at least phoneNumberId or wabaId.',
      );
    }

    session.code = input.code;
    session.businessId = input.businessId ?? null;
    session.wabaId = input.wabaId ?? null;
    session.phoneNumberId = input.phoneNumberId ?? null;
    session.displayPhoneNumber = input.displayPhoneNumber ?? null;
    session.payload = input.payload ?? {};
    session.metadata = {
      ...(session.metadata ?? {}),
      ...(input.metadata ?? {}),
      completedMock: true,
      completedAt: new Date().toISOString(),
    };
    session.status = 'completed';
    session.completedAt = new Date();

    await this.sessionsRepository.save(session);

    const channel = await this.createOrUpdateChannelFromSession(session);

    let tokenExchange: {
      tokenType: string | null;
      expiresIn: number | null;
    } | null = null;

    let webhookSubscription: Record<string, unknown> | null = null;
    let phoneRegistration: Record<string, unknown> | null = null;

    try {
      const exchanged =
        await this.metaGraphService.exchangeCodeForBusinessToken(input.code);

      channel.accessTokenEncrypted = this.cryptoService.encrypt(
        exchanged.accessToken,
      );

      tokenExchange = {
        tokenType: exchanged.tokenType,
        expiresIn: exchanged.expiresIn,
      };

      channel.settings = {
        ...(channel.settings ?? {}),
        setupStep: 'token_exchanged',
        tokenConfigured: true,
        tokenType: exchanged.tokenType,
        tokenExpiresIn: exchanged.expiresIn,
      };

      channel.metadata = {
        ...(channel.metadata ?? {}),
        tokenConfiguredAt: new Date().toISOString(),
        tokenSource: 'embedded_signup_code_exchange',
      };

      await this.channelsRepository.save(channel);

      if (session.wabaId) {
        const subscribed = await this.metaGraphService.subscribeAppToWaba({
          wabaId: session.wabaId,
          accessToken: exchanged.accessToken,
        });

        webhookSubscription = subscribed as Record<string, unknown>;

        channel.settings = {
          ...(channel.settings ?? {}),
          setupStep: 'webhook_subscribed',
          webhookSubscribed: true,
          webhookSubscribedAt: new Date().toISOString(),
        };

        channel.metadata = {
          ...(channel.metadata ?? {}),
          webhookSubscriptionResponse: subscribed,
        };

        await this.channelsRepository.save(channel);
      }

      if (session.phoneNumberId) {
        const registered = await this.metaGraphService.registerPhoneNumber({
          phoneNumberId: session.phoneNumberId,
          accessToken: exchanged.accessToken,
          pin: input.phoneRegistrationPin,
        });

        phoneRegistration = registered as Record<string, unknown>;

        channel.settings = {
          ...(channel.settings ?? {}),
          setupStep: 'phone_registered',
          phoneRegistered: true,
          phoneRegisteredAt: new Date().toISOString(),
        };

        channel.metadata = {
          ...(channel.metadata ?? {}),
          phoneRegistrationResponse: registered,
        };

        await this.channelsRepository.save(channel);
      }

      channel.status = 'active';
      channel.settings = {
        ...(channel.settings ?? {}),
        setupStep: 'active',
        connectionHealth: 'ok',
        connectedAt: new Date().toISOString(),
      };

      channel.metadata = {
        ...(channel.metadata ?? {}),
        embeddedSignupActivatedAt: new Date().toISOString(),
      };

      await this.channelsRepository.save(channel);
    } catch (error) {
      channel.status = 'draft';
      channel.settings = {
        ...(channel.settings ?? {}),
        setupStep:
          typeof channel.settings?.setupStep === 'string'
            ? `${channel.settings.setupStep}_failed`
            : 'embedded_signup_failed',
        tokenConfigured: false,
      };
      channel.metadata = {
        ...(channel.metadata ?? {}),
        tokenExchangeFailedAt: new Date().toISOString(),
        tokenExchangeError:
          error instanceof Error ? error.message : 'Unknown token error',
      };

      await this.channelsRepository.save(channel);

      session.status = 'failed';
      session.errorMessage =
        error instanceof Error ? error.message : 'Failed to exchange code.';
      session.metadata = {
        ...(session.metadata ?? {}),
        failedAt: new Date().toISOString(),
        failedStep: 'token_exchange',
      };

      await this.sessionsRepository.save(session);

      throw error;
    }

    return {
      ...(await this.getStatus(session.id)),
      channelId: channel.id,
      channelStatus: channel.status,
      setupStep:
        typeof channel.settings?.setupStep === 'string'
          ? channel.settings.setupStep
          : null,
      tokenExchange,
      webhookSubscription,
      phoneRegistration,
    };
  }

  private async createOrUpdateChannelFromSession(
    session: InboxChannelConnectionSessionEntity,
  ) {
    const existing = await this.findChannelForSession(session);

    const displayName = session.displayPhoneNumber
      ? `WhatsApp ${session.displayPhoneNumber}`
      : 'WhatsApp Business';

    const settings = {
      ...(existing?.settings ?? {}),
      messagingProduct: 'whatsapp',
      connectionMode: 'embedded_signup',
      setupStep: 'pending_token_exchange',
      webhookSubscribed: false,
      phoneRegistered: false,
      customerServiceWindowHours: 24,
      templatesRequiredOutsideWindow: true,
    };

    const metadata = {
      ...(existing?.metadata ?? {}),
      businessId: session.businessId,
      wabaId: session.wabaId,
      phoneNumberId: session.phoneNumberId,
      displayPhoneNumber: session.displayPhoneNumber,
      connectionSessionId: session.id,
      connectedVia: 'embedded_signup',
      embeddedSignupCompletedAt: new Date().toISOString(),
    };

    const channel =
      existing ??
      this.channelsRepository.create({
        tenantId: session.tenantId,
        workspaceId: session.workspaceId,
        name: displayName,
        type: 'whatsapp',
        provider: 'meta',
        status: 'draft',
        aiEnabled: false,
        settings: {},
        metadata: {},
      });

    channel.name = displayName;
    channel.type = 'whatsapp';
    channel.provider = 'meta';
    channel.status = existing?.accessTokenEncrypted ? 'active' : 'draft';
    channel.externalId = session.phoneNumberId ?? session.wabaId ?? null;
    channel.externalAccountId = session.wabaId;
    channel.externalPhoneNumberId = session.phoneNumberId;
    channel.settings = settings;
    channel.metadata = metadata;

    return this.channelsRepository.save(channel);
  }

  private async findChannelForSession(
    session: InboxChannelConnectionSessionEntity,
  ) {
    if (session.phoneNumberId) {
      const byPhone = await this.channelsRepository.findOne({
        where: {
          tenantId: session.tenantId,
          workspaceId: session.workspaceId,
          type: 'whatsapp',
          provider: 'meta',
          externalPhoneNumberId: session.phoneNumberId,
          deletedAt: IsNull(),
        },
      });

      if (byPhone) return byPhone;
    }

    if (session.wabaId) {
      return this.channelsRepository.findOne({
        where: {
          tenantId: session.tenantId,
          workspaceId: session.workspaceId,
          type: 'whatsapp',
          provider: 'meta',
          externalAccountId: session.wabaId,
          deletedAt: IsNull(),
        },
      });
    }

    return null;
  }

  private createState() {
    return randomBytes(32).toString('hex');
  }
}
