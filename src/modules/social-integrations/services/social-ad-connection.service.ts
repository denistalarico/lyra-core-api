import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import {
  SocialAdConnectionView,
  toSocialAdConnectionView,
} from '../views/social-ad-connection.view';

export type ListSocialAdConnectionsInput = {
  tenantId: string;
  workspaceId: string;
  /** NULL means agency context: only the agency's own connections. */
  agencyClientId: string | null;
};

export type DisconnectSocialAdConnectionInput = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  connectionId: string;
};

@Injectable()
export class SocialAdConnectionService {
  constructor(
    @InjectRepository(SocialAdAccountConnectionEntity, 'agency')
    private readonly connectionsRepository: Repository<SocialAdAccountConnectionEntity>,
  ) {}

  async list(
    input: ListSocialAdConnectionsInput,
  ): Promise<SocialAdConnectionView[]> {
    const now = new Date();

    const query = this.connectionsRepository
      .createQueryBuilder('connection')
      .where('connection.tenantId = :tenantId', { tenantId: input.tenantId })
      .andWhere('connection.workspaceId = :workspaceId', {
        workspaceId: input.workspaceId,
      });

    this.applyClientScope(query, input.agencyClientId);

    // An abandoned authorization is scaffolding, not a connection. Showing it
    // would leave a permanent "connecting…" card that no action can clear.
    query.andWhere(
      '(connection.externalAccountId IS NOT NULL OR connection.oauthExpiresAt IS NULL OR connection.oauthExpiresAt > :now)',
      { now },
    );

    const connections = await query
      .orderBy('connection.createdAt', 'DESC')
      .getMany();

    return connections.map((connection) =>
      toSocialAdConnectionView(connection, now),
    );
  }

  /**
   * Drops the credential and marks the connection disconnected.
   *
   * The row survives on purpose: the account binding, the client it belonged
   * to and when it was revoked are the audit trail of a credential that once
   * existed. What must not survive is the credential itself.
   */
  async disconnect(
    input: DisconnectSocialAdConnectionInput,
  ): Promise<SocialAdConnectionView> {
    const connection = await this.findInScope(input);

    connection.connectionStatus = 'disconnected';
    connection.credentialRemovedAt = new Date();
    connection.accessTokenEncrypted = null;
    connection.refreshTokenEncrypted = null;
    connection.tokenExpiresAt = null;
    connection.oauthStateHash = null;
    connection.oauthExpiresAt = null;
    connection.scopes = [];
    connection.metadata = {
      ...(connection.metadata ?? {}),
      selectableAccounts: undefined,
      disconnectedAt: connection.credentialRemovedAt.toISOString(),
    };

    await this.connectionsRepository.save(connection);

    return toSocialAdConnectionView(connection);
  }

  /**
   * Scope resolution and existence check are the same query on purpose.
   *
   * A connection outside the caller's tenant, workspace or client context is
   * reported as "not found", identical to an id that never existed. Answering
   * "forbidden" would confirm the id is real and turn the endpoint into an
   * enumeration oracle.
   */
  private async findInScope(input: DisconnectSocialAdConnectionInput) {
    const query = this.connectionsRepository
      .createQueryBuilder('connection')
      .where('connection.id = :id', { id: input.connectionId })
      .andWhere('connection.tenantId = :tenantId', { tenantId: input.tenantId })
      .andWhere('connection.workspaceId = :workspaceId', {
        workspaceId: input.workspaceId,
      });

    this.applyClientScope(query, input.agencyClientId);

    const connection = await query.getOne();

    if (!connection) {
      throw new NotFoundException('Connection not found.');
    }

    return connection;
  }

  /**
   * Client mode sees exactly one client's connections. Agency mode sees the
   * agency's own — never the aggregate of every client, which is not an
   * operational context (see `managedContextAdapter.ts`).
   */
  private applyClientScope(
    query: ReturnType<
      Repository<SocialAdAccountConnectionEntity>['createQueryBuilder']
    >,
    agencyClientId: string | null,
  ) {
    if (agencyClientId) {
      query.andWhere('connection.agencyClientId = :agencyClientId', {
        agencyClientId,
      });
    } else {
      query.andWhere('connection.agencyClientId IS NULL');
    }
  }
}
