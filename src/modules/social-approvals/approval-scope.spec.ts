import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { COMPANY_CONTEXT_REQUIRED } from '../../common/context/company-aware-scope';
import {
  approvalClientWhere,
  approvalScopeWhere,
  assertApprovalCompanyScope,
} from './approval-scope';
import { SocialApprovalRequestEntity } from './entities';
import { SocialApprovalsService } from './social-approvals.service';
import { ApprovalSubjectResolver } from './subjects/approval-subject-resolver';

const agency = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: null,
  companyContextId: null,
};
const clientACompanyA = {
  ...agency,
  agencyClientId: 'client-a',
  companyContextId: 'company-a',
};
const clientACompanyB = { ...clientACompanyA, companyContextId: 'company-b' };
const legacyClientA = { ...clientACompanyA, companyContextId: null };

type Row = Record<string, unknown>;

const isNullOperator = (value: unknown) =>
  value instanceof FindOperator && value.type === 'isNull';

/**
 * Mirrors TypeORM 0.3.28 defaults: a raw `null` in `where` is skipped
 * (`invalidWhereValuesBehavior.null = 'ignore'`); `IsNull()` matches SQL NULL.
 * The pre-fix code passed raw `null`, so these repos reproduce the widening.
 */
function typeormLikeRepo(rows: Row[]) {
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => {
      if (value === null || value === undefined) return true;
      if (isNullOperator(value)) return row[key] === null;
      return row[key] === value;
    });
  const findOne = jest.fn(
    async ({ where }: { where: Row }) =>
      rows.find((row) => matches(row, where)) ?? null,
  );
  return {
    rows,
    findOne,
    find: jest.fn(async ({ where }: { where: Row }) =>
      rows.filter((row) => matches(row, where)),
    ),
    findOneOrFail: jest.fn(async (options: { where: Row }) => {
      const found = await findOne(options);
      if (!found) throw new Error('EntityNotFound');
      return found;
    }),
    save: jest.fn(async (value: Row) => value),
  };
}

const ids = {
  agencyAsset: 'asset-agency',
  assetAA: 'asset-a-a',
  assetAB: 'asset-a-b',
};

function resolverHarness() {
  const assets = typeormLikeRepo([
    { id: ids.agencyAsset, ...agency, name: 'Agência' },
    { id: ids.assetAA, ...clientACompanyA, name: 'Cliente A / Empresa A' },
    { id: ids.assetAB, ...clientACompanyB, name: 'Cliente A / Empresa B' },
  ]);
  const versions = typeormLikeRepo([
    { id: 'v-agency', creativeAssetId: ids.agencyAsset, versionNumber: 1 },
    { id: 'v-a-a', creativeAssetId: ids.assetAA, versionNumber: 1 },
    { id: 'v-a-b', creativeAssetId: ids.assetAB, versionNumber: 1 },
  ]);
  const plans = typeormLikeRepo([
    { id: 'plan-agency', ...agency },
    { id: 'plan-a-a', ...clientACompanyA },
  ]);
  const contentItems = typeormLikeRepo([
    {
      id: 'item-agency',
      planId: 'plan-agency',
      ...agency,
      title: 'Agência',
    },
    {
      id: 'item-a-a',
      planId: 'plan-a-a',
      ...clientACompanyA,
      title: 'Cliente A',
    },
  ]);
  const contentRevisions = typeormLikeRepo([
    {
      id: 'rev-a-a',
      contentItemId: 'item-a-a',
      ...clientACompanyA,
      revisionNumber: 1,
    },
  ]);
  const resolver = new ApprovalSubjectResolver(
    assets as never,
    versions as never,
    plans as never,
    contentItems as never,
    contentRevisions as never,
  );
  return { resolver, assets };
}

const creative = (subjectId: string, subjectRevisionId: string) => ({
  subjectType: 'creative_version',
  subjectId,
  subjectRevisionId,
});

describe('Approvals scope predicates — null means IS NULL', () => {
  it('turns agency scope (null, null) into IsNull() operators, never raw null', () => {
    const where = approvalScopeWhere(agency);
    expect(isNullOperator(where.agencyClientId)).toBe(true);
    expect(isNullOperator(where.companyContextId)).toBe(true);
    expect(Object.values(where)).not.toContain(null);
    expect(isNullOperator(approvalClientWhere(agency).agencyClientId)).toBe(
      true,
    );
  });

  it('keeps a company scope as exact UUID equality on both columns', () => {
    expect(approvalScopeWhere(clientACompanyA)).toEqual(clientACompanyA);
    expect(approvalClientWhere(clientACompanyA)).toEqual({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
    });
  });

  it('keeps the company predicate for legacy (client, null) instead of dropping it', () => {
    const where = approvalScopeWhere(legacyClientA);
    expect(where.agencyClientId).toBe('client-a');
    expect(isNullOperator(where.companyContextId)).toBe(true);
  });

  it('requires both ids to open an approval request', () => {
    expect(() => assertApprovalCompanyScope(clientACompanyA)).not.toThrow();
    for (const scope of [agency, legacyClientA])
      expect(() => assertApprovalCompanyScope(scope)).toThrow(
        BadRequestException,
      );
  });
});

describe('ApprovalSubjectResolver — scope isolation with mixed rows', () => {
  it('agency scope sees only the (NULL, NULL) creative', async () => {
    const { resolver } = resolverHarness();

    await expect(
      resolver.resolve(agency, creative(ids.agencyAsset, 'v-agency')),
    ).resolves.toMatchObject({ subjectId: ids.agencyAsset });
    // Pre-fix, the dropped filters let agency scope resolve these.
    await expect(
      resolver.resolve(agency, creative(ids.assetAA, 'v-a-a')),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      resolver.resolve(agency, creative(ids.assetAB, 'v-a-b')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('Client A / Company A cannot resolve Company B or agency creatives', async () => {
    const { resolver } = resolverHarness();

    await expect(
      resolver.resolve(clientACompanyA, creative(ids.assetAA, 'v-a-a')),
    ).resolves.toMatchObject({
      subjectId: ids.assetAA,
      subjectRevisionId: 'v-a-a',
    });
    await expect(
      resolver.resolve(clientACompanyA, creative(ids.assetAB, 'v-a-b')),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      resolver.resolve(clientACompanyA, creative(ids.agencyAsset, 'v-agency')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('agency scope cannot resolve a client Planner revision', async () => {
    const { resolver } = resolverHarness();

    await expect(
      resolver.resolve(agency, {
        subjectType: 'planner_content_revision',
        subjectId: 'item-a-a',
        subjectRevisionId: 'rev-a-a',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      resolver.resolve(clientACompanyA, {
        subjectType: 'planner_content_revision',
        subjectId: 'item-a-a',
        subjectRevisionId: 'rev-a-a',
      }),
    ).resolves.toMatchObject({ subjectRevisionId: 'rev-a-a' });
  });

  it('agency scope cannot build a preview of a client creative', async () => {
    const { resolver } = resolverHarness();

    await expect(
      resolver.getPreview(agency, {
        subjectType: 'creative_version',
        subjectId: ids.assetAA,
        subjectRevisionId: 'v-a-a',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SocialApprovalsService — agency scope never widens or 500s', () => {
  function serviceHarness() {
    const clientRequest = {
      id: 'approval-client',
      ...clientACompanyA,
      status: 'awaiting_internal_review',
      currentStage: 'internal',
      subjectType: 'creative_version',
      subjectId: ids.assetAA,
      subjectRevisionId: 'v-a-a',
    };
    const requests = typeormLikeRepo([clientRequest]);
    const where: Array<{ sql: string; params: Row }> = [];
    const qb = {
      where: jest.fn((sql: string, params: Row) => {
        where.push({ sql, params });
        return qb;
      }),
      andWhere: jest.fn((sql: string, params: Row) => {
        where.push({ sql, params });
        return qb;
      }),
      orderBy: jest.fn(() => qb),
      getMany: jest.fn(async () => []),
    };
    const repo = { ...requests, createQueryBuilder: jest.fn(() => qb) };
    const transaction = jest.fn(
      async (fn: (manager: unknown) => Promise<unknown>) =>
        fn({
          query: jest.fn(),
          save: jest.fn(async (value: unknown) => value),
          getRepository: (entity: unknown) => {
            if (entity !== SocialApprovalRequestEntity)
              return { save: jest.fn(async (value: unknown) => value) };
            return repo;
          },
        }),
    );
    const subjects = { resolve: jest.fn() };
    const service = new SocialApprovalsService(
      repo as never,
      { find: jest.fn(async () => []) } as never,
      { find: jest.fn(async () => []) } as never,
      { transaction } as never,
      subjects as never,
    );
    return { service, subjects, transaction, where, clientRequest };
  }

  it('rejects create in agency and legacy scope with company_context_required, before any read or write', async () => {
    const { service, subjects, transaction } = serviceHarness();

    for (const scope of [agency, legacyClientA]) {
      const attempt = service.create(
        scope,
        'user-a',
        creative(ids.agencyAsset, 'v-agency'),
      );
      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toMatchObject({
        response: { code: COMPANY_CONTEXT_REQUIRED },
      });
    }
    expect(subjects.resolve).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('agency scope cannot read or mutate a request of Client A / Company A', async () => {
    const { service, clientRequest } = serviceHarness();
    const id = clientRequest.id;

    await expect(service.detail(agency, id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.submit(agency, id, 'user-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.comment(agency, id, 'user-a', 'nota'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.approveInternal(agency, id, 'user-a'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.requestChanges(agency, id, 'user-a', 'ajuste'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.cancel(agency, id, 'user-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(clientRequest.status).toBe('awaiting_internal_review');
  });

  it('the owning company scope still finds the same request', async () => {
    const { service, clientRequest } = serviceHarness();

    await expect(
      service.detail(clientACompanyA, clientRequest.id),
    ).resolves.toMatchObject({ id: clientRequest.id });
    await expect(
      service.detail(clientACompanyB, clientRequest.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list filters agency scope with IS NULL and company scope with equality', async () => {
    const agencyHarness = serviceHarness();
    await agencyHarness.service.list(agency, {});
    const agencySql = agencyHarness.where.map((w) => w.sql);
    expect(agencySql).toContain('request.agencyClientId IS NULL');
    expect(agencySql).toContain('request.companyContextId IS NULL');

    const companyHarness = serviceHarness();
    await companyHarness.service.list(clientACompanyA, {});
    expect(companyHarness.where).toEqual(
      expect.arrayContaining([
        {
          sql: 'request.agencyClientId = :agencyClientId',
          params: { agencyClientId: 'client-a' },
        },
        {
          sql: 'request.companyContextId = :companyContextId',
          params: { companyContextId: 'company-a' },
        },
      ]),
    );
  });
});
