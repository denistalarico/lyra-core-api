import { ContactEntity } from '../contacts/entities/contact.entity';
import { randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ClientAreaContext } from '../client-area/client-area.types';
import { FinanceInvoice, FinanceInvoiceLine } from '../finance/entities';
import {
  ClientAgencyBillingService,
  billingOwnerScope,
  invoiceView,
} from './client-agency-billing.service';
const context = {
  role: 'client_owner',
  tenantId: randomUUID(),
  workspaceId: randomUUID(),
  agencyClientId: randomUUID(),
  companyContextId: randomUUID(),
  userId: randomUUID(),
} as ClientAreaContext;
const id = randomUUID(),
  contact = randomUUID();
const row = Object.assign(new FinanceInvoice(), {
  id,
  tenantId: context.tenantId,
  workspaceId: context.workspaceId,
  customerId: contact,
  status: 'issued',
  invoiceNumber: 'INV-1',
  totalAmount: '10.00',
  metadata: { internalSecret: true },
  notes: 'Internal',
});
function setup(invoice: object | null = row) {
  const db = {
    getRepository: (entity: unknown) =>
      entity === FinanceInvoice
        ? { findOne: () => Promise.resolve(invoice) }
        : { find: () => Promise.resolve([]) },
    query: () => Promise.resolve([]),
  };
  return new ClientAgencyBillingService(
    db as never,
    {
      resolve: () =>
        Promise.resolve(new Map([[contact, context.agencyClientId]])),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}
describe('CA9 Owner billing facade', () => {
  it('rejects members even when they claim a module level', () => {
    expect(() =>
      billingOwnerScope({ ...context, role: 'client_member' }),
    ).toThrow(ForbiddenException);
  });
  it('uses ID-only ownership, denies foreign and missing invoice IDs, omits internal fields', async () => {
    expect((await setup().invoice(context, id)).invoice).toMatchObject({
      id,
      totalAmount: '10.00',
    });
    expect(invoiceView(row as FinanceInvoice)).not.toHaveProperty('notes');
    expect(invoiceView(row as FinanceInvoice)).not.toHaveProperty('metadata');
    await expect(
      setup({ ...row, customerId: randomUUID() }).invoice(context, id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup(null).invoice(context, id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(setup().invoice(context, 'invalid')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('projects invoice lines and payments individually', async () => {
    const db = {
      getRepository: (entity: unknown) =>
        entity === FinanceInvoice
          ? { findOne: () => Promise.resolve(row) }
          : entity === FinanceInvoiceLine
            ? {
                find: () =>
                  Promise.resolve([
                    {
                      id: 'line',
                      description: 'Service',
                      quantity: '1',
                      unitPrice: '10',
                      costCenterId: 'private',
                      metadata: { secret: true },
                    },
                  ]),
              }
            : {},
      query: () =>
        Promise.resolve([
          {
            amount: '10',
            currency: 'BRL',
            paymentDate: '2026-10-18',
            method: 'pix',
            status: 'completed',
            externalReference: 'secret',
          },
        ]),
    };
    const service = new ClientAgencyBillingService(
      db as never,
      {
        resolve: () =>
          Promise.resolve(new Map([[contact, context.agencyClientId]])),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const result = await service.invoice(context, id);
    expect(result.lines[0]).not.toHaveProperty('metadata');
    expect(result.lines[0]).not.toHaveProperty('costCenterId');
    expect(result.payments[0]).not.toHaveProperty('externalReference');
  });
  it('uses the existing renderer with safe invoice fields and the invoice customer identity, not the selected company', async () => {
    const renderInvoicePdf = jest.fn<
      Promise<Buffer>,
      [{ invoice: FinanceInvoice; lines: FinanceInvoiceLine[] }]
    >(() => Promise.resolve(Buffer.from('%PDF-safe')));
    const db = {
      getRepository: (entity: unknown) =>
        entity === FinanceInvoice
          ? { findOne: () => Promise.resolve(row) }
          : entity === ContactEntity
            ? {
                findOne: () =>
                  Promise.resolve({ displayName: 'Invoice Company B' }),
              }
            : {
                find: () =>
                  Promise.resolve([
                    {
                      id: 'line',
                      description: 'Service',
                      costCenterId: 'secret',
                      metadata: { internal: true },
                    },
                  ]),
              },
      query: () => Promise.resolve([]),
    };
    const service = new ClientAgencyBillingService(
      db as never,
      {
        resolve: () =>
          Promise.resolve(new Map([[contact, context.agencyClientId]])),
      } as never,
      {
        getDefaultLayout: () => Promise.resolve({ layoutType: 'standard' }),
        getSystemTemplateForType: () => Promise.resolve({}),
      } as never,
      { renderInvoicePdf } as never,
      {} as never,
      { listBankAccounts: () => Promise.resolve([]) } as never,
    );
    expect(
      (
        await service.invoicePdf(
          { ...context, companyDisplayName: 'Selected Company A' },
          id,
        )
      ).buffer.toString(),
    ).toBe('%PDF-safe');
    const [payload] = renderInvoicePdf.mock.calls[0];
    expect(payload.invoice.metadata).toEqual({
      customerName: 'Invoice Company B',
    });
    expect(payload.invoice.notes).toBeNull();
    expect(payload.lines[0].metadata).toBeUndefined();
    expect(payload.lines[0].costCenterId).toBeUndefined();
  });
});
