/* eslint-disable @typescript-eslint/require-await -- Jest/TypeORM test doubles intentionally expose partial dynamic repository shapes. */
import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import { findForbiddenSocialIntegrationFields } from '../views/social-ad-connection.view';
import { SocialAdConnectionService } from './social-ad-connection.service';

type WhereCall = { clause: string; params?: Record<string, unknown> };

function buildRow(
  overrides: Partial<SocialAdAccountConnectionEntity> = {},
): SocialAdAccountConnectionEntity {
  return {
    id: 'connection-a',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: null,
    provider: 'meta_ads',
    externalAccountId: 'act_1234567890',
    externalBusinessId: 'biz_1',
    accountName: 'Alfa — Institucional',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    connectionStatus: 'connected',
    credentialVersion: 2,
    accessTokenEncrypted: 'ENCRYPTED-TOKEN',
    refreshTokenEncrypted: null,
    tokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
    scopes: ['ads_read', 'business_management'],
    lastSyncedAt: null,
    lastSyncError: null,
    oauthStateHash: null,
    oauthExpiresAt: null,
    createdById: 'user-a',
    metadata: { businessName: 'Alfa Holding', selectableAccounts: [] },
    credentialRemovedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-10T00:00:00.000Z'),
    ...overrides,
  } as SocialAdAccountConnectionEntity;
}

function createHarness(result: {
  many?: SocialAdAccountConnectionEntity[];
  one?: SocialAdAccountConnectionEntity | null;
}) {
  const whereCalls: WhereCall[] = [];
  const saved: SocialAdAccountConnectionEntity[] = [];

  const builder: Record<string, unknown> = {
    where: jest.fn((clause: string, params?: Record<string, unknown>) => {
      whereCalls.push({ clause, params });
      return builder;
    }),
    andWhere: jest.fn((clause: string, params?: Record<string, unknown>) => {
      whereCalls.push({ clause, params });
      return builder;
    }),
    orderBy: jest.fn(() => builder),
    getMany: jest.fn(async () => result.many ?? []),
    getOne: jest.fn(async () => result.one ?? null),
  };

  const deleted: Array<Record<string, unknown>> = [];

  const repository = {
    createQueryBuilder: jest.fn(() => builder),
    save: jest.fn(async (row: SocialAdAccountConnectionEntity) => {
      saved.push(row);
      return row;
    }),
    delete: jest.fn(async (criteria: Record<string, unknown>) => {
      deleted.push(criteria);
      return { affected: 1, raw: [] };
    }),
  };

  const service = new SocialAdConnectionService(
    repository as unknown as Repository<SocialAdAccountConnectionEntity>,
  );

  return { service, whereCalls, saved, deleted, repository };
}

function clauses(whereCalls: WhereCall[]) {
  return whereCalls.map((call) => call.clause).join(' | ');
}

function paramsOf(whereCalls: WhereCall[]) {
  return whereCalls.reduce<Record<string, unknown>>(
    (all, call) => ({ ...all, ...(call.params ?? {}) }),
    {},
  );
}

describe('SocialAdConnectionService.list', () => {
  it('scopes every read by tenant and workspace', async () => {
    const harness = createHarness({ many: [buildRow()] });

    await harness.service.list({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
    });

    expect(clauses(harness.whereCalls)).toContain('connection.tenantId');
    expect(clauses(harness.whereCalls)).toContain('connection.workspaceId');
    expect(paramsOf(harness.whereCalls)).toMatchObject({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
    });
  });

  it('restricts client mode to that single client', async () => {
    const harness = createHarness({ many: [] });

    await harness.service.list({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
    });

    expect(clauses(harness.whereCalls)).toContain(
      'connection.agencyClientId =',
    );
    expect(paramsOf(harness.whereCalls).agencyClientId).toBe('client-a');
  });

  it('restricts agency mode to the agency own connections, never the aggregate', async () => {
    const harness = createHarness({ many: [] });

    await harness.service.list({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
    });

    expect(clauses(harness.whereCalls)).toContain(
      'connection.agencyClientId IS NULL',
    );
  });

  it('hides abandoned authorization attempts', async () => {
    const harness = createHarness({ many: [] });

    await harness.service.list({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
    });

    expect(clauses(harness.whereCalls)).toContain('connection.oauthExpiresAt');
    expect(paramsOf(harness.whereCalls).now).toBeInstanceOf(Date);
  });

  it('returns views that carry no credential', async () => {
    const harness = createHarness({ many: [buildRow()] });

    const items = await harness.service.list({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
    });

    const serialized = JSON.stringify(items);

    expect(items).toHaveLength(1);
    expect(serialized).not.toContain('ENCRYPTED-TOKEN');
    expect(serialized).not.toContain('act_1234567890');
    expect(serialized).not.toContain('tenant-a');
    expect(findForbiddenSocialIntegrationFields(items)).toEqual([]);
  });
});

describe('SocialAdConnectionService.disconnect', () => {
  it('destroys the credential but keeps the audit row', async () => {
    const row = buildRow();
    const harness = createHarness({ one: row });

    const view = await harness.service.disconnect({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      connectionId: 'connection-a',
    });

    expect(row.accessTokenEncrypted).toBeNull();
    expect(row.refreshTokenEncrypted).toBeNull();
    expect(row.tokenExpiresAt).toBeNull();
    expect(row.oauthStateHash).toBeNull();
    expect(row.scopes).toEqual([]);
    expect(row.connectionStatus).toBe('disconnected');
    expect(row.credentialRemovedAt).toBeInstanceOf(Date);
    // The binding survives: which account belonged to which client, and when
    // the credential was revoked, is the record a disconnect should leave.
    expect(row.externalAccountId).toBe('act_1234567890');
    expect(view.state).toBe('disconnected');
    expect(view.hasCredential).toBe(false);
  });

  it('drops the cached account list on disconnect', async () => {
    const row = buildRow({
      metadata: { selectableAccounts: [{ externalAccountId: 'act_1' }] },
    });
    const harness = createHarness({ one: row });

    await harness.service.disconnect({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      connectionId: 'connection-a',
    });

    expect(row.metadata.selectableAccounts).toBeUndefined();
  });

  it('removes an attempt that never bound an account instead of keeping it', async () => {
    // Regression: disconnecting an in-flight attempt used to leave a row with
    // no account and a nulled oauth deadline, which `list()` then showed
    // forever as "Desconectado" with no account and no action able to clear it.
    const row = buildRow({
      externalAccountId: null,
      connectionStatus: 'pending',
      oauthStateHash: 'state-hash',
      oauthExpiresAt: new Date('2026-08-25T23:00:00.000Z'),
      accessTokenEncrypted: null,
    });
    const harness = createHarness({ one: row });

    const view = await harness.service.disconnect({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      connectionId: 'connection-a',
    });

    expect(harness.repository.delete).toHaveBeenCalledTimes(1);
    expect(harness.deleted).toEqual([{ id: 'connection-a' }]);
    expect(harness.repository.save).not.toHaveBeenCalled();
    expect(view.state).toBe('disconnected');
    expect(view.hasCredential).toBe(false);
  });

  it('makes a discarded attempt unusable before removing it', async () => {
    // The state hash is what a replayed callback matches on. Clearing it is
    // what stops the abandoned authorization from being completable, and it
    // must happen whether or not the row is then removed.
    const row = buildRow({
      externalAccountId: null,
      connectionStatus: 'awaiting_selection',
      oauthStateHash: 'state-hash',
      oauthExpiresAt: new Date('2026-08-25T23:00:00.000Z'),
      accessTokenEncrypted: 'ENCRYPTED-TOKEN',
    });
    const harness = createHarness({ one: row });

    await harness.service.disconnect({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      connectionId: 'connection-a',
    });

    expect(row.oauthStateHash).toBeNull();
    expect(row.oauthExpiresAt).toBeNull();
    expect(row.accessTokenEncrypted).toBeNull();
    expect(harness.repository.delete).toHaveBeenCalledTimes(1);
  });

  it('keeps the audit row when an account was bound', async () => {
    const harness = createHarness({ one: buildRow() });

    await harness.service.disconnect({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      connectionId: 'connection-a',
    });

    expect(harness.repository.delete).not.toHaveBeenCalled();
    expect(harness.repository.save).toHaveBeenCalledTimes(1);
  });

  it('reports an out-of-scope id as not found, never as forbidden', async () => {
    // Answering "forbidden" would confirm the id exists and turn the endpoint
    // into an enumeration oracle across tenants.
    const harness = createHarness({ one: null });

    await expect(
      harness.service.disconnect({
        tenantId: 'tenant-b',
        workspaceId: 'workspace-a',
        agencyClientId: null,
        connectionId: 'connection-a',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(harness.repository.save).not.toHaveBeenCalled();
    expect(harness.repository.delete).not.toHaveBeenCalled();
  });

  it('applies the same scope predicates on a single-row lookup', async () => {
    const harness = createHarness({ one: null });

    await expect(
      harness.service.disconnect({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-b',
        agencyClientId: 'client-a',
        connectionId: 'connection-a',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const applied = clauses(harness.whereCalls);
    expect(applied).toContain('connection.id');
    expect(applied).toContain('connection.tenantId');
    expect(applied).toContain('connection.workspaceId');
    expect(applied).toContain('connection.agencyClientId =');
    expect(paramsOf(harness.whereCalls)).toMatchObject({
      workspaceId: 'workspace-b',
      agencyClientId: 'client-a',
    });
  });
});
