import {
  ProjectPriority,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from '../enums';

export type ProjectsDashboardScope = 'workspace' | 'personal';

export type ProjectsDashboardQuery = {
  scope: ProjectsDashboardScope;
  userId: string;
  clientId?: string;
  ownerId?: string;
  dueSoonDays?: number;
  priorityLimit?: number;
};

export type ProjectDashboardAttentionItem = {
  id: string;
  name: string;
  clientId: string | null;
  ownerId: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  progress: number;
  dueDate: string | null;
  overdue: boolean;
  dueSoon: boolean;
  href: string;
};

export type TaskDashboardAttentionItem = {
  id: string;
  title: string;
  projectId: string | null;
  clientId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  visibility: 'workspace' | 'private';
  dueDate: string | null;
  overdue: boolean;
  dueToday: boolean;
  dueThisWeek: boolean;
  blocked: boolean;
  blockedReason: string | null;
  estimatedMinutes: number | null;
  trackedMinutes: number;
  href: string;
};

export type SubtaskDashboardAttentionItem = {
  id: string;
  title: string;
  taskId: string;
  taskTitle: string;
  projectId: string | null;
  clientId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  status: string;
  dueDate: string | null;
  overdue: boolean;
  dueToday: boolean;
  dueThisWeek: boolean;
  href: string;
};

export type SubtasksDashboardSummary = {
  total: number;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  attentionItems: SubtaskDashboardAttentionItem[];
};

export type TasksDashboardLast3Months = {
  registered: number;
  completed: number;
};

export type ProjectsDashboardSummary = {
  total: number;
  draft: number;
  active: number;
  paused: number;
  completed: number;
  cancelled: number;
  overdue: number;
  dueSoon: number;
  withoutOwner: number;
  highPriority: number;
  urgent: number;
  averageProgress: number;
  attentionItems: ProjectDashboardAttentionItem[];
};

export type TasksDashboardSummary = {
  total: number;
  open: number;
  todo: number;
  inProgress: number;
  inReview: number;
  approved: number;
  waiting: number;
  blocked: number;
  done: number;
  cancelled: number;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  withoutAssignee: number;
  highPriority: number;
  urgent: number;
  estimatedMinutes: number;
  trackedMinutes: number;
  completionRate: number;
  last3Months: TasksDashboardLast3Months;
  attentionItems: TaskDashboardAttentionItem[];
};

export type PersonalTasksDashboardSummary = {
  total: number;
  open: number;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  blocked: number;
  completedInPeriod: number;
  estimatedMinutes: number;
  trackedMinutes: number;
  attentionItems: TaskDashboardAttentionItem[];
};

export type ProjectsDashboardOverview = {
  generatedAt: string;
  scope: ProjectsDashboardScope;
  projects: ProjectsDashboardSummary;
  tasks: TasksDashboardSummary;
  personalTasks: PersonalTasksDashboardSummary;
  subtasks: SubtasksDashboardSummary;
  personalSubtasks: SubtasksDashboardSummary;
};
