import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { AgencyClient } from '../../modules/clients/entities';
import { AgencyClientCompanyContext } from '../../modules/clients/entities/agency-client-company-context.entity';
import { AgencyClientStatus } from '../../modules/clients/enums';
import { ContactEntity } from '../../modules/contacts/entities/contact.entity';
import type {
  ManagedContext,
  OperatingMode,
  ProductKey,
} from './request-context.interface';

const AGENCY_CONNECTION = 'agency';
const PRODUCT_KEYS = new Set<ProductKey>(['agency', 'leadflow', 'social']);
const OPERATING_MODES = new Set<OperatingMode>(['agency', 'client']);

type ResolveInput = {
  request: Request;
  tenantId: string;
  workspaceId?: string | null;
};

@Injectable()
export class OperationalContextResolver {
  constructor(
    @InjectRepository(AgencyClient, AGENCY_CONNECTION)
    private readonly clientsRepository: Repository<AgencyClient>,
    @InjectRepository(AgencyClientCompanyContext, AGENCY_CONNECTION)
    private readonly companyContextsRepository: Repository<AgencyClientCompanyContext>,
    @InjectRepository(ContactEntity, AGENCY_CONNECTION)
    private readonly contactsRepository: Repository<ContactEntity>,
  ) {}

  async resolve(input: ResolveInput): Promise<ManagedContext> {
    const productKey = this.resolveProductKey(input.request);
    const operatingMode = this.resolveOperatingMode(input.request);
    const clientId = this.readHeader(input.request, [
      'x-lyra-client-id',
      'x-client-id',
    ]);
    const companyContextId = this.readHeader(input.request, [
      'x-lyra-company-context-id',
    ]);

    if (productKey === 'agency') {
      return this.agencyContext(productKey);
    }

    if (operatingMode === 'agency') {
      return {
        productKey,
        operatingMode,
        clientId: null,
        companyContextId: null,
        managedTenantId: null,
      };
    }

    if (!clientId) {
      throw new BadRequestException(
        companyContextId
          ? 'A valid client context is required for the requested company context.'
          : 'x-lyra-client-id or x-client-id is required for client operating mode.',
      );
    }

    if (!input.workspaceId) {
      throw new BadRequestException(
        'Workspace context is required for client operating mode.',
      );
    }

    const client = await this.clientsRepository.findOne({
      where: {
        id: clientId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
      },
    });

    if (
      !client ||
      client.archivedAt ||
      client.status !== AgencyClientStatus.Active
    ) {
      throw new BadRequestException(
        'Client is not active or does not belong to this workspace.',
      );
    }

    let validatedCompanyContextId: string | null = null;
    if (companyContextId) {
      const companyContext = await this.companyContextsRepository.findOne({
        where: {
          id: companyContextId,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          agencyClientId: client.id,
        },
      });

      // Keep all missing, foreign-client, and cross-scope ids indistinguishable.
      if (
        !companyContext ||
        companyContext.agencyClientId !== client.id ||
        companyContext.tenantId !== input.tenantId ||
        companyContext.workspaceId !== input.workspaceId ||
        companyContext.status !== 'active' ||
        companyContext.archivedAt
      ) {
        throw new BadRequestException(
          'Company context is not available for this client and workspace.',
        );
      }

      const companyContact = await this.contactsRepository.findOne({
        where: {
          id: companyContext.companyContactId,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
        },
      });
      if (
        !companyContact ||
        companyContact.tenantId !== input.tenantId ||
        companyContact.workspaceId !== input.workspaceId ||
        companyContact.type !== 'organization' ||
        companyContact.status === 'archived'
      ) {
        throw new BadRequestException(
          'Company context is not available for this client and workspace.',
        );
      }

      validatedCompanyContextId = companyContext.id;
    }

    return {
      productKey,
      operatingMode,
      clientId: client.id,
      companyContextId: validatedCompanyContextId,
      managedTenantId: client.managedTenantId,
      clientName: client.displayName,
    };
  }

  private agencyContext(productKey: ProductKey): ManagedContext {
    return {
      productKey,
      operatingMode: 'agency',
      clientId: null,
      companyContextId: null,
      managedTenantId: null,
    };
  }

  private resolveProductKey(request: Request): ProductKey {
    const explicitProductKey = this.readHeader(request, ['x-lyra-product-key']);

    if (explicitProductKey) {
      if (!PRODUCT_KEYS.has(explicitProductKey as ProductKey)) {
        throw new BadRequestException(
          `Invalid x-lyra-product-key: ${explicitProductKey}.`,
        );
      }

      return explicitProductKey as ProductKey;
    }

    const leadflowMode = this.readHeader(request, [
      'x-leadflow-operating-mode',
    ]);

    if (leadflowMode) {
      return 'leadflow';
    }

    return 'agency';
  }

  private resolveOperatingMode(request: Request): OperatingMode {
    const rawMode =
      this.readHeader(request, ['x-lyra-operating-mode']) ??
      this.readHeader(request, ['x-leadflow-operating-mode']) ??
      'agency';

    if (!OPERATING_MODES.has(rawMode as OperatingMode)) {
      throw new BadRequestException(`Invalid operating mode: ${rawMode}.`);
    }

    return rawMode as OperatingMode;
  }

  private readHeader(request: Request, names: string[]): string | null {
    for (const name of names) {
      const rawValue = request.headers[name];
      const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
      const normalized = value?.trim();

      if (normalized) {
        return normalized;
      }
    }

    return null;
  }
}
