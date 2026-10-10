import { createHmac } from 'crypto';
import { Repository } from 'typeorm';
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
  ContractDocumentType,
  ContractEventType,
  ContractPartyRole,
  ContractPartySignatureStatus,
  ContractSignatureMode,
  ContractSignatureProvider,
  ContractStatus,
  ContractTargetType,
} from '../enums';
import {
  AutentiqueApiError,
  type AutentiqueClient,
} from '../autentique/autentique.client';
import { ContractNotificationPublisher } from './contract-notification.publisher';
import { ContractsService } from './contracts.service';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      Body: [Buffer.from('%PDF-1.4 contrato')],
    }),
  })),
  HeadBucketCommand: jest.fn(),
  CreateBucketCommand: jest.fn(),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

const WEBHOOK_SECRET = 'whsec_test';

// Private seams of the service exercised by these specs.
type ServiceInternals = {
  encryptSecret(value: string): string;
  decryptSecret(value: string): string;
  createAutentiqueClient(
    settings: ContractSignatureProviderSetting,
  ): AutentiqueClient;
};

function internals(service: ContractsService) {
  return service as unknown as ServiceInternals;
}

type CreateDocumentInput = Parameters<AutentiqueClient['createDocument']>[0];

describe('ContractsService — Autentique', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('sendContractToSignatureProvider', () => {
    it('validates only on dryRun: no claim, no provider call, no writes', async () => {
      const harness = makeHarness();

      const result = await harness.service.sendContractToSignatureProvider(
        context(),
        'contract-1',
        { dryRun: true },
      );

      expect(result).toEqual(
        expect.objectContaining({
          dryRun: true,
          readyToSend: true,
          sandbox: true,
        }),
      );
      expect(harness.queryBuilder.execute).not.toHaveBeenCalled();
      expect(harness.client.createDocument).not.toHaveBeenCalled();
      expect(harness.contractsRepository.update).not.toHaveBeenCalled();
      expect(harness.publisher.publishSentForSignature).not.toHaveBeenCalled();
    });

    it('refuses with 409 a contract that already has an Autentique document', async () => {
      const harness = makeHarness({
        contract: makeContract({ externalDocumentId: 'doc-existing' }),
      });

      await expect(
        harness.service.sendContractToSignatureProvider(
          context(),
          'contract-1',
          {},
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(harness.client.createDocument).not.toHaveBeenCalled();
    });

    it('refuses with 409 while another send holds the claim', async () => {
      const harness = makeHarness();
      harness.queryBuilder.execute.mockResolvedValueOnce({ affected: 0 });

      await expect(
        harness.service.sendContractToSignatureProvider(
          context(),
          'contract-1',
          {},
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(harness.client.createDocument).not.toHaveBeenCalled();
    });

    it('reports missing signer data before touching the provider', async () => {
      const harness = makeHarness({
        contract: makeContract({
          variablesData: { 'client.signatory': 'Carlos' },
        }),
      });

      await expect(
        harness.service.sendContractToSignatureProvider(
          context(),
          'contract-1',
          {},
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(harness.client.createDocument).not.toHaveBeenCalled();
    });

    it('derives the parties, sends for real and records the external id first', async () => {
      const harness = makeHarness();

      const result = await harness.service.sendContractToSignatureProvider(
        context(),
        'contract-1',
        { message: 'Por favor, assine' },
      );

      // Parties derived from the contract variables.
      expect(harness.partiesRepository.save).toHaveBeenCalledTimes(2);

      expect(harness.client.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Contrato de prestacao de servicos',
          sandbox: true,
          message: 'Por favor, assine',
          signers: [
            { name: 'Ana Agência', email: 'ana@agencia.com' },
            { name: 'Carlos Cliente', email: 'carlos@cliente.com' },
          ],
        }),
      );
      const [sent] = harness.client.createDocument.mock.calls[0] as [
        CreateDocumentInput,
      ];
      expect(sent.pdf.subarray(0, 4).toString()).toBe('%PDF');

      // The id is persisted before any party is updated.
      const idWrite = harness.contractsRepository.update.mock.calls.findIndex(
        ([, patch]) => patch.externalDocumentId === 'doc-1',
      );
      expect(idWrite).toBeGreaterThanOrEqual(0);
      expect(
        harness.contractsRepository.update.mock.invocationCallOrder[idWrite],
      ).toBeLessThan(
        harness.partiesRepository.update.mock.invocationCallOrder[0],
      );
      expect(harness.contractsRepository.update.mock.calls[idWrite][1]).toEqual(
        expect.objectContaining({
          status: ContractStatus.SentForSignature,
          metadata: expect.objectContaining({
            signatureProviderMode: 'sandbox',
          }),
        }),
      );

      expect(harness.partiesRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'party-2' }),
        expect.objectContaining({
          signatureStatus: ContractPartySignatureStatus.Sent,
          metadata: expect.objectContaining({
            externalSignerId: 'sig-client',
            signingUrl: 'https://autentique.com.br/s/abc',
          }),
        }),
      );

      expect(harness.eventsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: ContractEventType.SignatureSent }),
      );
      expect(harness.publisher.publishSentForSignature).toHaveBeenCalledTimes(
        1,
      );
      expect(result).toEqual(
        expect.objectContaining({ sent: true, externalDocumentId: 'doc-1' }),
      );
    });

    it('frees the claim after a definite rejection by Autentique', async () => {
      const harness = makeHarness();
      harness.client.createDocument.mockRejectedValueOnce(
        new AutentiqueApiError('validation', 'graphql', 200),
      );

      await expect(
        harness.service.sendContractToSignatureProvider(
          context(),
          'contract-1',
          {},
        ),
      ).rejects.toMatchObject({ status: 400 });

      const metadataSql = metadataSqlOf(harness);
      expect(
        metadataSql.some((sql) => sql.includes("- 'autentiqueSendLockAt'")),
      ).toBe(true);
      expect(harness.publisher.publishSentForSignature).not.toHaveBeenCalled();
    });

    it('keeps the claim (marked uncertain) when the outcome is unknown', async () => {
      const harness = makeHarness();
      harness.client.createDocument.mockRejectedValueOnce(
        new AutentiqueApiError('timeout', 'timeout'),
      );

      await expect(
        harness.service.sendContractToSignatureProvider(
          context(),
          'contract-1',
          {},
        ),
      ).rejects.toMatchObject({ status: 502 });

      const metadataSql = metadataSqlOf(harness);
      expect(
        metadataSql.some((sql) => sql.includes('autentiqueSendUncertainAt')),
      ).toBe(true);
      expect(
        metadataSql.some((sql) => sql.includes("- 'autentiqueSendLockAt'")),
      ).toBe(false);
    });
  });

  describe('handleAutentiqueWebhook', () => {
    function signedBody(payload: unknown, secret = WEBHOOK_SECRET) {
      const raw = Buffer.from(JSON.stringify(payload));
      return {
        raw,
        signature: createHmac('sha256', secret).update(raw).digest('hex'),
      };
    }

    const viewedEvent = {
      event: {
        id: 'evt-1',
        type: 'signature.viewed',
        data: {
          public_id: 'sig-client',
          document: 'doc-1',
          user: { email: 'carlos@cliente.com' },
          viewed: '2026-10-10T12:00:00.000000Z',
        },
      },
    };

    it('returns 401 when the tenant has no webhook secret', async () => {
      const harness = makeHarness({ webhookSecret: null });
      const { raw, signature } = signedBody(viewedEvent);

      await expect(
        harness.service.handleAutentiqueWebhook('settings-1', raw, signature),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('returns 401 for a missing or invalid signature', async () => {
      const harness = makeHarness();
      const { raw } = signedBody(viewedEvent);
      const forged = signedBody(viewedEvent, 'wrong-secret').signature;

      await expect(
        harness.service.handleAutentiqueWebhook('settings-1', raw, undefined),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        harness.service.handleAutentiqueWebhook('settings-1', raw, forged),
      ).rejects.toMatchObject({ status: 401 });
      expect(harness.contractsRepository.findOne).not.toHaveBeenCalled();
    });

    it('applies a valid event to the matching party', async () => {
      const harness = makeHarness({
        contract: makeContract({
          status: ContractStatus.SentForSignature,
          externalDocumentId: 'doc-1',
          signatureProvider: ContractSignatureProvider.Autentique,
        }),
        parties: sentParties(),
      });
      const { raw, signature } = signedBody(viewedEvent);

      const result = await harness.service.handleAutentiqueWebhook(
        'settings-1',
        raw,
        signature,
      );

      expect(result).toEqual({ received: true, handled: true, changed: true });
      expect(harness.partiesRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'party-2' }),
        expect.objectContaining({
          signatureStatus: ContractPartySignatureStatus.Viewed,
        }),
      );
      expect(harness.eventsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ContractEventType.SignatureStatusUpdated,
          actorUserId: null,
          metadata: expect.objectContaining({ providerEventId: 'evt-1' }),
        }),
      );
      expect(harness.publisher.publishViewed).toHaveBeenCalledTimes(1);
    });

    it('skips an event id that was already processed', async () => {
      const harness = makeHarness({
        contract: makeContract({
          status: ContractStatus.SentForSignature,
          externalDocumentId: 'doc-1',
          signatureProvider: ContractSignatureProvider.Autentique,
        }),
        parties: sentParties(),
      });
      harness.eventsRepository.findOne.mockResolvedValueOnce({
        id: 'event-old',
      });
      const { raw, signature } = signedBody(viewedEvent);

      const result = await harness.service.handleAutentiqueWebhook(
        'settings-1',
        raw,
        signature,
      );

      expect(result).toEqual({
        received: true,
        handled: false,
        reason: 'duplicate',
      });
      expect(harness.partiesRepository.update).not.toHaveBeenCalled();
    });

    it('acknowledges events for unknown documents without changes', async () => {
      const harness = makeHarness();
      harness.contractsRepository.findOne.mockResolvedValueOnce(null);
      const { raw, signature } = signedBody(viewedEvent);

      await expect(
        harness.service.handleAutentiqueWebhook('settings-1', raw, signature),
      ).resolves.toEqual({
        received: true,
        handled: false,
        reason: 'unknown_document',
      });
    });
  });

  describe('testSignatureProviderSettings', () => {
    it('calls me() and returns the account without the token', async () => {
      const harness = makeHarness();

      const result = await harness.service.testSignatureProviderSettings(
        context(),
        ContractSignatureProvider.Autentique,
      );

      expect(harness.client.me).toHaveBeenCalledTimes(1);
      expect(result).toEqual(
        expect.objectContaining({
          ok: true,
          account: { name: 'Agência Lyra', email: 'ops@agencia.com' },
        }),
      );
      expect(JSON.stringify(result)).not.toContain('token-value');
    });
  });

  describe('secret encryption key', () => {
    it('fails closed in production without a configured key', () => {
      const harness = makeHarness();
      delete process.env.CONTRACTS_PROVIDER_ENCRYPTION_KEY;
      delete process.env.SETTINGS_ENCRYPTION_KEY;
      process.env.NODE_ENV = 'production';

      expect(() => internals(harness.service).encryptSecret('x')).toThrow(
        'encryption key is not configured',
      );
    });

    it('keeps the development fallback outside production', () => {
      const harness = makeHarness();
      delete process.env.CONTRACTS_PROVIDER_ENCRYPTION_KEY;
      delete process.env.SETTINGS_ENCRYPTION_KEY;
      process.env.NODE_ENV = 'test';

      const encrypted = internals(harness.service).encryptSecret('x');
      expect(internals(harness.service).decryptSecret(encrypted)).toBe('x');
    });
  });
});

function metadataSqlOf(harness: ReturnType<typeof makeHarness>) {
  const calls = harness.queryBuilder.set.mock.calls as Array<
    [{ metadata: () => string }]
  >;
  return calls.map(([value]) => value.metadata());
}

function context() {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-actor',
  };
}

function sentParties() {
  return [
    makeParty({
      id: 'party-1',
      role: ContractPartyRole.Company,
      email: 'ana@agencia.com',
      signatureStatus: ContractPartySignatureStatus.Sent,
      metadata: { externalSignerId: 'sig-agency' },
    }),
    makeParty({
      id: 'party-2',
      role: ContractPartyRole.Client,
      email: 'carlos@cliente.com',
      signatureStatus: ContractPartySignatureStatus.Sent,
      metadata: { externalSignerId: 'sig-client' },
    }),
  ];
}

function makeHarness(
  options: {
    contract?: ContractRecord;
    parties?: ContractParty[];
    webhookSecret?: string | null;
  } = {},
) {
  process.env.NODE_ENV = 'test';
  const contract = options.contract ?? makeContract();
  let parties = options.parties ?? [];
  let eventIndex = 0;
  let partyIndex = 0;

  const queryBuilder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const contractsRepository = {
    findOne: jest.fn(() =>
      Promise.resolve<ContractRecord | null>({ ...contract }),
    ),
    save: jest.fn((item: ContractRecord) => Promise.resolve(item)),
    update: jest.fn<
      Promise<{ affected: number }>,
      [Record<string, unknown>, Partial<ContractRecord>]
    >(() => Promise.resolve({ affected: 1 })),
    createQueryBuilder: jest.fn(() => queryBuilder),
  };

  const partiesRepository = {
    find: jest.fn(() => Promise.resolve(parties)),
    create: jest.fn((value: Partial<ContractParty>) => value),
    save: jest.fn((value: Partial<ContractParty>) => {
      const saved = makeParty({ ...value, id: `party-${++partyIndex}` });
      parties = [...parties, saved];
      return Promise.resolve(saved);
    }),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
  };

  const documentsRepository = {
    findOne: jest.fn().mockResolvedValue(makeDocument()),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((value: Partial<ContractDocument>) => value),
    save: jest.fn((value: Partial<ContractDocument>) =>
      Promise.resolve({ ...makeDocument(), ...value }),
    ),
  };

  const eventsRepository = {
    create: jest.fn((value: Partial<ContractEvent>) => value),
    save: jest.fn((value: Partial<ContractEvent>) =>
      Promise.resolve({
        id: `event-${++eventIndex}`,
        createdAt: new Date('2026-10-10T12:00:00.000Z'),
        ...value,
      }),
    ),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(() => Promise.resolve<{ id: string } | null>(null)),
  };

  const signatureProviderSettingsRepository = {
    findOne: jest.fn(),
    create: jest.fn(
      (value: Partial<ContractSignatureProviderSetting>) => value,
    ),
    save: jest.fn((value: Partial<ContractSignatureProviderSetting>) =>
      Promise.resolve(value),
    ),
  };

  const publisher = {
    publishSentForSignature: jest.fn(),
    publishViewed: jest.fn(),
    publishRejected: jest.fn(),
    publishSigned: jest.fn(),
    publishProviderFailed: jest.fn(),
    publishCanceled: jest.fn(),
    publishManualSignaturePending: jest.fn(),
  };

  const service = new ContractsService(
    {} as Repository<ContractTemplate>,
    {} as Repository<ContractTemplateVersion>,
    signatureProviderSettingsRepository as unknown as Repository<ContractSignatureProviderSetting>,
    contractsRepository as unknown as Repository<ContractRecord>,
    partiesRepository as unknown as Repository<ContractParty>,
    documentsRepository as unknown as Repository<ContractDocument>,
    eventsRepository as unknown as Repository<ContractEvent>,
    publisher as unknown as ContractNotificationPublisher,
  );

  const seams = internals(service);
  signatureProviderSettingsRepository.findOne.mockResolvedValue(
    makeSettings({
      apiTokenEncrypted: seams.encryptSecret('token-value'),
      webhookSecretEncrypted:
        options.webhookSecret === null
          ? null
          : seams.encryptSecret(options.webhookSecret ?? WEBHOOK_SECRET),
    }),
  );

  // Never reach the real Autentique API from a spec.
  const client = {
    me: jest.fn().mockResolvedValue({
      id: '1',
      name: 'Agência Lyra',
      email: 'ops@agencia.com',
    }),
    createDocument: jest.fn().mockResolvedValue({
      id: 'doc-1',
      signatures: [
        { public_id: 'sig-agency', email: 'ana@agencia.com', link: null },
        {
          public_id: 'sig-client',
          email: 'carlos@cliente.com',
          link: { short_link: 'https://autentique.com.br/s/abc' },
        },
      ],
    }),
    getDocument: jest.fn(),
    downloadFile: jest.fn(),
  };
  jest
    .spyOn(seams, 'createAutentiqueClient')
    .mockReturnValue(client as unknown as AutentiqueClient);

  return {
    service,
    client,
    publisher,
    queryBuilder,
    contractsRepository,
    partiesRepository,
    documentsRepository,
    eventsRepository,
  };
}

function makeContract(overrides: Partial<ContractRecord> = {}): ContractRecord {
  const now = new Date('2026-10-10T12:00:00.000Z');
  return {
    id: 'contract-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    title: 'Contrato de prestacao de servicos',
    targetType: ContractTargetType.Client,
    targetId: 'client-1',
    templateId: null,
    templateVersionId: null,
    status: ContractStatus.Generated,
    signatureMode: ContractSignatureMode.Digital,
    signatureProvider: ContractSignatureProvider.None,
    externalDocumentId: null,
    variablesData: {
      'agency.signerName': 'Ana Agência',
      'agency.signerEmail': 'ana@agencia.com',
      'client.signatory': 'Carlos Cliente',
      'client.signatory.email': 'carlos@cliente.com',
    },
    generatedHtml: '<p>Contrato</p>',
    validFrom: null,
    validUntil: null,
    signedAt: null,
    completedAt: null,
    cancelledAt: null,
    archivedAt: null,
    createdById: 'user-requester',
    updatedById: 'user-actor',
    cancelledById: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeParty(overrides: Partial<ContractParty> = {}): ContractParty {
  const now = new Date('2026-10-10T12:00:00.000Z');
  return {
    id: 'party-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    contractId: 'contract-1',
    role: ContractPartyRole.Client,
    contactId: null,
    userId: null,
    name: 'Signer',
    email: 'signer@example.com',
    document: null,
    signatureStatus: ContractPartySignatureStatus.Pending,
    signedAt: null,
    signatureOrder: 1,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSettings(
  overrides: Partial<ContractSignatureProviderSetting> = {},
): ContractSignatureProviderSetting {
  const now = new Date('2026-10-10T12:00:00.000Z');
  return {
    id: 'settings-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    provider: ContractSignatureProvider.Autentique,
    status: 'active',
    apiBaseUrl: 'https://api.autentique.com.br/v2',
    apiTokenEncrypted: null,
    webhookSecretEncrypted: null,
    defaultSignatureMode: ContractSignatureMode.Digital,
    sandboxEnabled: true,
    metadata: {},
    createdById: 'user-actor',
    updatedById: 'user-actor',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeDocument(
  overrides: Partial<ContractDocument> = {},
): ContractDocument {
  const now = new Date('2026-10-10T12:00:00.000Z');
  return {
    id: 'document-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    contractId: 'contract-1',
    type: ContractDocumentType.GeneratedPdf,
    fileName: 'contrato.pdf',
    fileKey: 'contracts/contrato.pdf',
    mimeType: 'application/pdf',
    sizeBytes: '100',
    externalUrl: null,
    uploadedById: 'user-actor',
    metadata: {},
    createdAt: now,
    ...overrides,
  };
}
