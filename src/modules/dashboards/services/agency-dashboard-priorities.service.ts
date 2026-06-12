import { Injectable } from '@nestjs/common';
import type {
  ProjectDashboardAttentionItem,
  ProjectsDashboardOverview,
  TaskDashboardAttentionItem,
} from '../../projects/types';
import type {
  AgencyDashboardActivitiesWidget,
  AgencyDashboardClientsWidget,
  AgencyDashboardFinanceWidget,
  AgencyDashboardPriority,
  AgencyDashboardPreset,
} from '../types';

@Injectable()
export class AgencyDashboardPrioritiesService {
  build(
    overview: ProjectsDashboardOverview | null,
    preset: AgencyDashboardPreset,
    sources?: {
      finance?: AgencyDashboardFinanceWidget | null;
      clients?: AgencyDashboardClientsWidget | null;
      activities?: AgencyDashboardActivitiesWidget | null;
    },
  ): AgencyDashboardPriority[] {
    const projectPriorities =
      overview?.projects.attentionItems.map(
        (project) => this.mapProject(project),
      ) ?? [];

    const taskSource =
      preset === 'member'
        ? overview?.personalTasks.attentionItems ?? []
        : overview?.tasks.attentionItems ?? [];

    const taskPriorities = taskSource.map(
      (task) => this.mapTask(task),
    );

    const financePriorities =
      preset === 'executive'
        ? this.buildFinancePriorities(sources?.finance)
        : [];

    const clientPriorities =
      preset !== 'member'
        ? this.buildClientPriorities(sources?.clients)
        : [];

    const activityPriorities =
      this.buildActivityPriorities(sources?.activities);

    return [
      ...projectPriorities,
      ...taskPriorities,
      ...financePriorities,
      ...clientPriorities,
      ...activityPriorities,
    ]
      .sort((a, b) => b.score - a.score)
      .slice(0, preset === 'member' ? 6 : 10);
  }

  private mapProject(
    project: ProjectDashboardAttentionItem,
  ): AgencyDashboardPriority {
    if (project.overdue) {
      return {
        id: `project-overdue:${project.id}`,
        type: 'overdue_project',
        severity: 'critical',
        title: 'Projeto atrasado',
        description: project.name,
        sourceModule: 'projects',
        href: project.href,
        entityId: project.id,
        dueAt: project.dueDate,
        score: 120 + this.priorityWeight(project.priority),
      };
    }

    if (project.ownerId === null) {
      return {
        id: `project-without-owner:${project.id}`,
        type: 'project_without_owner',
        severity: 'high',
        title: 'Projeto sem responsável',
        description: project.name,
        sourceModule: 'projects',
        href: project.href,
        entityId: project.id,
        dueAt: project.dueDate,
        score: 80 + this.priorityWeight(project.priority),
      };
    }

    if (project.dueSoon) {
      return {
        id: `project-due-soon:${project.id}`,
        type: 'project_due_soon',
        severity: project.priority === 'urgent' ? 'high' : 'medium',
        title: 'Prazo de projeto próximo',
        description: project.name,
        sourceModule: 'projects',
        href: project.href,
        entityId: project.id,
        dueAt: project.dueDate,
        score: 50 + this.priorityWeight(project.priority),
      };
    }

    return {
      id: `project-high-priority:${project.id}`,
      type: 'high_priority_project',
      severity: project.priority === 'urgent' ? 'high' : 'medium',
      title: 'Projeto prioritário',
      description: project.name,
      sourceModule: 'projects',
      href: project.href,
      entityId: project.id,
      dueAt: project.dueDate,
      score: 40 + this.priorityWeight(project.priority),
    };
  }

  private mapTask(
    task: TaskDashboardAttentionItem,
  ): AgencyDashboardPriority {
    if (task.overdue) {
      return {
        id: `task-overdue:${task.id}`,
        type: 'overdue_task',
        severity: 'critical',
        title: 'Tarefa atrasada',
        description: task.title,
        sourceModule: 'tasks',
        href: task.href,
        entityId: task.id,
        dueAt: task.dueDate,
        score: 130 + this.priorityWeight(task.priority),
      };
    }

    if (task.blocked) {
      return {
        id: `task-blocked:${task.id}`,
        type: 'blocked_task',
        severity: 'high',
        title: 'Tarefa bloqueada',
        description: task.blockedReason
          ? `${task.title}: ${task.blockedReason}`
          : task.title,
        sourceModule: 'tasks',
        href: task.href,
        entityId: task.id,
        dueAt: task.dueDate,
        score: 100 + this.priorityWeight(task.priority),
      };
    }

    if (task.dueToday) {
      return {
        id: `task-due-today:${task.id}`,
        type: 'task_due_today',
        severity: task.priority === 'urgent' ? 'high' : 'medium',
        title: 'Tarefa para hoje',
        description: task.title,
        sourceModule: 'tasks',
        href: task.href,
        entityId: task.id,
        dueAt: task.dueDate,
        score: 75 + this.priorityWeight(task.priority),
      };
    }

    if (task.assigneeId === null) {
      return {
        id: `task-without-assignee:${task.id}`,
        type: 'task_without_assignee',
        severity: 'medium',
        title: 'Tarefa sem responsável',
        description: task.title,
        sourceModule: 'tasks',
        href: task.href,
        entityId: task.id,
        dueAt: task.dueDate,
        score: 55 + this.priorityWeight(task.priority),
      };
    }

    if (task.dueThisWeek) {
      return {
        id: `task-due-soon:${task.id}`,
        type: 'task_due_soon',
        severity: task.priority === 'urgent' ? 'high' : 'medium',
        title: 'Prazo de tarefa próximo',
        description: task.title,
        sourceModule: 'tasks',
        href: task.href,
        entityId: task.id,
        dueAt: task.dueDate,
        score: 45 + this.priorityWeight(task.priority),
      };
    }

    return {
      id: `task-high-priority:${task.id}`,
      type: 'high_priority_task',
      severity: task.priority === 'urgent' ? 'high' : 'medium',
      title: 'Tarefa prioritária',
      description: task.title,
      sourceModule: 'tasks',
      href: task.href,
      entityId: task.id,
      dueAt: task.dueDate,
      score: 35 + this.priorityWeight(task.priority),
    };
  }

  private buildFinancePriorities(
    finance: AgencyDashboardFinanceWidget | null | undefined,
  ): AgencyDashboardPriority[] {
    if (!finance) return [];

    const priorities: AgencyDashboardPriority[] = [];

    if (finance.metrics.overdueReceivables > 0) {
      priorities.push({
        id: 'finance-overdue-receivables',
        type: 'overdue_receivables',
        severity: 'critical',
        title: 'Existem recebimentos vencidos',
        description:
          `${finance.currency} ${finance.metrics.overdueReceivables.toFixed(2)} em aberto e vencido.`,
        sourceModule: 'finance',
        href: '/finance/invoices?status=overdue',
        entityId: 'finance-overdue-receivables',
        dueAt: null,
        score: 150,
      });
    }

    if (finance.metrics.defaultRate >= 0.25) {
      priorities.push({
        id: 'finance-high-default-rate',
        type: 'high_default_rate',
        severity:
          finance.metrics.defaultRate >= 0.5 ? 'critical' : 'high',
        title: 'Inadimplência elevada',
        description:
          `${Math.round(finance.metrics.defaultRate * 100)}% da carteira a receber está vencida.`,
        sourceModule: 'finance',
        href: '/finance/overview',
        entityId: 'finance-high-default-rate',
        dueAt: null,
        score: finance.metrics.defaultRate >= 0.5 ? 145 : 110,
      });
    }

    if (finance.metrics.netMargin < 0) {
      priorities.push({
        id: 'finance-negative-margin',
        type: 'negative_net_margin',
        severity: 'critical',
        title: 'Margem líquida negativa',
        description:
          `${Math.round(finance.metrics.netMargin * 100)}% no período atual.`,
        sourceModule: 'finance',
        href: '/finance/profitability',
        entityId: 'finance-negative-margin',
        dueAt: null,
        score: 140,
      });
    }

    if (
      finance.metrics.revenueIssued > 0 &&
      finance.metrics.breakEvenPoint > 0 &&
      finance.metrics.revenueIssued < finance.metrics.breakEvenPoint
    ) {
      priorities.push({
        id: 'finance-below-break-even',
        type: 'below_break_even',
        severity: 'high',
        title: 'Receita abaixo do ponto de equilíbrio',
        description:
          `Receita emitida de ${finance.currency} ${finance.metrics.revenueIssued.toFixed(2)} para um ponto de equilíbrio de ${finance.currency} ${finance.metrics.breakEvenPoint.toFixed(2)}.`,
        sourceModule: 'finance',
        href: '/finance/overview',
        entityId: 'finance-below-break-even',
        dueAt: null,
        score: 105,
      });
    }

    return priorities;
  }

  private buildActivityPriorities(
    activities: AgencyDashboardActivitiesWidget | null | undefined,
  ): AgencyDashboardPriority[] {
    if (!activities || activities.overdue <= 0) {
      return [];
    }

    return [
      {
        id: 'activities-overdue',
        type: 'overdue_activities',
        severity: activities.overdue >= 5 ? 'high' : 'medium',
        title: 'Existem atividades atrasadas',
        description:
          `${activities.overdue} atividade(s) precisam de acompanhamento.`,
        sourceModule: 'activities',
        href: '/projects/activities?status=overdue',
        entityId: 'activities-overdue',
        dueAt: null,
        score: activities.overdue >= 5 ? 95 : 65,
      },
    ];
  }

  private buildClientPriorities(
    clients: AgencyDashboardClientsWidget | null | undefined,
  ): AgencyDashboardPriority[] {
    if (!clients) return [];

    const critical =
      (clients.byHealthStatus.critical ?? 0) +
      (clients.byHealthStatus.risk ?? 0);

    const attention = clients.byHealthStatus.attention ?? 0;
    const unknown = clients.byHealthStatus.unknown ?? 0;

    const priorities: AgencyDashboardPriority[] = [];

    if (critical > 0) {
      priorities.push({
        id: 'clients-critical-health',
        type: 'client_health_critical',
        severity: 'critical',
        title: 'Clientes em situação crítica',
        description: `${critical} cliente(s) precisam de intervenção.`,
        sourceModule: 'clients',
        href: '/clients?health=critical',
        entityId: 'clients-critical-health',
        dueAt: null,
        score: 135,
      });
    }

    if (attention > 0) {
      priorities.push({
        id: 'clients-attention-health',
        type: 'client_health_attention',
        severity: 'high',
        title: 'Clientes exigem atenção',
        description:
          `${attention} cliente(s) estão em nível de atenção.`,
        sourceModule: 'clients',
        href: '/clients?health=attention',
        entityId: 'clients-attention-health',
        dueAt: null,
        score: 100,
      });
    }

    if (unknown > 0) {
      priorities.push({
        id: 'clients-unknown-health',
        type: 'client_health_unknown',
        severity: 'info',
        title: 'Clientes sem avaliação de saúde',
        description:
          `${unknown} cliente(s) ainda não possuem classificação de saúde.`,
        sourceModule: 'clients',
        href: '/clients?health=unknown',
        entityId: 'clients-unknown-health',
        dueAt: null,
        score: 25,
      });
    }

    return priorities;
  }

  private priorityWeight(priority: string): number {
    if (priority === 'urgent') return 30;
    if (priority === 'high') return 15;
    if (priority === 'medium') return 5;
    return 0;
  }
}
