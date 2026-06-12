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
import { NotificationActorType } from '../../notifications/enums';
import { ContractNotificationPublisher } from './contract-notification.publisher';
import { ContractsService } from './contracts.service';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  HeadBucketCommand: jest.fn(),
  CreateBucketCommand: jest.fn(),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

describe('ContractsService notification triggers', () => {
  it('publishes canceled after the contract cancellation is persisted', async () => {
    const contract = makeContract({ status: ContractStatus.Generated });
    const { service, publisher, contractsRepository } = makeService({ contract });

    await service.cancelContract(makeContext(), contract.id);

    expect(contractsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: contract.id,
        status: ContractStatus.Cancelled,
      }),
    );
    expect(publisher.publishCanceled).toHaveBeenCalledTimes(1);
    expect(publisher.publishCanceled).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-actor',
        contract: expect.objectContaining({ status: ContractStatus.Cancelled }),
        sourceEventId: 'event-1',
      }),
    );
  });

  it('publishes manual_signature_pending only to real party userIds', async () => {
    const contract = makeContract({ status: ContractStatus.Generated });
    const party = makeParty({ userId: 'user-signer' });
    const { service, publisher } = makeService({ contract, parties: [party] });

    await service.prepareContractSignature(makeContext(), contract.id, {
      signatureMode: ContractSignatureMode.Manual,
    });

    expect(publisher.publishManualSignaturePending).toHaveBeenCalledTimes(1);
    expect(publisher.publishManualSignaturePending).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: [
          expect.objectContaining({
            userId: 'user-signer',
          }),
        ],
      }),
    );
  });

  it('does not publish manual_signature_pending when no party has userId', async () => {
    const contract = makeContract({ status: ContractStatus.Generated });
    const party = makeParty({ userId: null });
    const { service, publisher } = makeService({ contract, parties: [party] });

    await service.prepareContractSignature(makeContext(), contract.id, {
      signatureMode: ContractSignatureMode.Manual,
    });

    expect(publisher.publishManualSignaturePending).not.toHaveBeenCalled();
  });

  it('publishes signed after manual signature confirmation is persisted', async () => {
    const contract = makeContract({
      status: ContractStatus.PendingSignature,
      createdById: 'user-requester',
    });
    const party = makeParty({ userId: 'user-signer' });
    const { service, publisher, contractsRepository } = makeService({
      contract,
      parties: [party],
    });

    await service.markManuallySigned(makeContext(), contract.id, {
      signedAt: '2026-06-12T15:00:00.000Z',
    });

    expect(contractsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: contract.id,
        status: ContractStatus.Completed,
      }),
    );
    expect(publisher.publishSigned).toHaveBeenCalledTimes(1);
    expect(publisher.publishSigned).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-actor',
        contract: expect.objectContaining({
          status: ContractStatus.Completed,
          signedAt: new Date('2026-06-12T15:00:00.000Z'),
        }),
      }),
    );
  });

  it('does not publish signed again on a second manual signature attempt', async () => {
    const contract = makeContract({
      status: ContractStatus.PendingSignature,
      createdById: 'user-requester',
    });
    const party = makeParty({ userId: 'user-signer' });
    const { service, publisher } = makeService({ contract, parties: [party] });

    await service.markManuallySigned(makeContext(), contract.id, {
      signedAt: '2026-06-12T15:00:00.000Z',
    });

    await expect(
      service.markManuallySigned(makeContext(), contract.id, {
        signedAt: '2026-06-12T16:00:00.000Z',
      }),
    ).rejects.toThrow('Contract cannot be marked as manually signed in current status');

    expect(publisher.publishSigned).toHaveBeenCalledTimes(1);
  });

  it('does not publish canceled again on repeated cancellation attempts', async () => {
    const contract = makeContract({ status: ContractStatus.Generated });
    const { service, publisher } = makeService({ contract });

    await service.cancelContract(makeContext(), contract.id);

    await expect(service.cancelContract(makeContext(), contract.id)).rejects.toThrow(
      'Contract cannot be cancelled in current status',
    );

    expect(publisher.publishCanceled).toHaveBeenCalledTimes(1);
  });

  it('publishes signed after a manually signed PDF is uploaded and contract is completed', async () => {
    const contract = makeContract({
      status: ContractStatus.PendingSignature,
      createdById: 'user-requester',
    });
    const party = makeParty({ userId: 'user-signer' });
    const { service, publisher, contractsRepository, documentsRepository } = makeService({
      contract,
      parties: [party],
    });

    const pdfBase64 = Buffer.from('%PDF-1.4 fake signed contract').toString('base64');

    const result = await service.uploadManuallySignedContract(makeContext(), contract.id, {
      fileBase64: pdfBase64,
    });

    expect(documentsRepository.save).toHaveBeenCalledTimes(1);
    expect(contractsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: contract.id,
        status: ContractStatus.Completed,
      }),
    );
    expect(result.contract.status).toBe(ContractStatus.Completed);
    expect(publisher.publishSigned).toHaveBeenCalledTimes(1);
    expect(publisher.publishSigned).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: NotificationActorType.USER,
        actorUserId: 'user-actor',
        contract: expect.objectContaining({ status: ContractStatus.Completed }),
      }),
    );
  });

  describe('sendContractToSignatureProvider', () => {
    function makeDigitalContract(overrides: Partial<ContractRecord> = {}) {
      return makeContract({
        status: ContractStatus.PendingSignature,
        signatureMode: ContractSignatureMode.Digital,
        signatureProvider: ContractSignatureProvider.Autentique,
        ...overrides,
      });
    }

    it('does not call publishSentForSignature when dryRun is true', async () => {
      const contract = makeDigitalContract();
      const party = makeParty({ name: 'Signer', email: 'signer@example.com' });
      const {
        service,
        publisher,
        contractsRepository,
        signatureProviderSettingsRepository,
      } = makeService({ contract, parties: [party] });

      const apiTokenEncrypted = (service as any).encryptSecret('token-value');
      signatureProviderSettingsRepository.findOne.mockResolvedValue(
        makeSettings({ apiTokenEncrypted }),
      );

      const result = await service.sendContractToSignatureProvider(makeContext(), contract.id, {
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(contractsRepository.save).not.toHaveBeenCalled();
      expect(publisher.publishSentForSignature).not.toHaveBeenCalled();
    });

    it('does not call publishSentForSignature when mockProvider is true', async () => {
      const contract = makeDigitalContract();
      const party = makeParty({ name: 'Signer', email: 'signer@example.com' });
      const {
        service,
        publisher,
        contractsRepository,
        signatureProviderSettingsRepository,
      } = makeService({ contract, parties: [party] });

      const apiTokenEncrypted = (service as any).encryptSecret('token-value');
      signatureProviderSettingsRepository.findOne.mockResolvedValue(
        makeSettings({ apiTokenEncrypted }),
      );

      const result = await service.sendContractToSignatureProvider(makeContext(), contract.id, {
        dryRun: false,
        mockProvider: true,
      });

      expect(result.mockProvider).toBe(true);
      expect(contractsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: contract.id,
          status: ContractStatus.SentForSignature,
          metadata: expect.objectContaining({ signatureProviderMode: 'mock' }),
        }),
      );
      expect(publisher.publishSentForSignature).not.toHaveBeenCalled();
    });

    it('throws and does not call the publisher when a real provider call is requested', async () => {
      const contract = makeDigitalContract();
      const party = makeParty({ name: 'Signer', email: 'signer@example.com' });
      const {
        service,
        publisher,
        contractsRepository,
        signatureProviderSettingsRepository,
      } = makeService({ contract, parties: [party] });

      const apiTokenEncrypted = (service as any).encryptSecret('token-value');
      signatureProviderSettingsRepository.findOne.mockResolvedValue(
        makeSettings({ apiTokenEncrypted }),
      );

      await expect(
        service.sendContractToSignatureProvider(makeContext(), contract.id, { dryRun: false }),
      ).rejects.toThrow('Real Autentique API call is not implemented yet');

      expect(contractsRepository.save).not.toHaveBeenCalled();
      expect(publisher.publishSentForSignature).not.toHaveBeenCalled();
    });
  });
});

function makeService(options: {
  contract?: ContractRecord;
  parties?: ContractParty[];
} = {}) {
  const contract = options.contract ?? makeContract();
  const parties = options.parties ?? [makeParty()];
  let eventIndex = 0;
  let documentIndex = 0;

  const contractsRepository = {
    findOne: jest.fn().mockResolvedValue(contract),
    save: jest.fn(async (item: ContractRecord) => item),
  };
  const partiesRepository = {
    find: jest.fn().mockResolvedValue(parties),
  };
  const documentsRepository = {
    findOne: jest.fn().mockResolvedValue(makeDocument()),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((value: Partial<ContractDocument>) => value as ContractDocument),
    save: jest.fn(async (value: Partial<ContractDocument>) => ({
      ...makeDocument(),
      id: `signed-document-${++documentIndex}`,
      ...value,
    })),
  };
  const eventsRepository = {
    create: jest.fn((value: Partial<ContractEvent>) => value),
    save: jest.fn(async (value: Partial<ContractEvent>) => ({
      id: `event-${++eventIndex}`,
      createdAt: new Date('2026-06-12T12:00:00.000Z'),
      ...value,
    })),
    find: jest.fn().mockResolvedValue([]),
  };
  const signatureProviderSettingsRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value: Partial<ContractSignatureProviderSetting>) => value),
    save: jest.fn(async (value: Partial<ContractSignatureProviderSetting>) => ({
      ...makeSettings(),
      ...value,
    })),
  };
  const publisher = {
    publishCanceled: jest.fn(),
    publishManualSignaturePending: jest.fn(),
    publishSigned: jest.fn(),
    publishSentForSignature: jest.fn(),
  } as unknown as jest.Mocked<ContractNotificationPublisher>;

  const service = new ContractsService(
    {} as Repository<ContractTemplate>,
    {} as Repository<ContractTemplateVersion>,
    signatureProviderSettingsRepository as unknown as Repository<ContractSignatureProviderSetting>,
    contractsRepository as unknown as Repository<ContractRecord>,
    partiesRepository as unknown as Repository<ContractParty>,
    documentsRepository as unknown as Repository<ContractDocument>,
    eventsRepository as unknown as Repository<ContractEvent>,
    publisher,
  );

  return {
    service,
    publisher,
    contractsRepository,
    documentsRepository,
    signatureProviderSettingsRepository,
  };
}

function makeContext() {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-actor',
  };
}

function makeContract(overrides: Partial<ContractRecord> = {}): ContractRecord {
  const now = new Date('2026-06-12T12:00:00.000Z');

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
    signatureMode: ContractSignatureMode.Manual,
    signatureProvider: ContractSignatureProvider.None,
    externalDocumentId: null,
    variablesData: {},
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
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'party-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    contractId: 'contract-1',
    role: ContractPartyRole.Client,
    contactId: null,
    userId: 'user-signer',
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
  const now = new Date('2026-06-12T12:00:00.000Z');

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
    sandboxEnabled: false,
    metadata: {},
    createdById: 'user-actor',
    updatedById: 'user-actor',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeDocument(overrides: Partial<ContractDocument> = {}): ContractDocument {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'document-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    contractId: 'contract-1',
    type: ContractDocumentType.GeneratedPdf,
    fileName: 'contract.pdf',
    fileKey: 'contracts/contract.pdf',
    mimeType: 'application/pdf',
    sizeBytes: '100',
    externalUrl: null,
    uploadedById: 'user-actor',
    metadata: {},
    createdAt: now,
    ...overrides,
  };
}
