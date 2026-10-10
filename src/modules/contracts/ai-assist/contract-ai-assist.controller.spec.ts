import { ValidationPipe } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ContractAiAssistController } from './contract-ai-assist.controller';
import { ContractAiAssistDto } from './contract-ai-assist.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../permissions';
import { PERMISSION_KEY_METADATA } from '../../permissions/decorators/permissions.decorators';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ContractAiAssistController contract', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const validate = (value: unknown) =>
    pipe.transform(value, { type: 'body', metatype: ContractAiAssistDto });

  it('protects the route with the existing authentication and template-management permission, returning 200', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ContractAiAssistController)).toBe(
      'agency/contracts/templates/ai-assist',
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ContractAiAssistController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
    const method = Object.getOwnPropertyDescriptor(
      ContractAiAssistController.prototype,
      'assist',
    )!.value as object;
    expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, method)).toBe(
      'agency.contracts.templates.manage.admin',
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, method)).toBe(200);
  });

  it('registers the specific controller before the parameterized contracts routes', () => {
    const module = readFileSync(
      resolve(__dirname, '../contracts.module.ts'),
      'utf8',
    );
    const controllers = module.match(/controllers:\s*\[([^\]]*)\]/)?.[1] ?? '';
    expect(
      controllers.indexOf('ContractAiAssistController'),
    ).toBeGreaterThanOrEqual(0);
    expect(controllers.indexOf('ContractAiAssistController')).toBeLessThan(
      controllers.indexOf('ContractsController'),
    );
  });

  it('accepts source text, HTML and nested category options', async () => {
    await expect(
      validate({
        sourceText: 'Contract',
        targetType: 'client',
        categoryOptions: [{ value: 'id', label: 'Serviços' }],
      }),
    ).resolves.toBeInstanceOf(ContractAiAssistDto);
    await expect(
      validate({ sourceHtml: '<p>Contract</p>', targetType: 'client' }),
    ).resolves.toBeInstanceOf(ContractAiAssistDto);
  });

  it.each([
    { sourceText: 'Contract', targetType: 'team_member' },
    { sourceText: null, targetType: 'client' },
    { sourceText: 'Contract', targetType: 'client', tenantId: 'forged' },
    {
      sourceText: 'Contract',
      targetType: 'client',
      categoryOptions: Array.from({ length: 31 }, () => ({
        value: 'id',
        label: 'Name',
      })),
    },
    {
      sourceText: 'Contract',
      targetType: 'client',
      categoryOptions: [{ value: 'id', label: 'Name', extra: 'forged' }],
    },
  ])(
    'rejects unsupported targets, forged context and invalid category payloads',
    async (invalid) => {
      await expect(validate(invalid)).rejects.toHaveProperty('status', 400);
    },
  );
});
