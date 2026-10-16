import { PATH_METADATA } from '@nestjs/common/constants';
import { ContractsController } from './contracts.controller';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RenewContractDto } from '../dto/renew-contract.dto';
import {
  ContractDefaultsQueryDto,
  UpdateContractDefaultsDto,
} from '../dto/update-contract-defaults.dto';
import { CreateContractTermDto } from '../dto/create-contract-term.dto';
import { UploadContractAttachmentDto } from '../dto/upload-contract-attachment.dto';
import { UploadManuallySignedContractDto } from '../dto/upload-manually-signed-contract.dto';
import { ListContractsQueryDto } from '../dto';
import { ContractAdjustmentIndexQueryDto } from '../dto/contract-adjustment-index-query.dto';
import { ContractDocumentKind } from '../enums';
it('declares static contract routes before :id', () => {
  const routes = Object.getOwnPropertyNames(ContractsController.prototype).map(
    (name) =>
      Reflect.getMetadata(
        PATH_METADATA,
        (
          ContractsController.prototype as unknown as Record<
            string,
            (...args: unknown[]) => unknown
          >
        )[name],
      ) as unknown,
  );
  expect(routes.indexOf('defaults')).toBeLessThan(routes.indexOf(':id'));
  expect(routes.indexOf('adjustment-index')).toBeLessThan(
    routes.indexOf(':id'),
  );
});
it('permits all E3 payload fields through the production whitelist', async () => {
  const pairs = [
    [
      RenewContractDto,
      {
        periodMode: 'custom',
        validFrom: '2026-10-12',
        validUntil: '2027-10-11',
        valueMode: 'percent',
        adjustmentPercent: 4.1234,
        adjustmentSource: 'bcb_sgs',
        indexPeriod: { start: '2025-10', end: '2026-09' },
      },
    ],
    [
      UpdateContractDefaultsDto,
      {
        targetType: 'client',
        values: {},
        presets: {},
        expectedVersion: 0,
        expiringWindowDays: 30,
      },
    ],
    [
      CreateContractTermDto,
      {
        kind: 'amendment',
        changes: { monthlyValue: '1200.005', validUntil: '2027-10-11' },
        generateHtml: true,
      },
    ],
    [
      UploadContractAttachmentDto,
      { fileBase64: 'JVBERg==', attachmentKind: 'quote' },
    ],
    [
      ListContractsQueryDto,
      {
        documentKind: 'all',
        parentContractId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      },
    ],
    [ContractAdjustmentIndexQueryDto, { index: 'ipca', until: '2026-09' }],
  ] as const;
  for (const [type, payload] of pairs)
    expect(
      await validate(plainToInstance(type as new () => object, payload), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toEqual([]);
});
it.each(['client', 'team_member'])(
  'permits %s contract defaults through the production whitelist',
  async (targetType) => {
    const options = { whitelist: true, forbidNonWhitelisted: true };
    expect(
      await validate(
        plainToInstance(ContractDefaultsQueryDto, { targetType }),
        options,
      ),
    ).toEqual([]);
    expect(
      await validate(
        plainToInstance(UpdateContractDefaultsDto, {
          targetType,
          values: {},
          presets: {},
        }),
        options,
      ),
    ).toEqual([]);
  },
);
it.each([
  { targetType: 'lead', values: {}, presets: {} },
  { targetType: 'client', values: {}, presets: {}, expiringWindowDays: 181 },
])('rejects invalid contract defaults: %j', async (payload) => {
  expect(
    await validate(plainToInstance(UpdateContractDefaultsDto, payload)),
  ).not.toEqual([]);
});
it('rejects excessive percent precision and attachment kinds', async () => {
  for (const adjustmentPercent of [-100, 1000.1, 1.12345])
    expect(
      await validate(
        plainToInstance(RenewContractDto, {
          periodMode: 'same',
          valueMode: 'percent',
          adjustmentPercent,
        }),
      ),
    ).not.toEqual([]);
  expect(
    await validate(
      plainToInstance(UploadContractAttachmentDto, {
        fileBase64: 'JVBERg==',
        attachmentKind: 'invalid',
      }),
    ),
  ).not.toEqual([]);
  expect(
    await validate(
      plainToInstance(UploadManuallySignedContractDto, {
        fileBase64: 'JVBERg==',
        attachmentKind: 'quote',
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    ),
  ).not.toEqual([]);
  expect(
    await validate(
      plainToInstance(ListContractsQueryDto, {
        documentKind: ContractDocumentKind.Amendment,
      }),
    ),
  ).toEqual([]);
});

it('separates template use from template/defaults management permissions', () => {
  const permission = (method: keyof ContractsController) =>
    Reflect.getMetadata(
      'permissions:permission_key',
      ContractsController.prototype[method],
    ) as unknown;
  for (const method of [
    'listTemplates',
    'findTemplate',
    'getDefaults',
    'getAdjustmentIndex',
    'renew',
    'createTerm',
  ] as const)
    expect(permission(method)).toBe('agency.contracts.create.from_template');
  for (const method of [
    'createTemplate',
    'updateTemplate',
    'activateTemplate',
    'archiveTemplate',
    'deleteTemplate',
    'putDefaults',
  ] as const)
    expect(permission(method)).toBe('agency.contracts.templates.manage.admin');
});
