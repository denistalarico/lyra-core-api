import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  ResolvedAdCredential,
  createResolvedAdCredential,
} from '../social-integrations/credentials/resolved-ad-credential';
import { SocialAdCredentialError } from '../social-integrations/credentials/social-ad-credential.error';
import { SocialAdAccountConnectionEntity } from '../social-integrations/entities/social-ad-account-connection.entity';
import {
  GoogleCredentialError,
  SocialGoogleAuthorizationService,
} from './social-google-authorization.service';

export type ResolveGoogleAdsCredentialInput = {
  connectionId: string;
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId?: string | null;
};

/**
 * Turns a `google_ads` connection row into the same `ResolvedAdCredential` the
 * Meta resolver produces (D-G4). The row stores no token: it comes from
 * `SocialGoogleAuthorizationService.getAccessToken`, the single token exit of
 * the Google foundation, so refresh locking and scope checks are not duplicated.
 *
 * Reached only through `SocialAdCredentialResolver`, which delegates by provider.
 */
@Injectable()
export class GoogleAdsCredentialResolver {
  constructor(
    @InjectRepository(SocialAdAccountConnectionEntity, 'agency')
    private readonly connections: Repository<SocialAdAccountConnectionEntity>,
    private readonly authorizations: SocialGoogleAuthorizationService,
  ) {}

  async resolve(
    input: ResolveGoogleAdsCredentialInput,
  ): Promise<ResolvedAdCredential> {
    const connection = await this.find(input);
    if (!connection) throw new SocialAdCredentialError('connection_not_found');
    if (connection.credentialRemovedAt) {
      throw new SocialAdCredentialError('credential_removed');
    }
    if (connection.connectionStatus !== 'connected') {
      throw new SocialAdCredentialError('connection_not_connected');
    }
    const customerId = connection.externalAccountId;
    if (!customerId || !/^\d{10}$/.test(customerId)) {
      throw new SocialAdCredentialError('account_not_bound');
    }
    const timezone = this.requireTimezone(connection.timezone);

    let token: { accessToken: string; expiresAt: Date | null };
    try {
      token = await this.authorizations.getAccessToken({
        scope: {
          tenantId: connection.tenantId,
          workspaceId: connection.workspaceId,
          agencyClientId: connection.agencyClientId,
          companyContextId: connection.companyContextId,
        },
        product: 'ads',
      });
    } catch (error) {
      if (error instanceof GoogleCredentialError) {
        switch (error.code) {
          case 'not_connected':
          case 'product_not_connected':
            throw new SocialAdCredentialError('connection_not_connected');
          case 'reauth_required':
          case 'scope_not_granted':
            throw new SocialAdCredentialError('token_expired');
          default:
            throw new SocialAdCredentialError('credential_refresh_failed');
        }
      }
      throw error;
    }

    return createResolvedAdCredential({
      connectionId: connection.id,
      tenantId: connection.tenantId,
      workspaceId: connection.workspaceId,
      agencyClientId: connection.agencyClientId,
      companyContextId: connection.companyContextId,
      provider: 'google_ads',
      authorizationMethod: 'google_oauth',
      externalAccountId: customerId,
      currency: connection.currency,
      timezone,
      credentialVersion: connection.credentialVersion,
      tokenExpiresAt: token.expiresAt,
      accessToken: token.accessToken,
    });
  }

  /**
   * `login-customer-id` for calls on this connection: the manager the account
   * was reached through, stored at selection. Not a secret. Null when the
   * account is accessed directly.
   */
  async loginCustomerId(
    input: ResolveGoogleAdsCredentialInput,
  ): Promise<string | null> {
    const connection = await this.find(input);
    if (!connection) throw new SocialAdCredentialError('connection_not_found');
    const stored = connection.metadata?.loginCustomerId;
    if (typeof stored === 'string' && /^\d{10}$/.test(stored)) return stored;
    return null;
  }

  private find(input: ResolveGoogleAdsCredentialInput) {
    return this.connections.findOne({
      where: {
        id: input.connectionId,
        provider: 'google_ads',
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agencyClientId: input.agencyClientId ?? IsNull(),
        companyContextId: input.companyContextId ?? IsNull(),
      },
    });
  }

  private requireTimezone(timezone: string | null): string {
    const candidate = timezone?.trim();
    if (!candidate) throw new SocialAdCredentialError('timezone_missing');
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    } catch {
      throw new SocialAdCredentialError('timezone_unsupported');
    }
    return candidate;
  }
}
