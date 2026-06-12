export type TeamDashboardPresenceCount = {
  status: string;
  count: number;
};

export type TeamDashboardDepartmentCount = {
  departmentId: string | null;
  count: number;
};

export type TeamDashboardSummary = {
  generatedAt: string;
  members: {
    total: number;
    active: number;
    inactive: number;
    archived: number;
    attendanceEnabled: number;
    linkedToUser: number;
    withoutDepartment: number;
  };
  presence: {
    known: number;
    unknown: number;
    byStatus: Record<string, number>;
  };
  departments: {
    total: number;
    distribution: TeamDashboardDepartmentCount[];
  };
  attendanceToday: {
    entries: number;
    membersWithEntries: number;
  };
};
