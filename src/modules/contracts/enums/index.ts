export enum ContractTemplateStatus {
  Draft = 'draft',
  Active = 'active',
  Archived = 'archived',
}

export enum ContractTargetType {
  Client = 'client',
  TeamMember = 'team_member',
  Vendor = 'vendor',
  Partner = 'partner',
  Internal = 'internal',
}

export enum ContractCategory {
  ClientRecurring = 'client_recurring',
  ClientShortTerm = 'client_short_term',
  ClientOneShot = 'client_one_shot',
  MeiContractor = 'mei_contractor',
  Employee = 'employee',
  Freelancer = 'freelancer',
  Vendor = 'vendor',
  Partnership = 'partnership',
  Other = 'other',
}

export enum ContractStatus {
  Draft = 'draft',
  Generated = 'generated',
  PendingSignature = 'pending_signature',
  SentForSignature = 'sent_for_signature',
  WaitingManualSignature = 'waiting_manual_signature',
  WaitingDigitalSignature = 'waiting_digital_signature',
  PartiallySigned = 'partially_signed',
  ManuallySigned = 'manually_signed',
  DigitallySigned = 'digitally_signed',
  Completed = 'completed',
  Cancelled = 'cancelled',
  Expired = 'expired',
  Archived = 'archived',
}

export enum ContractSignatureMode {
  Manual = 'manual',
  Digital = 'digital',
}

export enum ContractSignatureProvider {
  None = 'none',
  Autentique = 'autentique',
}

export enum ContractPartyRole {
  Company = 'company',
  Client = 'client',
  TeamMember = 'team_member',
  Contractor = 'contractor',
  Witness = 'witness',
  Approver = 'approver',
  Other = 'other',
}

export enum ContractPartySignatureStatus {
  Pending = 'pending',
  Sent = 'sent',
  Viewed = 'viewed',
  Signed = 'signed',
  Refused = 'refused',
  Failed = 'failed',
}

export enum ContractDocumentType {
  DraftHtml = 'draft_html',
  GeneratedPdf = 'generated_pdf',
  SignedPdf = 'signed_pdf',
  ManuallySignedPdf = 'manually_signed_pdf',
  DigitalSignatureCertificate = 'digital_signature_certificate',
  Attachment = 'attachment',
}

export enum ContractEventType {
  Created = 'contract.created',
  Updated = 'contract.updated',
  Generated = 'contract.generated',
  SentForManualSignature = 'contract.sent_for_manual_signature',
  SentForDigitalSignature = 'contract.sent_for_digital_signature',
  ManuallySigned = 'contract.manually_signed',
  DigitallySigned = 'contract.digitally_signed',
  Completed = 'contract.completed',
  Cancelled = 'contract.cancelled',
  Archived = 'contract.archived',
  PartyAdded = 'contract.party_added',
  PartyUpdated = 'contract.party_updated',
  PartyRemoved = 'contract.party_removed',
  DocumentAdded = 'contract.document_added',
  SignaturePrepared = 'contract.signature_prepared',
  SignatureSendPrepared = 'contract.signature_send_prepared',
  SignatureSent = 'contract.signature_sent',
  SignatureStatusUpdated = 'contract.signature_status_updated',
  SignatureCompleted = 'contract.signature_completed',
  ManualSignedPdfUploaded = 'contract.manual_signed_pdf_uploaded',
  SignatureProviderSynced = 'contract.signature_provider_synced',
}

export enum ContractTemplateSource {
  Preset = 'preset',
  Custom = 'custom',
  Imported = 'imported',
  AiAssisted = 'ai_assisted',
}

export enum ContractTemplateEditorMode {
  Html = 'html',
  PlainText = 'plain_text',
  Markdown = 'markdown',
  RichText = 'rich_text',
}

export enum ContractHeaderPreset {
  Classic = 'classic',
  Minimal = 'minimal',
  Corporate = 'corporate',
  None = 'none',
}

export enum ContractFooterPreset {
  Lyra = 'lyra',
  Company = 'company',
  Legal = 'legal',
  None = 'none',
}
