export enum ClientLifecycleProcessType {
  Onboarding = 'onboarding',
  Offboarding = 'offboarding',
}

export enum ClientLifecycleProcessStatus {
  InProgress = 'in_progress',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

export enum ClientLifecycleStepStatus {
  NotStarted = 'not_started',
  InProgress = 'in_progress',
  Done = 'done',
  Skipped = 'skipped',
}

export enum ClientLifecycleIntervalUnit {
  Hours = 'hours',
  Days = 'days',
  Weeks = 'weeks',
}
