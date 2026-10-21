import {
  Global,
  Injectable,
  Module,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import type { ClientAreaContext } from '../../modules/client-area/client-area.types';
import type { AuditChangeInput } from '../../modules/client-area/services/audit-change.service';

export type ClientAreaOAuthBinding = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string;
  userId: string;
  sessionId: string;
  companyContextId: string;
  module: 'social_campaigns' | 'social_planner' | 'leadflow_inbox';
};
export type SettingsOperation = (
  context: ClientAreaContext,
  input: unknown,
) => Promise<unknown>;

/** Consumer-owned callbacks, registered at init. No third-party DI aliases. */
@Injectable()
export class ClientAreaSettingsRegistry {
  private readonly operations = new Map<string, SettingsOperation>();
  private validateBinding?: (binding: ClientAreaOAuthBinding) => Promise<void>;
  private auditWriter?: (input: AuditChangeInput) => Promise<void>;
  register(key: string, operation: SettingsOperation) {
    if (this.operations.has(key))
      throw new Error(`Settings operation already registered: ${key}`);
    this.operations.set(key, operation);
  }
  call(key: string, context: ClientAreaContext, input: unknown = undefined) {
    const operation = this.operations.get(key);
    if (!operation)
      throw new ServiceUnavailableException(
        'Product settings are unavailable.',
      );
    return operation(context, input).catch((error: unknown) => {
      if (
        error instanceof BadRequestException &&
        ['invalid_session', 'invalid_connection'].includes(error.message)
      )
        throw new NotFoundException('Resource is unavailable.');
      if (key.startsWith('integrations.')) {
        const status = error instanceof HttpException ? error.getStatus() : 503;
        throw new HttpException(
          {
            statusCode: status,
            code: 'client_area_integration_request_failed',
            message: 'Unable to complete the integration request.',
          },
          status,
        );
      }
      throw error;
    });
  }
  registerOAuthValidator(
    validate: (binding: ClientAreaOAuthBinding) => Promise<void>,
  ) {
    if (this.validateBinding)
      throw new Error('OAuth validator already registered.');
    this.validateBinding = validate;
  }
  async assertOAuthBinding(
    value: unknown,
    expected: {
      tenantId: string;
      workspaceId?: string;
      agencyClientId?: string | null;
      companyContextId: string | null;
      userId?: string | null;
    },
  ) {
    if (!value || typeof value !== 'object')
      throw new UnauthorizedException('Invalid Client Area OAuth binding.');
    const binding = value as ClientAreaOAuthBinding;
    if (
      ![
        binding.tenantId,
        binding.workspaceId,
        binding.agencyClientId,
        binding.userId,
        binding.sessionId,
        binding.companyContextId,
      ].every((part) => typeof part === 'string' && part.length > 0) ||
      !['social_campaigns', 'social_planner', 'leadflow_inbox'].includes(
        binding.module,
      )
    )
      throw new UnauthorizedException('Invalid Client Area OAuth binding.');
    if (
      !this.validateBinding ||
      binding.tenantId !== expected.tenantId ||
      (expected.workspaceId !== undefined &&
        binding.workspaceId !== expected.workspaceId) ||
      (expected.agencyClientId !== undefined &&
        binding.agencyClientId !== expected.agencyClientId) ||
      binding.companyContextId !== expected.companyContextId ||
      (expected.userId !== undefined && binding.userId !== expected.userId)
    )
      throw new UnauthorizedException('Invalid Client Area OAuth binding.');
    await this.validateBinding(binding);
  }
  registerAuditWriter(writer: (input: AuditChangeInput) => Promise<void>) {
    if (this.auditWriter) throw new Error('Audit writer already registered.');
    this.auditWriter = writer;
  }
  record(input: AuditChangeInput) {
    return this.auditWriter?.(input) ?? Promise.resolve();
  }
}

@Global()
@Module({
  providers: [ClientAreaSettingsRegistry],
  exports: [ClientAreaSettingsRegistry],
})
export class ClientAreaSettingsRegistryModule {}
