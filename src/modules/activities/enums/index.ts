export enum ActivityType {
  Checklist = 'checklist',
  Email = 'email',
  Call = 'call',
  Task = 'task',
  FollowUp = 'follow_up',
  Meeting = 'meeting',
  Document = 'document',
}

export enum ActivityStatus {
  Todo = 'todo',
  Scheduled = 'scheduled',
  InProgress = 'in_progress',
  Done = 'done',
  Cancelled = 'cancelled',
  Overdue = 'overdue',
  Archived = 'archived',
}

export enum ActivityPriority {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Urgent = 'urgent',
}

export enum ActivityVisibility {
  Workspace = 'workspace',
  Private = 'private',
}

export enum ActivityEntityType {
  CrmOpportunity = 'crm_opportunity',
  SalesOpportunity = 'sales_opportunity',
  SalesQuote = 'sales_quote',
  Contact = 'contact',
  Client = 'client',
  Project = 'project',
  Task = 'task',
  CalendarEvent = 'calendar_event',
  Invoice = 'invoice',
  InboxConversation = 'inbox_conversation',
  TeamLifecycleStep = 'team_lifecycle_step',
}

export enum ActivityRelationType {
  RelatedTo = 'related_to',
  BelongsTo = 'belongs_to',
  GeneratedFrom = 'generated_from',
  ScheduledFor = 'scheduled_for',
  AttachedTo = 'attached_to',
}
