import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Repository } from 'typeorm';
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
import { CreateContractTemplateDto } from '../dto/create-contract-template.dto';
import { ContractTargetType, ContractTemplateSource } from '../enums';

describe('contract template AI provenance', () => {
  const payload = {
    name: 'Contrato',
    category: 'client',
    targetType: ContractTargetType.Client,
    bodyHtml: '<p>{{client.name}}</p>',
  };

  it('allows custom and ai_assisted through the whitelist, rejecting other sources', async () => {
    for (const templateSource of ['custom', 'ai_assisted']) {
      expect(
        await validate(
          plainToInstance(CreateContractTemplateDto, {
            ...payload,
            templateSource,
          }),
          { whitelist: true, forbidNonWhitelisted: true },
        ),
      ).toEqual([]);
    }
    expect(
      await validate(
        plainToInstance(CreateContractTemplateDto, {
          ...payload,
          templateSource: 'preset',
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'templateSource' }),
      ]),
    );
  });

  const sources: CreateContractTemplateDto['templateSource'][] = [
    undefined,
    ContractTemplateSource.Custom,
    ContractTemplateSource.AiAssisted,
  ];
  it.each(sources)(
    'persists %s consistently on the template and its initial version',
    async (source) => {
      const templates = {
        create: (data: Partial<ContractTemplate>) =>
          Object.assign(new ContractTemplate(), { id: 'template-id' }, data),
        save: (template: ContractTemplate) => Promise.resolve(template),
      };
      let savedVersion: ContractTemplateVersion | undefined;
      const versions = {
        findOne: () => Promise.resolve(null),
        create: (data: Partial<ContractTemplateVersion>) =>
          Object.assign(new ContractTemplateVersion(), data),
        save: (version: ContractTemplateVersion) => {
          savedVersion = version;
          return Promise.resolve(version);
        },
      };
      const service = new ContractsService(
        templates as unknown as Repository<ContractTemplate>,
        versions as unknown as Repository<ContractTemplateVersion>,
        {} as Repository<ContractSignatureProviderSetting>,
        {} as Repository<ContractRecord>,
        {} as Repository<ContractParty>,
        {} as Repository<ContractDocument>,
        {} as Repository<ContractEvent>,
        {} as ContractNotificationPublisher,
      );
      const template = await service.createTemplate(
        { tenantId: 'tenant', workspaceId: 'workspace', userId: 'user' },
        { ...payload, templateSource: source },
      );
      expect(template.templateSource).toBe(
        source ?? ContractTemplateSource.Custom,
      );
      expect(savedVersion?.templateSource).toBe(
        source ?? ContractTemplateSource.Custom,
      );
    },
  );
});
