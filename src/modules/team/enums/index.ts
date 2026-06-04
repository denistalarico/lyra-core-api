export enum TeamMemberStatus {
  Active = 'active',
  Inactive = 'inactive',
  OnLeave = 'on_leave',
  Archived = 'archived',
}

export enum TeamWorkerType {
  EmployeeFullTime = 'employee_full_time',
  EmployeePartTime = 'employee_part_time',
  Contractor = 'contractor',
  Freelancer = 'freelancer',
  MeiContractor = 'mei_contractor',
  Vendor = 'vendor',
  Intern = 'intern',
  Partner = 'partner',
  ExternalCollaborator = 'external_collaborator',
}

export enum TeamWorkMode {
  Remote = 'remote',
  Hybrid = 'hybrid',
  Onsite = 'onsite',
  Flexible = 'flexible',
}

export enum TeamConfigOptionType {
  JobTitle = 'job_title',
  RoleName = 'role_name',
  Seniority = 'seniority',
  WorkMode = 'work_mode',
  WorkerType = 'worker_type',
  OffboardingReason = 'offboarding_reason',
  ContractCategory = 'contract_category',
  SignatureProvider = 'signature_provider',
  OnboardingTask = 'onboarding_task',
  OffboardingTask = 'offboarding_task',
  SkillCategory = 'skill_category',
  SkillLevel = 'skill_level',
  OnboardingTemplate = 'onboarding_template',
  OffboardingTemplate = 'offboarding_template',
  PaymentBenefitTemplate = 'payment_benefit_template',
  PaymentDiscountTemplate = 'payment_discount_template',
  PaymentDocumentTemplate = 'payment_document_template',
  PaymentFinanceSetting = 'payment_finance_setting',
}

export enum TeamSkillLevel {
  Basic = 'basic',
  Intermediate = 'intermediate',
  Advanced = 'advanced',
  Specialist = 'specialist',
}

export enum TeamRecordStatus {
  Active = 'active',
  Archived = 'archived',
}

export enum TeamPresenceStatus {
  Available = 'available',
  Busy = 'busy',
  InMeeting = 'in_meeting',
  Focus = 'focus',
  Away = 'away',
  Offline = 'offline',
  OnBreak = 'on_break',
  OutOfOffice = 'out_of_office',
}

export enum TeamPresenceSource {
  Web = 'web',
  Attendance = 'attendance',
  Kiosk = 'kiosk',
  System = 'system',
  Admin = 'admin',
}

export enum TeamAttendanceType {
  CheckIn = 'check_in',
  BreakStart = 'break_start',
  BreakEnd = 'break_end',
  CheckOut = 'check_out',
  ManualAdjustment = 'manual_adjustment',
}

export enum TeamAttendanceSource {
  Web = 'web',
  KioskPin = 'kiosk_pin',
  KioskBarcode = 'kiosk_barcode',
  AdminManual = 'admin_manual',
  System = 'system',
}

export enum TeamPaymentBatchStatus {
  Draft = 'draft',
  Generated = 'generated',
  Cancelled = 'cancelled',
  Archived = 'archived',
}

export enum TeamPaymentStatus {
  Draft = 'draft',
  Scheduled = 'scheduled',
  Confirmed = 'confirmed',
  InvoiceCreated = 'invoice_created',
  PaymentPending = 'payment_pending',
  Paid = 'paid',
  Cancelled = 'cancelled',
  Archived = 'archived',
}

export enum TeamPaymentCalculationMode {
  Monthly = 'monthly',
  Hourly = 'hourly',
  Daily = 'daily',
  PerProject = 'per_project',
  Manual = 'manual',
}

export enum TeamPaymentItemType {
  Base = 'base',
  Benefit = 'benefit',
  Discount = 'discount',
  Overtime = 'overtime',
  Adjustment = 'adjustment',
}

export enum TeamPaymentDocumentType {
  Statement = 'statement',
  Payslip = 'payslip',
  BenefitsDeclaration = 'benefits_declaration',
  AdvanceVoucher = 'advance_voucher',
  AttendanceReport = 'attendance_report',
  Receipt = 'receipt',
}
