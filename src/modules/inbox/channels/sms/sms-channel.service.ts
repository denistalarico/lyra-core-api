import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Not } from 'typeorm';
import type { RequestContext } from '../../../../common/context/request-context.interface';
import { SettingsCryptoService } from '../../../../common/crypto/settings-crypto.service';
import { InboxChannelEntity } from '../../entities/inbox-channel.entity';
import {
  inboxEntityMatchesScope,
  resolveInboxCompanyScope,
} from '../../inbox-company-scope';
import { mapInboxChannel } from '../../mappers/inbox-channel.mapper';
import { canonicalizeRecipient } from '../whatsapp/services/inbox-pilot-outbound-policy.service';
import {
  SMS_PROVIDERS,
  SmsProviderError,
  type SmsCredentialCheck,
  type SmsProviderKey,
} from './sms-provider.adapter';
import { SmsProviderRegistry } from './sms-provider.registry';
import { parseTelnyxPublicKey } from './telnyx/telnyx-sms.provider';

export const SMS_HELP_TEXT_MAX_LENGTH = 320;

/** People-facing text per provider code. The vendor's own detail is never shown. */
const PROVIDER_ERROR_MESSAGES: Record<string, string> = {
  sms_credentials_invalid: 'A chave de API foi recusada pela Telnyx.',
  sms_number_not_found:
    'Este número não foi encontrado na conta Telnyx desta chave.',
  sms_number_inactive: 'O número ainda não está ativo na Telnyx.',
  sms_messaging_profile_mismatch:
    'O número não está vinculado a este messaging profile na Telnyx.',
  sms_messaging_profile_not_found:
    'O messaging profile não foi encontrado na conta Telnyx.',
  sms_messaging_profile_disabled: 'O messaging profile está desativado.',
  sms_public_key_invalid:
    'A chave pública não é válida. Copie-a em Account Settings → Keys & Credentials.',
  sms_provider_unsupported: 'Este provedor de SMS ainda não está disponível.',
  provider_unreachable: 'A Telnyx não respondeu. Tente novamente.',
};

export type ConnectSmsChannelInput = {
  provider: SmsProviderKey;
  apiKey: string;
  phoneNumber: string;
  messagingProfileId: string;
  publicKey: string;
  helpText?: string | null;
  name?: string | null;
};

/**
 * Connects the tenant's own SMS account (D-IX-7, BYO). The key is checked
 * against the provider before anything is saved, a number belongs to one live
 * channel at most (the webhook finds the channel by it), and the API key is
 * stored only encrypted.
 */
@Injectable()
export class SmsChannelService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly cryptoService: SettingsCryptoService,
    private readonly providers: SmsProviderRegistry,
  ) {}

  setup() {
    return {
      providers: [
        ...SMS_PROVIDERS.map((key) => ({ key, available: true })),
        { key: 'twilio', available: false },
      ],
      webhookUrls: smsWebhookUrls('telnyx'),
    };
  }

  async connect(ctx: RequestContext, input: ConnectSmsChannelInput) {
    const scope = resolveInboxCompanyScope(ctx);
    const phoneNumber = this.normalizePhone(input.phoneNumber);
    const apiKey = input.apiKey?.trim() ?? '';
    const messagingProfileId = input.messagingProfileId?.trim() ?? '';
    const publicKey = input.publicKey?.trim() ?? '';
    if (!apiKey || !messagingProfileId || !publicKey) {
      throw new BadRequestException(
        'Informe a chave de API, o número, o messaging profile e a chave pública.',
      );
    }
    const helpText = this.normalizeHelpText(input.helpText);
    await this.call(() => Promise.resolve(parseTelnyxPublicKey(publicKey)));
    const adapter = await this.call(() =>
      Promise.resolve(this.providers.get(input.provider)),
    );
    const check = await this.call(() =>
      adapter.validateCredentials({ apiKey, phoneNumber, messagingProfileId }),
    );

    const saved = await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`sms-number:${phoneNumber}`],
      );
      const repository = manager.getRepository(InboxChannelEntity);
      const live = await repository.findOne({
        where: {
          type: 'sms',
          externalPhoneNumberId: phoneNumber,
          deletedAt: IsNull(),
          connectionStatus: Not('disconnected' as const),
        },
      });
      const sameScope = (channel: InboxChannelEntity) =>
        channel.tenantId === scope.tenantId &&
        channel.workspaceId === scope.workspaceId &&
        inboxEntityMatchesScope(ctx, channel);
      if (live && !sameScope(live)) {
        throw new ConflictException({
          message: 'Este número já está conectado a outro canal do Lyra.',
          code: 'sms_number_already_connected',
        });
      }
      const channel =
        live ??
        (await repository.findOne({
          where: {
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            type: 'sms',
            externalPhoneNumberId: phoneNumber,
            scopeKind: scope.scopeKind,
            agencyClientId: scope.agencyClientId ?? IsNull(),
            companyContextId: scope.companyContextId ?? IsNull(),
            deletedAt: IsNull(),
          },
          order: { updatedAt: 'DESC' },
        })) ??
        repository.create({
          ...scope,
          type: 'sms',
          aiEnabled: false,
          settings: {},
          metadata: {},
          lifecycleVersion: 1,
          credentialVersion: 0,
        });

      const managed = ctx.managedContext;
      channel.name = input.name?.trim().slice(0, 140) || `SMS ${phoneNumber}`;
      channel.provider = input.provider;
      channel.status = 'active';
      channel.connectionStatus = 'connected';
      channel.externalPhoneNumberId = phoneNumber;
      // The profile lives in metadata only: `external_account_id` carries a
      // per-tenant unique binding, and one profile serves several numbers.
      channel.accessTokenEncrypted = this.cryptoService.encrypt(apiKey);
      channel.credentialVersion = (channel.credentialVersion ?? 0) + 1;
      channel.suspendedAt = null;
      channel.disconnectedAt = null;
      channel.disconnectedBy = null;
      channel.disconnectReason = null;
      channel.credentialRemovedAt = null;
      channel.metadata = {
        ...(channel.metadata ?? {}),
        productKey: 'leadflow',
        operatingMode: scope.scopeKind === 'company' ? 'client' : 'agency',
        clientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        ...(managed?.clientName ? { clientName: managed.clientName } : {}),
        telnyxMessagingProfileId: messagingProfileId,
        // Not a secret: it only verifies what Telnyx signed.
        webhookPublicKey: publicKey,
        ...(helpText !== undefined ? { helpText } : {}),
        lastHealthCheck: this.healthSummary(check),
      };
      try {
        return await repository.save(channel);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({
            message: 'Este número já está conectado a outro canal do Lyra.',
            code: 'sms_number_already_connected',
          });
        }
        throw error;
      }
    });

    return {
      channel: mapInboxChannel(saved),
      health: this.healthSummary(check),
      webhookUrls: smsWebhookUrls(input.provider),
    };
  }

  async healthCheck(ctx: RequestContext, channelId: string) {
    const channel = await this.findChannel(ctx, channelId);
    const apiKey = this.cryptoService.decrypt(channel.accessTokenEncrypted);
    const checkedAt = new Date().toISOString();
    const messagingProfileId =
      typeof channel.metadata?.telnyxMessagingProfileId === 'string'
        ? channel.metadata.telnyxMessagingProfileId
        : null;
    let result: Record<string, unknown>;
    if (!apiKey || !channel.externalPhoneNumberId || !messagingProfileId) {
      result = { ok: false, checkedAt, diagnosis: 'sms_credentials_missing' };
    } else {
      try {
        const check = await this.providers
          .get(channel.provider)
          .validateCredentials({
            apiKey,
            phoneNumber: channel.externalPhoneNumberId,
            messagingProfileId,
          });
        result = { ...this.healthSummary(check), checkedAt };
      } catch (error) {
        result = {
          ok: false,
          checkedAt,
          diagnosis:
            error instanceof SmsProviderError
              ? error.code
              : 'provider_request_failed',
        };
      }
    }
    channel.metadata = { ...(channel.metadata ?? {}), lastHealthCheck: result };
    await this.dataSource.getRepository(InboxChannelEntity).save(channel);
    return {
      ...result,
      channelId: channel.id,
      webhookUrls: smsWebhookUrls(channel.provider),
    };
  }

  async updateSettings(
    ctx: RequestContext,
    channelId: string,
    input: { helpText?: string | null },
  ) {
    const channel = await this.findChannel(ctx, channelId);
    const helpText = this.normalizeHelpText(input.helpText);
    if (helpText !== undefined) {
      channel.metadata = { ...(channel.metadata ?? {}), helpText };
    }
    const saved = await this.dataSource
      .getRepository(InboxChannelEntity)
      .save(channel);
    return mapInboxChannel(saved);
  }

  /**
   * Webhook readiness from the profile itself: the URLs the provider will
   * call and the payload version (v2) our parser reads.
   */
  private healthSummary(check: SmsCredentialCheck) {
    const expected = smsWebhookUrls('telnyx');
    const webhookConfigured =
      expected.primary !== null && check.webhookUrl === expected.primary;
    const failoverConfigured =
      expected.failover !== null &&
      check.webhookFailoverUrl === expected.failover;
    const apiVersionOk = check.webhookApiVersion === '2';
    return {
      ok: webhookConfigured && apiVersionOk,
      checkedAt: new Date().toISOString(),
      diagnosis: !webhookConfigured
        ? 'webhook_url_mismatch'
        : !apiVersionOk
          ? 'webhook_api_version_mismatch'
          : null,
      phoneNumber: check.phoneNumber,
      messagingProfileName: check.messagingProfileName,
      webhookConfigured,
      failoverConfigured,
      webhookApiVersion: check.webhookApiVersion,
    };
  }

  private async findChannel(ctx: RequestContext, channelId: string) {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    const channel = await this.dataSource
      .getRepository(InboxChannelEntity)
      .findOne({
        where: {
          id: channelId,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          type: 'sms',
          deletedAt: IsNull(),
        },
      });
    if (!channel || !inboxEntityMatchesScope(ctx, channel)) {
      throw new NotFoundException('SMS channel not found.');
    }
    return channel;
  }

  private normalizePhone(value: string) {
    const digits = (value ?? '').replace(/\D/g, '');
    try {
      return canonicalizeRecipient(`+${digits}`);
    } catch {
      throw new BadRequestException(
        'Informe o número no formato internacional (E.164), por exemplo +15551234567.',
      );
    }
  }

  private normalizeHelpText(value: string | null | undefined) {
    if (value === undefined) return undefined;
    const text = (value ?? '').trim();
    if (text.length > SMS_HELP_TEXT_MAX_LENGTH) {
      throw new BadRequestException(
        `O texto de ajuda aceita no máximo ${SMS_HELP_TEXT_MAX_LENGTH} caracteres.`,
      );
    }
    return text || null;
  }

  private async call<T>(effect: () => Promise<T>): Promise<T> {
    try {
      return await effect();
    } catch (error) {
      if (error instanceof SmsProviderError) {
        throw new BadRequestException({
          message:
            PROVIDER_ERROR_MESSAGES[error.code] ??
            'Não foi possível validar a conta na Telnyx.',
          code: error.code,
        });
      }
      throw error;
    }
  }
}

/** The single public URL pair every tenant configures (§3.5). */
export function smsWebhookUrls(provider: string | null) {
  const base =
    process.env.API_PUBLIC_URL?.trim() ||
    process.env.AGENCY_PUBLIC_API_URL?.trim() ||
    // Production sets only this one; the path is replaced, the origin kept.
    process.env.META_WEBHOOK_CALLBACK_URL?.trim() ||
    null;
  if (!base || provider !== 'telnyx') return { primary: null, failover: null };
  const primary = new URL(
    '/api/inbox/channels/sms/telnyx/webhook',
    base,
  ).toString();
  return { primary, failover: `${primary}/failover` };
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { code?: string }).code === '23505' ||
      (error as { driverError?: { code?: string } }).driverError?.code ===
        '23505')
  );
}
