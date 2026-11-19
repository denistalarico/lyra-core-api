/**
 * Forms addon (2026-11-17) — shared types.
 * Plan: docs/sprints/forms-addon-implementation-plan-2026-11-17.md
 */

export const FORM_TYPES = ['lead_capture', 'fiscal_intake'] as const;
export type FormType = (typeof FORM_TYPES)[number];

export const FORM_STATUSES = [
  'draft',
  'active',
  'inactive',
  'archived',
] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

export const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'email',
  'phone',
  'select',
  'radio',
  'checkbox',
  'date',
  'number',
  'cpf',
  'cnpj',
  'consent',
  'hidden',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Where a field's value lands. `none` keeps it on the submission only. */
export const FORM_FIELD_TARGETS = [
  'contact.name',
  'contact.email',
  'contact.phone',
  'contact.company',
  'contact.position',
  'opportunity.title',
  'opportunity.value',
  'opportunity.notes',
  'none',
] as const;
export type FormFieldTarget = (typeof FORM_FIELD_TARGETS)[number];

export type FormField = {
  key: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  /** select/radio/checkbox (checkbox with options = multiple choice). */
  options?: string[];
  placeholder?: string | null;
  helpText?: string | null;
  target?: FormFieldTarget;
  /** Wizard step index (0-based). */
  step?: number;
  maxLength?: number;
};

export type FormFieldsConfig = {
  fields: FormField[];
  steps?: Array<{ title: string; description?: string | null }>;
};

export const FORM_DESTINATION_TARGETS = [
  'agency_sales',
  'leadflow_crm',
] as const;
export type FormDestinationTarget = (typeof FORM_DESTINATION_TARGETS)[number];

export type FormDestination = {
  /** agency_sales = CRM do Agency (/agency/sales); leadflow_crm = CRM do LeadFlow (/crm). */
  target: FormDestinationTarget;
  pipelineId: string | null;
  stageId: string | null;
  ownerUserId: string | null;
  /** 0 disables the rule. Default 30 (D-F10). */
  duplicateWindowDays: number;
  createContact: boolean;
};

export type FormSecurity = {
  /** Empty = any domain (F3 enforces it for the capture script). */
  allowedOrigins: string[];
  minFillSeconds: number;
  consentText: string | null;
};

export type FormAfterSubmit = {
  mode: 'message' | 'redirect';
  message: string | null;
  redirectUrl: string | null;
};

/** F2 (§5.3): container × flow × background, plus a basic theme. */
export const FORM_CONTAINERS = [
  'inline',
  'fullscreen',
  'modal',
  'slide_in',
] as const;
export const FORM_FLOWS = ['single', 'wizard'] as const;
export const FORM_BACKGROUNDS = ['solid', 'transparent'] as const;
export const FORM_FONTS = ['system', 'geist', 'sora', 'serif'] as const;
export const FORM_TRIGGERS = [
  'button',
  'selector',
  'delay',
  'scroll',
  'exit_intent',
] as const;
export const FORM_TRIGGER_FREQUENCIES = ['always', 'session', 'day'] as const;

export type FormPresentation = {
  container: (typeof FORM_CONTAINERS)[number];
  flow: (typeof FORM_FLOWS)[number];
  background: (typeof FORM_BACKGROUNDS)[number];
  theme: {
    primaryColor: string;
    backgroundColor: string;
    textColor: string;
    radius: number;
    fontFamily: (typeof FORM_FONTS)[number];
  };
  logoUrl: string | null;
  title: string | null;
  subtitle: string | null;
  submitLabel: string;
  maxWidth: number;
  /** modal / slide_in / fullscreen only. */
  trigger: {
    type: (typeof FORM_TRIGGERS)[number];
    buttonLabel: string;
    selector: string | null;
    delaySeconds: number;
    scrollPercent: number;
    frequency: (typeof FORM_TRIGGER_FREQUENCIES)[number];
  };
};

/** IDs are injected into script URLs on the public page: formats are strict. */
export type FormTracking = {
  gtmId: string | null;
  metaPixelId: string | null;
  ga4Id: string | null;
  googleAdsConversionId: string | null;
  googleAdsConversionLabel: string | null;
  /** Embed: push lyra_form_* into the host page dataLayer and fire its fbq/gtag. */
  fireParentEvents: boolean;
};

export const DEFAULT_FORM_PRESENTATION: FormPresentation = {
  container: 'inline',
  flow: 'single',
  background: 'solid',
  theme: {
    primaryColor: '#2563EB',
    backgroundColor: '#FFFFFF',
    textColor: '#111827',
    radius: 10,
    fontFamily: 'system',
  },
  logoUrl: null,
  title: null,
  subtitle: null,
  submitLabel: 'Enviar',
  maxWidth: 560,
  trigger: {
    type: 'button',
    buttonLabel: 'Fale conosco',
    selector: null,
    delaySeconds: 10,
    scrollPercent: 50,
    frequency: 'session',
  },
};

export const DEFAULT_FORM_TRACKING: FormTracking = {
  gtmId: null,
  metaPixelId: null,
  ga4Id: null,
  googleAdsConversionId: null,
  googleAdsConversionLabel: null,
  fireParentEvents: true,
};

/**
 * F3 (§5.6): capture script on a form the site already has. Fields are keyed
 * by the site's own `name`/`id`; `fieldMap` overrides the automatic guess.
 */
export type FormCaptureTarget = FormFieldTarget | 'ignore';
export const FORM_CAPTURE_TARGETS: readonly FormCaptureTarget[] = [
  ...FORM_FIELD_TARGETS,
  'ignore',
];

export type FormCapture = {
  /** CSS selector of the site's form; null = automatic (forms with e-mail/phone). */
  formSelector: string | null;
  fieldMap: Record<string, FormCaptureTarget>;
};

export const DEFAULT_FORM_CAPTURE: FormCapture = {
  formSelector: null,
  fieldMap: {},
};

/** One input read by capture.js (sensitive inputs never leave the page). */
export type CapturedField = {
  key: string;
  label: string | null;
  type: string;
  autocomplete: string | null;
  /** `data-lyra-field` on the site's input. */
  hint: string | null;
  value: string;
};

/**
 * F4 (§6): leads by e-mail. The address reaches the agency's IMAP box
 * (`/settings/email`) as a sub-address (`box+slug@`) or a hPanel alias.
 */
export type FormInboundEmail = {
  kind: 'plus' | 'alias';
  verifiedAt: string | null;
  /** Empty = any sender. Exact address or `@domain`. */
  allowedSenders: string[];
  /** D-F12: on by default. */
  aiExtraction: boolean;
  /** "Testar endereço": token in the subject of the e-mail we send. */
  pendingTest: { token: string; sentAt: string } | null;
  /** Gmail/Outlook forwarding confirmation caught by the reader (§6.5.2). */
  forwardingConfirmation: {
    url: string | null;
    from: string | null;
    subject: string | null;
    receivedAt: string;
  } | null;
};

export const DEFAULT_FORM_INBOUND_EMAIL: FormInboundEmail = {
  kind: 'plus',
  verifiedAt: null,
  allowedSenders: [],
  aiExtraction: true,
  pendingTest: null,
  forwardingConfirmation: null,
};

/**
 * Lead-form channels of the ad networks (GL1/ML1, D-L1): the provider's own
 * form feeds `form_submissions`, and the form's `destination` routes it to a CRM.
 */
export type FormGoogleAdsLeads = {
  enabled: boolean;
  keyHint: string | null;
  keyCreatedAt: string | null;
  /** D-L4: Google's "send test data" button also opens a CRM opportunity. */
  sendTestLeadsToCrm: boolean;
  lastReceivedAt: string | null;
  lastTestAt: string | null;
  receivedCount: number;
  lastError: string | null;
};

export const DEFAULT_FORM_GOOGLE_ADS_LEADS: FormGoogleAdsLeads = {
  enabled: false,
  keyHint: null,
  keyCreatedAt: null,
  sendTestLeadsToCrm: true,
  lastReceivedAt: null,
  lastTestAt: null,
  receivedCount: 0,
  lastError: null,
};

/** Read DTO of the channel (§5.4): the stored settings plus the URL to paste in Google Ads. */
export type FormGoogleAdsLeadsView = FormGoogleAdsLeads & {
  webhookUrl: string;
};

export const FORM_SUBMISSION_SOURCES = [
  'page',
  'embed',
  'script',
  'email',
  'google_ads',
  'meta_lead_ads',
] as const;
export type FormSubmissionSource = (typeof FORM_SUBMISSION_SOURCES)[number];

export const FORM_SUBMISSION_STATUSES = [
  'received',
  'accepted',
  'duplicate',
  'needs_review',
  'spam',
  'failed',
] as const;
export type FormSubmissionStatus = (typeof FORM_SUBMISSION_STATUSES)[number];

export type NormalizedLead = {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  position: string | null;
};

export type NormalizedOpportunity = {
  title: string | null;
  valueAmount: number | null;
  notes: string | null;
};

export type NormalizedSubmission = {
  values: Record<string, string | string[] | boolean | number>;
  lead: NormalizedLead;
  opportunity: NormalizedOpportunity;
  /** "Label: value" lines in field order, for the opportunity description. */
  summaryLines: string[];
  /** E-mail leads: who found the contact data (§6.5.4). */
  extractedBy?: 'rules' | 'ai';
};

export type FormSubmissionOutcome = {
  contactAction?: 'created' | 'matched' | 'skipped';
  opportunityAction?: 'created' | 'appended';
  opportunityTarget?: FormDestinationTarget;
};

export const DEFAULT_FORM_DESTINATION: FormDestination = {
  target: 'agency_sales',
  pipelineId: null,
  stageId: null,
  ownerUserId: null,
  duplicateWindowDays: 30,
  createContact: true,
};

export const DEFAULT_FORM_SECURITY: FormSecurity = {
  allowedOrigins: [],
  minFillSeconds: 2,
  consentText: null,
};

export const DEFAULT_FORM_AFTER_SUBMIT: FormAfterSubmit = {
  mode: 'message',
  message: 'Recebemos seus dados. Em breve entraremos em contato.',
  redirectUrl: null,
};
