import {
  clientContractDocumentTypes,
  isClientSignedDocument,
} from './client-contract-document.view';
import { FinanceInvoiceStatus } from '../finance/enums';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError } from 'typeorm';
import { ClientInvoiceOwnershipResolver } from '../finance/services/client-invoice-ownership.resolver';
import { FinanceInvoice } from '../finance/entities';
import {
  ContractDefaults,
  ContractRecord,
  ContractDocument,
} from '../contracts/entities';
import { ContractTargetType } from '../contracts/enums';
import { readClientContractTerms } from '../contracts/contract-term-reader';
import { isSignedContract } from '../contracts/contract-term';
import { NotificationEventProcessorService } from '../notifications/services/notification-event-processor.service';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../notifications/enums';

export type BillingCompany = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string;
  companyContextId: string;
  ownerSince: Date;
};
export function renewalUpcomingBody(autoRenewal: boolean, validUntil: string) {
  return autoRenewal
    ? `Seu contrato será renovado automaticamente em ${validUntil}.`
    : `Seu contrato vence em ${validUntil}. Entre em contato com a agência para renovar.`;
}
@Injectable()
export class ClientAgencyBillingNotificationsService {
  private readonly logger = new Logger(
    ClientAgencyBillingNotificationsService.name,
  );
  constructor(
    @InjectDataSource('agency') private readonly db: DataSource,
    private readonly ownership: ClientInvoiceOwnershipResolver,
    private readonly processor: NotificationEventProcessorService,
  ) {}
  @Cron('0 8 * * *', { timeZone: 'America/Sao_Paulo' })
  async daily() {
    const companies = await this.db.query<BillingCompany[]>(
      `SELECT s.tenant_id AS "tenantId",s.workspace_id AS "workspaceId",s.agency_client_id AS "agencyClientId",s.company_context_id AS "companyContextId",m.created_at AS "ownerSince" FROM client_area_company_settings s JOIN client_area_settings a ON a.tenant_id=s.tenant_id AND a.workspace_id=s.workspace_id AND a.enabled=true JOIN agency_client_company_contexts cc ON cc.id=s.company_context_id AND cc.tenant_id=s.tenant_id AND cc.workspace_id=s.workspace_id AND cc.agency_client_id=s.agency_client_id AND cc.status='active' JOIN agency_clients c ON c.id=s.agency_client_id AND c.tenant_id=s.tenant_id AND c.workspace_id=s.workspace_id AND c.status='active' AND c.archived_at IS NULL JOIN client_area_memberships m ON m.tenant_id=s.tenant_id AND m.workspace_id=s.workspace_id AND m.company_context_id=s.company_context_id AND m.agency_client_id=s.agency_client_id AND m.status='active' AND m.role='client_owner' WHERE s.enabled=true`,
    );
    for (const company of companies) {
      try {
        await this.scan(company);
      } catch (error) {
        this.logger.error(
          'client_agency_billing_notification_scan_failed',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
  async scan(company: BillingCompany) {
    const scope = {
      tenantId: company.tenantId,
      workspaceId: company.workspaceId,
    };
    const owners = await this.ownership.resolve(scope);
    const customers = [
      company.agencyClientId,
      ...[...owners]
        .filter(([, id]) => id === company.agencyClientId)
        .map(([id]) => id),
    ];
    const invoices = await this.db
      .getRepository(FinanceInvoice)
      .find({ where: { ...scope, customerId: In(customers) } });
    for (const invoice of invoices)
      if (
        invoice.status !== FinanceInvoiceStatus.Draft &&
        invoice.issuedAt &&
        invoice.issuedAt >= company.ownerSince
      )
        await this.publish(
          company,
          'agency.invoice.issued',
          `${invoice.id}:${invoice.issuedAt.toISOString()}`,
          'Nova fatura disponível',
          `A fatura ${invoice.invoiceNumber} está disponível.`,
          invoice.issuedAt,
        );
    const records = await this.db.getRepository(ContractRecord).find({
      where: {
        ...scope,
        targetType: ContractTargetType.Client,
        targetId: company.agencyClientId,
      },
    });
    const documents = records.length
      ? await this.db.getRepository(ContractDocument).find({
          where: {
            ...scope,
            contractId: In(records.map((row) => row.id)),
            type: In(clientContractDocumentTypes),
          },
        })
      : [];
    for (const doc of documents)
      if (
        doc.createdAt >= company.ownerSince &&
        records.some((record) => isClientSignedDocument(record, doc))
      )
        await this.publish(
          company,
          'agency.contract.document_available',
          doc.id,
          'Novo documento disponível',
          'Um documento assinado do seu contrato está disponível.',
          doc.createdAt,
        );
    for (const record of records)
      if (
        record.parentContractId &&
        record.metadata?.renewal &&
        isSignedContract({
          ...record,
          documents: documents.filter((doc) => doc.contractId === record.id),
        }) &&
        record.signedAt &&
        record.signedAt >= company.ownerSince
      )
        await this.publish(
          company,
          'agency.contract.renewed',
          record.id,
          'Contrato renovado',
          'A renovação assinada do seu contrato está disponível.',
          record.signedAt,
        );
    const term = (
      await readClientContractTerms(
        this.db.getRepository(ContractRecord),
        this.db.getRepository(ContractDefaults),
        scope,
        [company.agencyClientId],
      )
    ).get(company.agencyClientId);
    if (
      term?.contractId &&
      term.validUntil &&
      term.daysUntilEnd !== null &&
      term.daysUntilEnd >= 0 &&
      term.daysUntilEnd <= term.windowDays &&
      !['none', 'pending', 'expired', 'terminating'].includes(term.state)
    )
      await this.publish(
        company,
        'agency.contract.renewal_upcoming',
        `${term.contractId}:${term.validUntil}:${term.autoRenewal}`,
        'Renovação de contrato',
        renewalUpcomingBody(term.autoRenewal, term.validUntil),
        new Date(),
      );
  }
  private async publish(
    company: BillingCompany,
    eventType: string,
    source: string,
    title: string,
    body: string,
    occurredAt: Date,
  ) {
    try {
      return await this.processor.process({
        eventId: `${eventType}:${source}:${company.companyContextId}`,
        eventType,
        tenantId: company.tenantId,
        workspaceId: company.workspaceId,
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'agency_billing',
        actorType: NotificationActorType.SYSTEM,
        occurredAt: occurredAt.toISOString(),
        resourceType: 'agency_billing',
        clientAudience: {
          companyContextId: company.companyContextId,
          requiredPermission: 'client_area.agency_billing.view',
          requiredModule: 'agency_billing',
          interestReason: NotificationInterestReason.OWNER,
          actionUrl: `/client-area/c/${company.companyContextId}/agency/billing`,
          title,
          body,
        },
        payload: { title, body, deliveryChannels: ['in_app', 'email'] },
      });
    } catch (error) {
      const cause =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: unknown; constraint?: unknown })
          : null;
      // The unique source-event index serializes concurrent daily scans. Only its duplicate is success.
      if (
        cause?.code === '23505' &&
        cause.constraint === 'uq_notifications_tenant_source_event'
      )
        return;
      throw error;
    }
  }
}
