import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
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

/** The minimum a scheduler needs to queue a run, and nothing more. */
export type SocialAdSchedulableConnection = {
  connectionId: string;
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  provider: string;
  /** Validated at bind time; the account's own zone decides its day. */
  timezone: string;
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
   *
   * An authorization that never reached an account is the exception — see
   * below.
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

    // An attempt that never bound an account has nothing to audit: no account,
    // no client binding, and no credential that was ever used to read anything.
    // Keeping it would leave a card no action can clear — `list()` hides an
    // abandoned attempt by its oauth deadline, and the clearing above nulls
    // exactly that deadline, so the row would become permanently visible as
    // "Desconectado" with no account. Removing it also makes the discarded
    // state unreachable by construction rather than by having been nulled.
    if (!connection.externalAccountId) {
      await this.connectionsRepository.delete({ id: connection.id });

      return toSocialAdConnectionView(connection);
    }

    await this.connectionsRepository.save(connection);

    return toSocialAdConnectionView(connection);
  }

  /**
   * Connections the scheduler may enqueue work for.
   *
   * Unscoped, and it is the only unscoped read in this service: the scheduler
   * runs on a clock rather than on a request, so there is no caller to scope
   * against. What it returns is not connection data — it is the four fields a
   * run row needs plus the timezone that decides when that account's morning
   * is. No credential, no account name, no metadata.
   *
   * The filters are the ones that make a run worth queueing at all. A
   * connection with no account bound or no timezone would resolve to a
   * credential error at execution, which is a real failure written into the run
   * history every single hour.
   */
  async listSchedulable(): Promise<SocialAdSchedulableConnection[]> {
    const connections = await this.connectionsRepository.find({
      where: {
        provider: 'meta_ads',
        connectionStatus: 'connected',
        credentialRemovedAt: IsNull(),
      },
      select: [
        'id',
        'tenantId',
        'workspaceId',
        'agencyClientId',
        'provider',
        'timezone',
        'externalAccountId',
      ],
    });

    return connections
      .filter(
        (connection) => connection.timezone && connection.externalAccountId,
      )
      .map((connection) => ({
        connectionId: connection.id,
        tenantId: connection.tenantId,
        workspaceId: connection.workspaceId,
        agencyClientId: connection.agencyClientId,
        provider: connection.provider,
        timezone: connection.timezone as string,
      }));
  }

  /**
   * Writes what the last sync attempt means for the connection card.
   *
   * Called by the worker with a connection id that came off a run row, which
   * was itself written from a resolved, scoped credential — so this method does
   * not re-scope. It is not reachable from a request.
   *
   * Three rules, and each one is a claim the settings screen makes to a person:
   *
   * - `syncedAt` advances only when data actually landed. "Last synced" has to
   *   mean "we have facts as of then"; moving it after a run that wrote nothing
   *   would present a broken connection as up to date, which is the one lie
   *   this column can tell.
   * - `error` is cleared only by a clean run. A partial run keeps its error
   *   *and* advances the timestamp, because both are true: something landed and
   *   something did not.
   * - `connection_status` is never touched. A failed read is not evidence that
   *   a connection is disconnected — the account may be fine and the network
   *   not — and parking a connection is a decision with a person on the other
   *   end of it, not a side effect of a queue.
   */
  async recordSyncOutcome(input: {
    connectionId: string;
    syncedAt: Date | null;
    error: string | null;
  }): Promise<void> {
    await this.connectionsRepository.update(
      { id: input.connectionId },
      {
        ...(input.syncedAt ? { lastSyncedAt: input.syncedAt } : {}),
        // Already a safe code where it was classified: `describeSocialAdSyncFailure`
        // never returns a provider string, and Meta's messages carry account ids.
        lastSyncError: input.error ? input.error.slice(0, 240) : null,
      },
    );
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
