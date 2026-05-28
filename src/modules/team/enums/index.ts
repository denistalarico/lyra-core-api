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
