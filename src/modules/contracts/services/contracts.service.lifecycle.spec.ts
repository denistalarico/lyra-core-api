import { EntityManager, Repository } from 'typeorm';
import { ContractsService } from './contracts.service';
import { ContractNotificationPublisher } from './contract-notification.publisher';
import {
  ContractDocument,
  ContractEvent,
  ContractParty,
  ContractRecord,
  ContractSignatureProviderSetting,
  ContractTemplate,
  ContractTemplateVersion,
} from '../entities';
import {
  ContractDocumentKind,
  ContractDocumentType,
  ContractSignatureMode,
  ContractSignatureProvider,
  ContractStatus,
  ContractTargetType,
  ContractTemplateStatus,
} from '../enums';
import { RenewContractDto } from '../dto/renew-contract.dto';
import { CreateContractTermDto } from '../dto/create-contract-term.dto';
import { CONTRACT_TEMPLATE_PRESETS } from '../contracts-presets';
const scope = { tenantId: 'tenant', workspaceId: 'workspace', userId: 'user' };
function fixture(override: Partial<ContractRecord> = {}) {
  const parent: ContractRecord = Object.assign(new ContractRecord(), {
    ...scope,
    id: 'parent',
    title: 'Parent',
    targetType: ContractTargetType.Client,
    targetId: 'client',
    documentKind: ContractDocumentKind.Contract,
    parentContractId: null,
    status: ContractStatus.Draft,
    signatureMode: ContractSignatureMode.Manual,
    signatureProvider: ContractSignatureProvider.None,
    templateId: null,
    templateVersionId: null,
    validFrom: '2025-10-11',
    validUntil: '2026-10-10',
    createdAt: new Date('2025-10-11'),
    metadata: {
      clientContract: {
        mode: 'manual',
        attachedPdf: { documentId: 'legacy' },
        manual: { monthlyValue: '100.00', dueDay: '10', currency: 'BRL' },
      },
    },
    variablesData: {
      'contract.monthlyValue': '100.00',
      'contract.number': '1',
    },
    ...override,
  });
  const records = [parent],
    documents: ContractDocument[] = [],
    events: ContractEvent[] = [],
    templates: ContractTemplate[] = [],
    versions: ContractTemplateVersion[] = [];
  let sequence = 0;
  const matches = (
    row: Record<string, unknown>,
    where: Record<string, unknown>,
  ) =>
    Object.entries(where).every(([key, value]) =>
      typeof value === 'object' && value !== null ? true : row[key] === value,
    );
  const repo = {
    create: (value: Partial<ContractRecord>) =>
      Object.assign(
        new ContractRecord(),
        { id: `record-${++sequence}`, createdAt: new Date() },
        value,
      ),
    findOne: jest.fn((options: { where: Record<string, unknown> }) =>
      Promise.resolve(
        records.find((row) =>
          matches(row as unknown as Record<string, unknown>, options.where),
        ) ?? null,
      ),
    ),
    save: jest.fn((row: ContractRecord) => {
      if (!records.some((r) => r.id === row.id)) records.push(row);
      return Promise.resolve(row);
    }),
    count: jest.fn((options: { where: Record<string, unknown> }) =>
      Promise.resolve(
        records.filter((row) =>
          matches(row as unknown as Record<string, unknown>, options.where),
        ).length,
      ),
    ),
    update: jest.fn(
      (where: Record<string, unknown>, patch: Partial<ContractRecord>) => {
        const row = records.find((r) =>
          matches(r as unknown as Record<string, unknown>, where),
        );
        if (row) Object.assign(row, patch);
        return Promise.resolve({ affected: row ? 1 : 0 });
      },
    ),
    manager: {} as EntityManager,
  };
  const docs = {
    findOne: jest.fn((options: { where: Record<string, unknown> }) =>
      Promise.resolve(
        documents.find((row) =>
          matches(row as unknown as Record<string, unknown>, options.where),
        ) ?? null,
      ),
    ),
    find: jest.fn((options: { where: Record<string, unknown> }) =>
      Promise.resolve(
        documents.filter((row) =>
          matches(row as unknown as Record<string, unknown>, options.where),
        ),
      ),
    ),
    create: (value: Partial<ContractDocument>) =>
      Object.assign(new ContractDocument(), { id: `doc-${++sequence}` }, value),
    save: jest.fn((row: ContractDocument) => {
      documents.push(row);
      return Promise.resolve(row);
    }),
  };
  const eventRepo = {
    find: jest.fn().mockResolvedValue([]),
    create: (value: Partial<ContractEvent>) =>
      Object.assign(
        new ContractEvent(),
        { id: `event-${++sequence}`, createdAt: new Date() },
        value,
      ),
    save: jest.fn((row: ContractEvent) => {
      events.push(row);
      return Promise.resolve(row);
    }),
  };
  const templateRepo = {
    findOne: jest.fn((options: { where: Record<string, unknown> }) =>
      Promise.resolve(
        templates.find((row) =>
          matches(row as unknown as Record<string, unknown>, options.where),
        ) ?? null,
      ),
    ),
  };
  const versionRepo = {
    findOne: jest.fn((options: { where: Record<string, unknown> }) =>
      Promise.resolve(
        versions
          .filter((row) =>
            matches(row as unknown as Record<string, unknown>, options.where),
          )
          .sort((a, b) => b.version - a.version)[0] ?? null,
      ),
    ),
  };
  const manager = {
    getRepository: (type: unknown) =>
      type === ContractRecord
        ? repo
        : type === ContractDocument
          ? docs
          : type === ContractTemplate
            ? templateRepo
            : type === ContractTemplateVersion
              ? versionRepo
              : eventRepo,
  };
  repo.manager = {
    transaction: async (work: (manager: EntityManager) => Promise<unknown>) => {
      const snapshots = structuredClone({ records, documents, events });
      try {
        return await work(manager as unknown as EntityManager);
      } catch (error) {
        records.splice(0, records.length, ...snapshots.records);
        documents.splice(0, documents.length, ...snapshots.documents);
        events.splice(0, events.length, ...snapshots.events);
        throw error;
      }
    },
  } as EntityManager;
  const notifications = {
    publishSigned: jest.fn(),
    publishCompleted: jest.fn(),
    publishViewed: jest.fn(),
    publishRefused: jest.fn(),
  };
  const service = new ContractsService(
    templateRepo as unknown as Repository<ContractTemplate>,
    versionRepo as unknown as Repository<ContractTemplateVersion>,
    {} as Repository<ContractSignatureProviderSetting>,
    repo as unknown as Repository<ContractRecord>,
    {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<ContractParty>,
    docs as unknown as Repository<ContractDocument>,
    eventRepo as unknown as Repository<ContractEvent>,
    notifications as unknown as ContractNotificationPublisher,
  );
  jest.spyOn(service, 'findContract').mockImplementation((_context, id) =>
    Promise.resolve({
      ...records.find((r) => r.id === id)!,
      parties: [],
      documents: documents.filter((d) => d.contractId === id),
      events: events.filter((e) => e.contractId === id),
    }),
  );
  const internals = service as unknown as {
    uploadPdfToObjectStorage: (data: {
      fileKey: string;
    }) => Promise<{ fileKey: string; bucket: string }>;
    resolveContractNotificationRecipients: () => Promise<[]>;
    applyAutentiqueSnapshot: (
      context: typeof scope,
      contract: ContractRecord,
      snapshot: unknown,
      options: unknown,
    ) => Promise<unknown>;
  };
  jest.spyOn(internals, 'uploadPdfToObjectStorage').mockImplementation((data) =>
    Promise.resolve({
      fileKey: data.fileKey,
      bucket: 'test',
    }),
  );
  jest
    .spyOn(internals, 'resolveContractNotificationRecipients')
    .mockResolvedValue([]);
  return {
    service,
    parent,
    records,
    documents,
    events,
    templates,
    versions,
    repo,
    docs,
    internals,
  };
}
describe('contract E3 lifecycle (no database/storage/provider)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-11T12:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  it('PATCH ignores undefined and preserves Autentique and nested signature evidence', async () => {
    const h = fixture({
      metadata: {
        signatureProviderMode: 'sandbox',
        templateName: 'Template',
        clientContract: {
          mode: 'manual',
          attachedPdf: { documentId: 'legacy' },
          note: 'old',
        },
        effectiveTerms: { monthlyValue: '150' },
      },
    });
    const result = await h.service.updateContract(scope, 'parent', {
      title: undefined,
      status: undefined,
      metadata: {
        signatureProviderMode: 'forged',
        effectiveTerms: { monthlyValue: '1' },
        clientContract: { note: 'new', attachedPdf: { documentId: 'forged' } },
      },
    });
    expect(result).toMatchObject({
      title: 'Parent',
      status: ContractStatus.Draft,
      metadata: {
        signatureProviderMode: 'sandbox',
        templateName: 'Template',
        effectiveTerms: { monthlyValue: '150' },
        clientContract: { note: 'new', attachedPdf: { documentId: 'legacy' } },
      },
    });
    expect(h.events[0].metadata.updatedFields).toEqual(['metadata']);
  });
  it.each(['same', 'custom'] as const)(
    'renews %s periods with keep/percent/custom and retains signed parent',
    async (periodMode) => {
      for (const valueMode of ['keep', 'percent', 'custom'] as const) {
        const h = fixture();
        const before = structuredClone(h.parent.variablesData);
        const dto: RenewContractDto = {
          periodMode,
          valueMode,
          adjustmentPercent: 10,
          monthlyValue: '125.005',
          ...(periodMode === 'custom'
            ? { validFrom: '2026-11-01', validUntil: '2027-10-31' }
            : {}),
        };
        const result = await h.service.renewContract(scope, 'parent', dto);
        expect(result).toMatchObject({
          parentContractId: 'parent',
          documentKind: 'contract',
          status: 'draft',
          validFrom: periodMode === 'same' ? '2026-10-11' : '2026-11-01',
        });
        expect(result.variablesData['contract.monthlyValue']).toBe(
          valueMode === 'keep'
            ? '100.00'
            : valueMode === 'percent'
              ? '110.00'
              : '125.01',
        );
        expect(
          (result.metadata.clientContract as Record<string, unknown>)
            .attachedPdf,
        ).toBeUndefined();
        expect(h.parent.variablesData).toEqual(before);
        expect(h.events.map((e) => e.type)).toEqual([
          'contract.created',
          'contract.renewed',
        ]);
        expect(h.repo.findOne).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: 'parent',
              tenantId: 'tenant',
              workspaceId: 'workspace',
            },
            lock: { mode: 'pessimistic_write' },
          }),
        );
      }
    },
  );
  it('uses effective monthly amount, half-up percent rounding and records BCB provenance without fetch', async () => {
    const h = fixture({
      metadata: {
        effectiveTerms: { monthlyValue: '10.05' },
        clientContract: {
          mode: 'manual',
          attachedPdf: { documentId: 'legacy' },
        },
      },
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const result = await h.service.renewContract(scope, 'parent', {
      periodMode: 'same',
      valueMode: 'percent',
      adjustmentPercent: 10,
      adjustmentSource: 'bcb_sgs',
      indexPeriod: { start: '2025-10', end: '2026-09' },
    });
    expect(result.variablesData['contract.monthlyValue']).toBe('11.06');
    expect(result.metadata.renewal).toMatchObject({
      adjustmentSource: 'bcb_sgs',
      indexPeriod: { start: '2025-10', end: '2026-09' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects duplicate renewal', async () => {
    const h = fixture();
    await h.service.renewContract(scope, 'parent', {
      periodMode: 'same',
      valueMode: 'keep',
    });
    await expect(
      h.service.renewContract(scope, 'parent', {
        periodMode: 'same',
        valueMode: 'keep',
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'contract_already_renewed' },
    });
  });
  it.each([
    [{ validFrom: null }, 'contract_renewal_period_unknown'],
    [
      { targetType: ContractTargetType.TeamMember },
      'contract_target_not_supported',
    ],
    [
      {
        metadata: {
          termination: { effectiveDate: '2026-12-01' },
          clientContract: {
            mode: 'manual',
            attachedPdf: { documentId: 'legacy' },
          },
        },
      },
      'contract_terminated',
    ],
    [
      { metadata: { clientContract: { mode: 'manual' } } },
      'contract_not_signed',
    ],
    [{ status: ContractStatus.Cancelled }, 'contract_parent_invalid'],
  ] as const)(
    'rejects invalid renewal parents',
    async (override, code) =>
      await expect(
        fixture(override).service.renewContract(scope, 'parent', {
          periodMode: 'same',
          valueMode: 'keep',
        }),
      ).rejects.toMatchObject({ status: 422, response: { code } }),
  );
  it('chooses latest template version unless archived', async () => {
    for (const status of [
      ContractTemplateStatus.Active,
      ContractTemplateStatus.Archived,
    ]) {
      const h = fixture({ templateId: 'template', templateVersionId: 'old' });
      h.templates.push(
        Object.assign(new ContractTemplate(), {
          ...scope,
          id: 'template',
          status,
        }),
      );
      h.versions.push(
        Object.assign(new ContractTemplateVersion(), {
          ...scope,
          id: 'latest',
          templateId: 'template',
          version: 2,
        }),
      );
      expect(
        (
          await h.service.renewContract(scope, 'parent', {
            periodMode: 'same',
            valueMode: 'keep',
          })
        ).templateVersionId,
      ).toBe(status === ContractTemplateStatus.Archived ? 'old' : 'latest');
    }
  });
  it('scopes parent lookup before creating anything', async () => {
    const h = fixture();
    await expect(
      h.service.renewContract({ ...scope, workspaceId: 'other' }, 'parent', {
        periodMode: 'same',
        valueMode: 'keep',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(h.records).toHaveLength(1);
    expect(h.events).toHaveLength(0);
  });
  it('amendment creation stays pending and preserves signed parent', async () => {
    const h = fixture({ validUntil: '2026-12-31' });
    const before = structuredClone(h.parent);
    const term = await h.service.createContractTerm(scope, 'parent', {
      kind: ContractDocumentKind.Amendment,
      changes: { monthlyValue: '150', validUntil: '2027-12-31' },
    });
    expect(term.metadata.amendment).toMatchObject({
      state: 'pending',
      changes: { monthlyValue: '150.00' },
    });
    expect(h.parent).toEqual(before);
    expect(term.variablesData['term.number']).toBe('1º');
    expect(term.variablesData['contract.number']).toBe('1');
    const second = await h.service.createContractTerm(scope, 'parent', {
      kind: ContractDocumentKind.Amendment,
    });
    expect(second.variablesData['term.number']).toBe('2º');
  });
  it('signed upload applies amendment once and keeps variablesData immutable', async () => {
    const h = fixture({ validUntil: '2026-12-31' });
    const before = structuredClone(h.parent.variablesData);
    const term = await h.service.createContractTerm(scope, 'parent', {
      kind: ContractDocumentKind.Amendment,
      changes: { monthlyValue: '150', validUntil: '2027-12-31' },
    });
    await h.service.uploadManuallySignedContract(scope, term.id, {
      fileBase64: Buffer.from('%PDF-1.7').toString('base64'),
    });
    expect(h.parent).toMatchObject({
      validUntil: '2027-12-31',
      metadata: {
        effectiveTerms: { monthlyValue: '150.00', sourceTermId: term.id },
      },
    });
    expect(h.parent.variablesData).toEqual(before);
    const eventCount = h.events.length;
    await h.service.applySignedAmendment(
      scope,
      h.records.find((r) => r.id === term.id)!,
    );
    expect(h.events).toHaveLength(eventCount);
  });
  it('mark without file cannot apply amendment, subsequent upload can', async () => {
    const h = fixture({ validUntil: '2026-12-31' });
    const term = await h.service.createContractTerm(scope, 'parent', {
      kind: ContractDocumentKind.Amendment,
      changes: { monthlyValue: '150' },
    });
    await h.service.markManuallySigned(scope, term.id, {});
    await h.service.applySignedAmendment(
      scope,
      h.records.find((r) => r.id === term.id)!,
    );
    expect(h.parent.metadata.effectiveTerms).toBeUndefined();
    await h.service.uploadManuallySignedContract(scope, term.id, {
      fileBase64: Buffer.from('%PDF-1.7').toString('base64'),
    });
    expect(h.parent.metadata.effectiveTerms).toMatchObject({
      monthlyValue: '150.00',
    });
  });
  it('retries interrupted manual amendment effects without another storage upload', async () => {
    const h = fixture({ validUntil: '2026-12-31' });
    const term = await h.service.createContractTerm(scope, 'parent', {
      kind: ContractDocumentKind.Amendment,
      changes: { monthlyValue: '150' },
    });
    jest
      .spyOn(h.service, 'applySignedAmendment')
      .mockRejectedValueOnce(new Error('transient persistence failure'));
    const dto = { fileBase64: Buffer.from('%PDF').toString('base64') };
    await expect(
      h.service.uploadManuallySignedContract(scope, term.id, dto),
    ).rejects.toThrow('transient persistence failure');
    const result = await h.service.uploadManuallySignedContract(
      scope,
      term.id,
      dto,
    );
    expect(result.contract.metadata.amendment).toMatchObject({
      state: 'applied',
    });
    expect(h.parent.metadata.effectiveTerms).toMatchObject({
      monthlyValue: '150.00',
    });
    expect(h.documents).toHaveLength(1);
    expect(h.internals.uploadPdfToObjectStorage).toHaveBeenCalledTimes(1);
  });

  it('voids amendment if parent expires before signing', async () => {
    const h = fixture({ validUntil: '2026-10-11' });
    const term = await h.service.createContractTerm(scope, 'parent', {
      kind: ContractDocumentKind.Amendment,
      changes: { monthlyValue: '150', validUntil: '2027-12-31' },
    });
    jest.setSystemTime(new Date('2026-10-12T12:00:00Z'));
    await h.service.uploadManuallySignedContract(scope, term.id, {
      fileBase64: Buffer.from('%PDF').toString('base64'),
    });
    expect(h.parent.validUntil).toBe('2026-10-11');
    expect(h.parent.metadata.effectiveTerms).toBeUndefined();
    expect(
      h.records.find((r) => r.id === term.id)?.metadata.amendment,
    ).toMatchObject({ state: 'void', voidReason: 'parent_expired' });
  });
  it('digital snapshot applies changes using provider signed date, repeat is harmless', async () => {
    const h = fixture({ validUntil: '2026-10-11' });
    const term = await h.service.createContractTerm(scope, 'parent', {
      kind: ContractDocumentKind.Amendment,
      changes: { monthlyValue: '150' },
    });
    const fresh = h.records.find((r) => r.id === term.id)!;
    fresh.signatureProvider = ContractSignatureProvider.Autentique;
    fresh.status = ContractStatus.SentForSignature;
    const snapshot = {
      documentId: 'remote',
      finished: true,
      signedFileUrl: null,
      signers: [
        {
          publicId: 'signer',
          email: 'signer@example.com',
          name: 'Signer',
          signingUrl: null,
          status: 'signed',
          at: '2026-10-11T14:00:00Z',
          reason: null,
        },
      ],
    };
    jest.setSystemTime(new Date('2026-10-13T12:00:00Z'));
    await h.internals.applyAutentiqueSnapshot(scope, fresh, snapshot, {
      source: 'sync',
      actorUserId: 'user',
    });
    expect(h.parent.metadata.effectiveTerms).toMatchObject({
      monthlyValue: '150.00',
    });
    expect(fresh.signedAt).toEqual(new Date('2026-10-11T14:00:00Z'));
    const eventCount = h.events.length;
    await h.internals.applyAutentiqueSnapshot(scope, fresh, snapshot, {
      source: 'webhook',
      actorUserId: null,
    });
    expect(h.events).toHaveLength(eventCount);
  });
  it('termination takes effect upon registration; settlement has no effect', async () => {
    const h = fixture({ validUntil: '2026-12-31' });
    const before = structuredClone(h.parent);
    const settlement = await h.service.createContractTerm(scope, 'parent', {
      kind: ContractDocumentKind.Settlement,
      variablesData: { 'term.settlementAmount': '100' },
    });
    expect(h.parent).toEqual(before);
    expect(settlement.documentKind).toBe('settlement');
    const termination = await h.service.createContractTerm(scope, 'parent', {
      kind: ContractDocumentKind.Termination,
      effectiveDate: '2026-11-01',
    });
    expect(h.parent.metadata.termination).toMatchObject({
      termId: termination.id,
      effectiveDate: '2026-11-01',
    });
    await expect(
      h.service.createContractTerm(scope, 'parent', {
        kind: ContractDocumentKind.Termination,
        effectiveDate: '2026-11-02',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each([
    [{ kind: ContractDocumentKind.Amendment }, 'contract_expired'],
    [
      { kind: ContractDocumentKind.Termination },
      'contract_effective_date_required',
    ],
    [
      {
        kind: ContractDocumentKind.Settlement,
        changes: { monthlyValue: '150' },
      },
      'contract_term_changes_invalid',
    ],
  ] as const)(
    'rejects invalid terms',
    async (dto, code) =>
      await expect(
        fixture().service.createContractTerm(
          scope,
          'parent',
          dto as CreateContractTermDto,
        ),
      ).rejects.toMatchObject({ status: 422, response: { code } }),
  );
  it('rejects wrong template category and rolls back term/termination', async () => {
    const h = fixture({ validUntil: '2026-12-31' });
    h.templates.push(
      Object.assign(new ContractTemplate(), {
        ...scope,
        id: 'template',
        category: 'settlement',
        targetType: ContractTargetType.Client,
        status: ContractTemplateStatus.Active,
      }),
    );
    await expect(
      h.service.createContractTerm(scope, 'parent', {
        kind: ContractDocumentKind.Termination,
        templateId: 'template',
        effectiveDate: '2026-11-01',
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'contract_term_template_invalid' },
    });
    expect(h.records).toHaveLength(1);
    expect(h.events).toHaveLength(0);
    expect(h.parent.metadata.termination).toBeUndefined();
  });
  it('generates term HTML within creation transaction using inherited and term variables', async () => {
    const h = fixture({ validUntil: '2026-12-31' });
    h.templates.push(
      Object.assign(new ContractTemplate(), {
        ...scope,
        id: 'template',
        category: 'settlement',
        targetType: ContractTargetType.Client,
        status: ContractTemplateStatus.Active,
        defaultSignatureMode: ContractSignatureMode.Manual,
        bodyHtml:
          '<p>{{parentContract.title}} / {{term.number}} / {{contract.number}}</p>',
        variablesSchema: {},
      }),
    );
    const term = await h.service.createContractTerm(scope, 'parent', {
      kind: ContractDocumentKind.Settlement,
      templateId: 'template',
      generateHtml: true,
    });
    expect(term.status).toBe('generated');
    expect(term.generatedHtml).toContain('<p>Parent / 1º / 1</p>');
  });
  it('Team signed uploads retain behavior without client attachment metadata', async () => {
    const h = fixture({
      targetType: ContractTargetType.TeamMember,
      metadata: {},
    });
    const result = await h.service.uploadManuallySignedContract(
      scope,
      'parent',
      { fileBase64: Buffer.from('%PDF').toString('base64') },
    );
    expect(result.contract.status).toBe('completed');
    expect(result.contract.metadata.clientContract).toBeUndefined();
  });
  it('filters listContracts to contract by default, all and scoped parent explicitly', async () => {
    const h = fixture();
    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    Object.assign(h.repo, { createQueryBuilder: () => query });
    await h.service.listContracts(scope, {});
    expect(query.andWhere).toHaveBeenCalledWith(
      'contract.document_kind = :documentKind',
      { documentKind: 'contract' },
    );
    query.andWhere.mockClear();
    await h.service.listContracts(scope, {
      documentKind: 'all',
      parentContractId: 'parent',
    });
    expect(query.andWhere).not.toHaveBeenCalledWith(
      'contract.document_kind = :documentKind',
      expect.anything(),
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      'contract.parent_contract_id = :parentContractId',
      { parentContractId: 'parent' },
    );
  });

  it('creates three generic client presets with legal disclaimers', () => {
    const presets = CONTRACT_TEMPLATE_PRESETS.filter((p) =>
      ['client_amendment', 'client_settlement', 'client_termination'].includes(
        p.key,
      ),
    );
    expect(presets).toHaveLength(3);
    for (const p of presets)
      expect(p.legalDisclaimer).toContain('assessoria jurídica');
  });
  it.each([
    ['application/pdf', Buffer.from('%PDF'), 'pdf'],
    ['application/msword', Buffer.from([208, 207, 17, 224]), 'doc'],
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      Buffer.from([80, 75, 3, 4]),
      'docx',
    ],
  ] as const)(
    'stores signed %s with correct extension and principal attachment metadata',
    async (mimeType, buffer, extension) => {
      const h = fixture();
      const result = await h.service.uploadManuallySignedContract(
        scope,
        'parent',
        {
          mimeType,
          fileBase64: buffer.toString('base64'),
          fileName: `signed.${extension}`,
        },
      );
      expect(result.document.fileKey).toMatch(new RegExp(`\\.${extension}$`));
      expect(result.contract.metadata.clientContract).toMatchObject({
        attachedPdf: { documentId: result.document.id, signed: true },
      });
    },
  );
  it('supporting attachments preserve attachedPdf and public listing omits fileKey', async () => {
    const h = fixture();
    await h.service.uploadContractAttachment(scope, 'parent', {
      attachmentKind: 'quote' as never,
      mimeType: 'image/png',
      fileBase64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString(
        'base64',
      ),
    });
    expect(h.parent.metadata.clientContract).toMatchObject({
      attachedPdf: { documentId: 'legacy' },
    });
    const list = await h.service.listDocuments(
      scope,
      'parent',
      ContractDocumentType.Attachment,
    );
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('fileKey');
    expect(list[0]).toMatchObject({ attachmentKind: 'quote' });
  });
});
