import { QueryFailedError } from 'typeorm';
import {
  ClientAgencyBillingNotificationsService,
  renewalUpcomingBody,
} from './client-agency-billing-notifications.service';
import { FinanceInvoice } from '../finance/entities';
import {
  ContractDefaults,
  ContractDocument,
  ContractRecord,
} from '../contracts/entities';
import { permissionsForClientAreaRole } from '../client-area/client-area-permissions.catalog';
import { contractToday } from '../contracts/contract-term';
const company = {
  tenantId: 'tenant',
  workspaceId: 'workspace',
  agencyClientId: 'client',
  companyContextId: 'company',
  ownerSince: new Date('2026-01-01'),
};
describe('CA9 billing notices', () => {
  it('reserves the audience permission for Owner and uses separate automatic-renewal copy', () => {
    expect(
      permissionsForClientAreaRole('client_owner').has(
        'client_area.agency_billing.view',
      ),
    ).toBe(true);
    for (const role of [
      'client_member',
      'client_admin',
      'client_operator',
      'client_viewer',
    ] as const)
      expect(
        permissionsForClientAreaRole(role).has(
          'client_area.agency_billing.view',
        ),
      ).toBe(false);
    expect(renewalUpcomingBody(true, '2026-11-01')).toContain(
      'será renovado automaticamente em 2026-11-01',
    );
    expect(renewalUpcomingBody(false, '2026-11-01')).not.toContain(
      'automaticamente',
    );
  });
  it('emits stable source IDs per company, only signed renewals and issued invoices, through NTF-C1', async () => {
    const date = new Date(),
      today = contractToday(date);
    const record = {
      id: 'contract',
      title: 'Signed',
      documentKind: 'contract',
      status: 'completed',
      signatureProvider: 'autentique',
      validFrom: '2026-01-01',
      validUntil: today,
      archivedAt: null,
      cancelledAt: null,
      createdAt: date,
      signedAt: date,
      parentContractId: 'parent',
      metadata: {
        renewal: { previousContractId: 'parent' },
        clientContract: { manual: { autoRenewal: true } },
      },
      variablesData: {},
    };
    const qb: Record<string, unknown> = {};
    for (const key of [
      'select',
      'addSelect',
      'distinctOn',
      'where',
      'andWhere',
      'orderBy',
    ])
      qb[key] = () => qb;
    qb.getRawMany = () =>
      Promise.resolve([{ targetId: 'client', records: [record] }]);
    const db = {
      getRepository: (entity: unknown) =>
        entity === FinanceInvoice
          ? {
              find: () =>
                Promise.resolve([
                  {
                    id: 'invoice',
                    status: 'issued',
                    issuedAt: date,
                    invoiceNumber: '1',
                  },
                  { id: 'draft', status: 'draft', issuedAt: date },
                ]),
            }
          : entity === ContractRecord
            ? {
                find: () => Promise.resolve([record]),
                createQueryBuilder: () => qb,
              }
            : entity === ContractDefaults
              ? { findOne: () => Promise.resolve({ expiringWindowDays: 30 }) }
              : entity === ContractDocument
                ? {
                    find: () =>
                      Promise.resolve([
                        {
                          id: 'doc',
                          contractId: 'contract',
                          createdAt: date,
                          type: 'signed_pdf',
                        },
                      ]),
                  }
                : {},
    };
    const process = jest
      .fn()
      .mockResolvedValue({ status: 'created' })
      .mockRejectedValueOnce(
        new QueryFailedError(
          'INSERT',
          [],
          Object.assign(new Error('duplicate'), {
            code: '23505',
            constraint: 'uq_notifications_tenant_source_event',
          }),
        ),
      );
    const service = new ClientAgencyBillingNotificationsService(
      db as never,
      { resolve: () => Promise.resolve(new Map()) } as never,
      { process } as never,
    );
    await service.scan(company);
    await service.scan(company);
    const events = process.mock.calls.map(
      ([event]) =>
        event as {
          eventId: string;
          eventType: string;
          clientAudience: { requiredPermission: string; actionUrl: string };
          payload: object;
        },
    );
    expect(events.slice(0, 4).map((event) => event.eventType)).toEqual([
      'agency.invoice.issued',
      'agency.contract.document_available',
      'agency.contract.renewed',
      'agency.contract.renewal_upcoming',
    ]);
    expect(events.slice(0, 4).map((event) => event.eventId)).toEqual(
      events.slice(4).map((event) => event.eventId),
    );
    for (const event of events) {
      expect(event.clientAudience.requiredPermission).toBe(
        'client_area.agency_billing.view',
      );
      expect(event.clientAudience.actionUrl).toBe(
        '/client-area/c/company/agency/billing',
      );
      expect(event.payload).toMatchObject({
        deliveryChannels: ['in_app', 'email'],
      });
    }
    process.mockRejectedValueOnce(new Error('unavailable'));
    await expect(service.scan(company)).rejects.toThrow('unavailable');
  });
});
