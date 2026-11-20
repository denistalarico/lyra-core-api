import { Logger } from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import type { FormEntity } from '../entities/form.entity';
import type { FormSubmissionEntity } from '../entities/form-submission.entity';
import {
  DEFAULT_FORM_AFTER_SUBMIT,
  DEFAULT_FORM_PRESENTATION,
  DEFAULT_FORM_TRACKING,
  DEFAULT_FORM_DESTINATION,
  DEFAULT_FORM_GOOGLE_ADS_LEADS,
  DEFAULT_FORM_INBOUND_EMAIL,
  DEFAULT_FORM_SECURITY,
} from '../forms.types';
import {
  FormLeadIngestionService,
  buildOpportunityDescription,
  formRequestContext,
  scrubLeadPii,
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
    presentation: structuredClone(DEFAULT_FORM_PRESENTATION),
    tracking: { ...DEFAULT_FORM_TRACKING },
    destination: { ...DEFAULT_FORM_DESTINATION },
    security: { ...DEFAULT_FORM_SECURITY },
    afterSubmit: { ...DEFAULT_FORM_AFTER_SUBMIT },
    capture: { formSelector: null, fieldMap: {} },
    inboundEmailAddress: null,
    inboundEmail: { ...DEFAULT_FORM_INBOUND_EMAIL },
    googleAdsLeads: { ...DEFAULT_FORM_GOOGLE_ADS_LEADS },
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
    emailMessageId: null,
    externalLeadId: null,
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
  const adEntities = { findOne: jest.fn().mockResolvedValue(null) };
  const service = new FormLeadIngestionService(
    submissions as never,
    crmOpportunities as never,
    salesOpportunities as never,
    contacts as never,
    crm as never,
    crmCommands as never,
    sales as never,
    adEntities as never,
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
    adEntities,
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
        // The Agency card/drawer read the contact here (else it shows the contact UUID).
        contactName: 'Maria Silva',
        phone: '+5511987654321',
        email: 'maria@x.com',
      },
    });
    expect(salesDto.metadata).not.toHaveProperty('companyName');
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

  it('a captured site form without name/e-mail/phone waits for mapping (no blank deal)', async () => {
    const { service, contacts, sales } = setup();
    const result = await service.process(
      makeForm(),
      makeSubmission({
        source: 'script',
        normalized: {
          values: { input_1: 'x' },
          lead: {
            name: null,
            email: null,
            phone: null,
            company: null,
            position: null,
          },
          opportunity: { title: null, valueAmount: null, notes: null },
          summaryLines: ['input_1: x'],
        },
      }),
    );
    expect(result.status).toBe('needs_review');
    expect(result.error).toContain('Mapeie');
    expect(contacts.findExisting).not.toHaveBeenCalled();
    expect(sales.createQuickOpportunity).not.toHaveBeenCalled();
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

  describe('Google Ads lead (D-L6)', () => {
    const googleSubmission = (overrides: Partial<FormSubmissionEntity> = {}) =>
      makeSubmission({
        source: 'google_ads',
        attribution: {
          gclid: 'gclid-fixture',
          campaignId: '123',
          assetGroupId: '456',
          formId: 'gform-9',
          leadId: 'lead-9',
          submittedAt: '2026-11-19T13:15:00.000Z',
          isTest: 'false',
        },
        ...overrides,
      });

    it('Agency CRM: metadata.source "Google Ads" and the ids of the ad', async () => {
      const { service, sales, adEntities } = setup();
      adEntities.findOne.mockResolvedValue({ name: 'Campanha Verão' });
      await service.process(makeForm(), googleSubmission());

      const dto = (
        sales.createQuickOpportunity.mock.calls[0] as unknown[]
      )[1] as {
        description: string;
        metadata: Record<string, unknown>;
      };
      expect(dto.metadata).toMatchObject({
        source: 'Google Ads',
        provider: 'google_ads',
        campaignId: '123',
        campaignName: 'Campanha Verão',
        assetGroupId: '456',
        providerFormId: 'gform-9',
        formId: 'form-1',
        leadId: 'lead-9',
        gclid: 'gclid-fixture',
        submittedAt: '2026-11-19T13:15:00.000Z',
      });
      expect(dto.description).toContain(
        'Lead recebido pelo formulário do Google Ads — campanha Campanha Verão.',
      );
    });

    it('looks the campaign up in the mirror of the form scope', async () => {
      const { service, adEntities } = setup();
      await service.process(makeForm(), googleSubmission());
      const query = (adEntities.findOne.mock.calls[0] as unknown[])[0] as {
        where: Record<string, unknown>;
      };
      expect(query.where).toMatchObject({
        tenantId: TENANT,
        provider: 'google_ads',
        entityLevel: 'campaign',
        externalId: '123',
      });
    });

    it('a missing or failing mirror never blocks the lead and the description falls back to the id', async () => {
      const { service, sales, adEntities } = setup();
      adEntities.findOne.mockRejectedValue(new Error('db down'));
      const result = await service.process(makeForm(), googleSubmission());
      expect(result.status).toBe('accepted');
      const dto = (
        sales.createQuickOpportunity.mock.calls[0] as unknown[]
      )[1] as {
        description: string;
        metadata: Record<string, unknown>;
      };
      expect(dto.description).toContain('— campanha 123.');
      expect(dto.metadata).not.toHaveProperty('campaignName');
    });

    it('LeadFlow CRM: source "google_ads"', async () => {
      const { service, crm } = setup();
      const form = makeForm({
        agencyClientId: CLIENT,
        companyContextId: COMPANY,
        destination: { ...DEFAULT_FORM_DESTINATION, target: 'leadflow_crm' },
      });
      await service.process(form, googleSubmission());
      expect(
        (crm.createOpportunity.mock.calls[0] as unknown[])[1],
      ).toMatchObject({
        source: 'google_ads',
        metadata: { provider: 'google_ads', campaignId: '123' },
      });
    });

    it('older sources keep "form" / "Formulário" and no provider metadata', async () => {
      const { service, sales } = setup();
      await service.process(makeForm(), makeSubmission());
      const dto = (
        sales.createQuickOpportunity.mock.calls[0] as unknown[]
      )[1] as {
        metadata: Record<string, unknown>;
      };
      expect(dto.metadata.source).toBe('Formulário');
      expect(dto.metadata).not.toHaveProperty('provider');
    });

    it('keeps the lead data out of the stored error and the log', async () => {
      const { service, sales } = setup();
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      sales.createQuickOpportunity.mockRejectedValue(
        new Error('invalid contact maria@x.com / +5511987654321 / Maria Silva'),
      );
      const result = await service.process(makeForm(), googleSubmission());
      expect(result.status).toBe('failed');
      for (const text of [
        result.error,
        ...(warn.mock.calls.flat() as unknown[]),
      ]) {
        expect(String(text)).not.toMatch(
          /maria@x\.com|5511987654321|Maria Silva/,
        );
      }
      warn.mockRestore();
    });
  });

  it('scrubLeadPii cuts known values, e-mails and phone numbers', () => {
    const lead = {
      name: 'Maria Silva',
      email: null,
      phone: null,
      company: null,
      position: null,
    };
    expect(scrubLeadPii('Maria Silva a@b.co +55 11 98765-4321 ok', lead)).toBe(
      '[dado do lead] [e-mail] [telefone] ok',
    );
  });
});
