import type { RequestContext } from '../../../common/context/request-context.interface';
import type { FormEntity } from '../entities/form.entity';
import type { FormSubmissionEntity } from '../entities/form-submission.entity';
import {
  DEFAULT_FORM_AFTER_SUBMIT,
  DEFAULT_FORM_DESTINATION,
  DEFAULT_FORM_SECURITY,
} from '../forms.types';
import {
  FormLeadIngestionService,
  buildOpportunityDescription,
  formRequestContext,
} from './form-lead-ingestion.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const COMPANY = '44444444-4444-4444-8444-444444444444';

function makeForm(overrides: Partial<FormEntity> = {}): FormEntity {
  return {
    id: 'form-1',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    agencyClientId: null,
    companyContextId: null,
    type: 'lead_capture',
    name: 'Contato LP',
    description: null,
    status: 'active',
    publicKey: 'f_aaaaaaaaaaaaaaaaaaaaaaaa',
    schemaVersion: 1,
    fields: { fields: [] },
    presentation: {},
    tracking: {},
    destination: { ...DEFAULT_FORM_DESTINATION },
    security: { ...DEFAULT_FORM_SECURITY },
    afterSubmit: { ...DEFAULT_FORM_AFTER_SUBMIT },
    createdByUserId: null,
    publishedAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSubmission(
  overrides: Partial<FormSubmissionEntity> = {},
): FormSubmissionEntity {
  return {
    id: 'sub-1',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    agencyClientId: null,
    companyContextId: null,
    formId: 'form-1',
    schemaVersion: 1,
    source: 'page',
    payload: {},
    normalized: {
      values: { nome: 'Maria' },
      lead: {
        name: 'Maria Silva',
        email: 'maria@x.com',
        phone: '+5511987654321',
        company: null,
        position: null,
      },
      opportunity: { title: null, valueAmount: 1500.5, notes: null },
      summaryLines: ['Nome: Maria Silva'],
    },
    attribution: { utm_source: 'meta', gclid: 'g1' },
    clientNonce: null,
    ipHash: null,
    userAgent: null,
    status: 'received',
    error: null,
    contactId: null,
    opportunityId: null,
    outcome: {},
    processedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup() {
  const submissions = {
    save: jest.fn((row: FormSubmissionEntity) => Promise.resolve(row)),
  };
  const crmOpportunities = { findOne: jest.fn().mockResolvedValue(null) };
  const salesOpportunities = { findOne: jest.fn().mockResolvedValue(null) };
  const contacts = {
    findExisting: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue('contact-new'),
  };
  const crm = {
    createOpportunity: jest.fn().mockResolvedValue({ id: 'crm-opp' }),
  };
  const crmCommands = { recordEvent: jest.fn().mockResolvedValue({}) };
  const sales = {
    createQuickOpportunity: jest.fn().mockResolvedValue({ id: 'sales-opp' }),
    createOpportunityActivity: jest.fn().mockResolvedValue({}),
  };
  const service = new FormLeadIngestionService(
    submissions as never,
    crmOpportunities as never,
    salesOpportunities as never,
    contacts as never,
    crm as never,
    crmCommands as never,
    sales as never,
  );
  return {
    service,
    submissions,
    crmOpportunities,
    salesOpportunities,
    contacts,
    crm,
    crmCommands,
    sales,
  };
}

describe('FormLeadIngestionService', () => {
  it('creates contact + Agency CRM opportunity with metadata.source "Formulário"', async () => {
    const { service, contacts, sales } = setup();
    const result = await service.process(makeForm(), makeSubmission());

    expect(contacts.create).toHaveBeenCalledWith(
      {
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        companyContextId: null,
      },
      expect.objectContaining({ email: 'maria@x.com' }),
      { formName: 'Contato LP', ownerUserId: null },
    );
    const [salesCtx, salesDto] = sales.createQuickOpportunity.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(salesCtx).toEqual({ tenantId: TENANT, workspaceId: WORKSPACE });
    expect(salesDto).toMatchObject({
      title: 'Maria Silva — Contato LP',
      contactId: 'contact-new',
      amountCents: 150050,
      metadata: {
        source: 'Formulário',
        formId: 'form-1',
        formSubmissionId: 'sub-1',
      },
    });
    expect(result).toMatchObject({
      status: 'accepted',
      contactId: 'contact-new',
      opportunityId: 'sales-opp',
      outcome: {
        contactAction: 'created',
        opportunityAction: 'created',
        opportunityTarget: 'agency_sales',
      },
    });
  });

  it('creates the LeadFlow opportunity under the client company context, idempotent per submission', async () => {
    const { service, crm, contacts } = setup();
    contacts.findExisting.mockResolvedValue('contact-old');
    const form = makeForm({
      agencyClientId: CLIENT,
      companyContextId: COMPANY,
      destination: { ...DEFAULT_FORM_DESTINATION, target: 'leadflow_crm' },
    });
    const result = await service.process(form, makeSubmission());

    expect(contacts.create).not.toHaveBeenCalled();
    const [ctx, dto, options] = crm.createOpportunity.mock.calls[0] as [
      RequestContext,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(ctx.managedContext).toEqual({
      productKey: 'leadflow',
      operatingMode: 'client',
      clientId: CLIENT,
      companyContextId: COMPANY,
      managedTenantId: null,
    });
    expect(ctx.userId).toBeUndefined();
    expect(dto).toMatchObject({
      source: 'form',
      contactId: 'contact-old',
      valueAmount: '1500.50',
    });
    expect(options).toEqual({
      idempotencyKey: 'form-submission:sub-1',
      actor: { type: 'system', userId: null },
    });
    expect(result.outcome.contactAction).toBe('matched');
  });

  it('appends to an open opportunity of the same contact inside the window (D-F10)', async () => {
    const { service, salesOpportunities, sales } = setup();
    salesOpportunities.findOne.mockResolvedValue({ id: 'sales-existing' });
    const result = await service.process(makeForm(), makeSubmission());

    expect(sales.createQuickOpportunity).not.toHaveBeenCalled();
    expect(sales.createOpportunityActivity).toHaveBeenCalledWith(
      { tenantId: TENANT, workspaceId: WORKSPACE },
      'sales-existing',
      expect.objectContaining({
        type: 'follow_up',
        title: 'Novo envio do formulário "Contato LP"',
      }),
    );
    expect(result).toMatchObject({
      status: 'duplicate',
      opportunityId: 'sales-existing',
    });
  });

  it('skips the duplicate rule when the window is 0', async () => {
    const { service, salesOpportunities, sales } = setup();
    await service.process(
      makeForm({
        destination: { ...DEFAULT_FORM_DESTINATION, duplicateWindowDays: 0 },
      }),
      makeSubmission(),
    );
    expect(salesOpportunities.findOne).not.toHaveBeenCalled();
    expect(sales.createQuickOpportunity).toHaveBeenCalled();
  });

  it('without enough contact data creates only the opportunity', async () => {
    const { service, contacts, sales } = setup();
    const submission = makeSubmission();
    submission.normalized!.lead = {
      name: null,
      email: 'so@email.com',
      phone: null,
      company: null,
      position: null,
    };
    const result = await service.process(makeForm(), submission);
    expect(contacts.create).not.toHaveBeenCalled();
    expect(sales.createQuickOpportunity).toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'accepted',
      contactId: null,
      outcome: { contactAction: 'skipped' },
    });
  });

  it('keeps the submission as failed (reprocessable) when the CRM throws', async () => {
    const { service, sales } = setup();
    sales.createQuickOpportunity.mockRejectedValue(
      new Error('No active sales pipeline found for this workspace.'),
    );
    const result = await service.process(makeForm(), makeSubmission());
    expect(result).toMatchObject({
      status: 'failed',
      opportunityId: null,
      error: 'No active sales pipeline found for this workspace.',
      contactId: 'contact-new',
    });
  });

  it('does nothing for a submission that already has an opportunity or is spam', async () => {
    const { service, submissions } = setup();
    await service.process(makeForm(), makeSubmission({ opportunityId: 'x' }));
    await service.process(makeForm(), makeSubmission({ status: 'spam' }));
    expect(submissions.save).not.toHaveBeenCalled();
  });

  it('formRequestContext: Agency CRM has no managed context; LeadFlow agency mode has no client', () => {
    expect(formRequestContext(makeForm()).managedContext).toBeUndefined();
    expect(
      formRequestContext(
        makeForm({
          destination: { ...DEFAULT_FORM_DESTINATION, target: 'leadflow_crm' },
        }),
      ).managedContext,
    ).toMatchObject({
      operatingMode: 'agency',
      clientId: null,
      companyContextId: null,
    });
  });

  it('buildOpportunityDescription lists answers and UTMs, not click ids', () => {
    const text = buildOpportunityDescription(
      makeForm(),
      makeSubmission(),
      makeSubmission().normalized!,
    );
    expect(text).toContain(
      'Lead recebido pelo formulário "Contato LP" (página pública).',
    );
    expect(text).toContain('Nome: Maria Silva');
    expect(text).toContain('utm_source: meta');
    expect(text).not.toContain('gclid');
  });
});
