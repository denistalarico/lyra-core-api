import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { NotificationExplicitRecipient } from '../../notifications/types';
import { TeamMember } from '../entities';

type TeamRecipientInput = {
  userId?: string | null;
  interestReason: NotificationInterestReason;
};

type TeamMemberNotificationInput = {
  member: TeamMember;
  actorUserId?: string | null;
  occurredAt?: Date;
  recipients?: TeamRecipientInput[];
};

@Injectable()
export class TeamNotificationPublisher {
  private readonly logger = new Logger(TeamNotificationPublisher.name);

  constructor(
    private readonly notificationEventProcessor: NotificationEventProcessorService,
  ) {}

  publishMemberInvited(input: TeamMemberNotificationInput) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.member_invited',
      eventIdParts: [
        'team.member_invited',
        input.member.id,
        input.member.userId,
        this.timestampFor(input.member.createdAt),
      ],
      title: 'Convite para o time',
      body: `Você foi adicionado ao time como ${input.member.displayName}.`,
    });
  }

  publishMemberActivated(input: TeamMemberNotificationInput) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.member_activated',
      eventIdParts: [
        'team.member_activated',
        input.member.id,
        input.member.userId,
        this.timestampFor(input.occurredAt ?? input.member.updatedAt),
      ],
      title: 'Conta ativada',
      body: `Sua conta no time foi ativada.`,
    });
  }

  publishMemberDeactivated(input: TeamMemberNotificationInput) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.member_deactivated',
      eventIdParts: [
        'team.member_deactivated',
        input.member.id,
        input.member.userId,
        this.timestampFor(input.occurredAt ?? input.member.updatedAt),
      ],
      title: 'Conta desativada',
      body: `Sua conta no time foi desativada.`,
    });
  }

  publishDepartmentChanged(
    input: TeamMemberNotificationInput & {
      previousDepartmentId?: string | null;
    },
  ) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.department_changed',
      eventIdParts: [
        'team.department_changed',
        input.member.id,
        input.member.departmentId,
        this.timestampFor(input.occurredAt ?? input.member.updatedAt),
      ],
      title: 'Departamento alterado',
      body: `Seu departamento foi atualizado.`,
      payload: {
        previousDepartmentId: input.previousDepartmentId ?? null,
        departmentId: input.member.departmentId,
      },
    });
  }

  publishRoleChanged(
    input: TeamMemberNotificationInput & {
      previousRoleName?: string | null;
    },
  ) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.role_changed',
      eventIdParts: [
        'team.role_changed',
        input.member.id,
        input.member.roleName,
        this.timestampFor(input.occurredAt ?? input.member.updatedAt),
      ],
      title: 'Função alterada',
      body: `Sua função no time foi atualizada.`,
      payload: {
        previousRoleName: input.previousRoleName ?? null,
        roleName: input.member.roleName,
      },
    });
  }

  publishSkillAssigned(
    input: TeamMemberNotificationInput & {
      skillId: string;
      occurredAt?: Date;
    },
  ) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.skill_assigned',
      eventIdParts: [
        'team.skill_assigned',
        input.member.id,
        input.skillId,
        this.timestampFor(input.occurredAt),
      ],
      title: 'Nova habilidade atribuída',
      body: `Uma nova habilidade foi atribuída a você.`,
      payload: {
        skillId: input.skillId,
      },
    });
  }

  publishOnboardingStarted(input: TeamMemberNotificationInput) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.onboarding_started',
      eventIdParts: [
        'team.onboarding_started',
        input.member.id,
        this.timestampFor(input.occurredAt ?? input.member.updatedAt),
      ],
      title: 'Onboarding iniciado',
      body: `Seu onboarding foi iniciado.`,
    });
  }

  publishOnboardingTaskAssigned(
    input: TeamMemberNotificationInput & {
      taskId?: string | null;
      taskTitle?: string | null;
    },
  ) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.onboarding_task_assigned',
      eventIdParts: [
        'team.onboarding_task_assigned',
        input.member.id,
        input.taskId,
        this.timestampFor(input.occurredAt),
      ],
      title: 'Tarefa de onboarding atribuída',
      body: `Uma nova tarefa de onboarding foi atribuída a você.`,
      payload: {
        taskId: input.taskId ?? null,
        taskTitle: input.taskTitle ?? null,
      },
    });
  }

  publishOnboardingCompleted(input: TeamMemberNotificationInput) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.onboarding_completed',
      eventIdParts: [
        'team.onboarding_completed',
        input.member.id,
        this.timestampFor(input.occurredAt ?? input.member.updatedAt),
      ],
      title: 'Onboarding concluído',
      body: `Seu onboarding foi concluído.`,
    });
  }

  publishOffboardingStarted(input: TeamMemberNotificationInput) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.offboarding_started',
      eventIdParts: [
        'team.offboarding_started',
        input.member.id,
        this.timestampFor(input.occurredAt ?? input.member.updatedAt),
      ],
      title: 'Offboarding iniciado',
      body: `Seu offboarding foi iniciado.`,
    });
  }

  publishDocumentRequested(
    input: TeamMemberNotificationInput & {
      documentType?: string | null;
    },
  ) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.document_requested',
      eventIdParts: [
        'team.document_requested',
        input.member.id,
        input.documentType,
        this.timestampFor(input.occurredAt),
      ],
      title: 'Documento solicitado',
      body: `Um documento foi solicitado para você.`,
      payload: {
        documentType: input.documentType ?? null,
      },
    });
  }

  publishAttendanceMissing(
    input: TeamMemberNotificationInput & {
      referenceDate?: string | null;
    },
  ) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.attendance_missing',
      eventIdParts: [
        'team.attendance_missing',
        input.member.id,
        input.referenceDate,
        this.timestampFor(input.occurredAt),
      ],
      title: 'Registro de ponto pendente',
      body: `Está faltando um registro de ponto.`,
      payload: {
        referenceDate: input.referenceDate ?? null,
      },
    });
  }

  publishAttendanceRequiresReview(
    input: TeamMemberNotificationInput & {
      attendanceEntryId?: string | null;
    },
  ) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.attendance_requires_review',
      eventIdParts: [
        'team.attendance_requires_review',
        input.member.id,
        input.attendanceEntryId,
        this.timestampFor(input.occurredAt),
      ],
      title: 'Registro de ponto para revisão',
      body: `Um registro de ponto precisa de revisão.`,
      payload: {
        attendanceEntryId: input.attendanceEntryId ?? null,
      },
    });
  }

  publishTimeEntryRequiresApproval(
    input: TeamMemberNotificationInput & {
      attendanceEntryId?: string | null;
    },
  ) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.time_entry_requires_approval',
      eventIdParts: [
        'team.time_entry_requires_approval',
        input.member.id,
        input.attendanceEntryId,
        this.timestampFor(input.occurredAt),
      ],
      title: 'Lançamento de horas para aprovação',
      body: `Um lançamento de horas precisa de aprovação.`,
      payload: {
        attendanceEntryId: input.attendanceEntryId ?? null,
      },
    });
  }

  publishTimeEntryApproved(
    input: TeamMemberNotificationInput & {
      attendanceEntryId?: string | null;
    },
  ) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.time_entry_approved',
      eventIdParts: [
        'team.time_entry_approved',
        input.member.id,
        input.attendanceEntryId,
        this.timestampFor(input.occurredAt),
      ],
      title: 'Lançamento de horas aprovado',
      body: `Seu lançamento de horas foi aprovado.`,
      payload: {
        attendanceEntryId: input.attendanceEntryId ?? null,
      },
    });
  }

  publishLeaveRequestReceived(
    input: TeamMemberNotificationInput & {
      leaveRequestId?: string | null;
    },
  ) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.leave_request_received',
      eventIdParts: [
        'team.leave_request_received',
        input.member.id,
        input.leaveRequestId,
        this.timestampFor(input.occurredAt),
      ],
      title: 'Solicitação de ausência recebida',
      body: `Uma solicitação de ausência precisa da sua aprovação.`,
      payload: {
        leaveRequestId: input.leaveRequestId ?? null,
      },
    });
  }

  publishLeaveRequestResolved(
    input: TeamMemberNotificationInput & {
      leaveRequestId?: string | null;
      approved?: boolean | null;
    },
  ) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.leave_request_resolved',
      eventIdParts: [
        'team.leave_request_resolved',
        input.member.id,
        input.leaveRequestId,
        this.timestampFor(input.occurredAt),
      ],
      title: 'Solicitação de ausência resolvida',
      body: `Sua solicitação de ausência foi resolvida.`,
      payload: {
        leaveRequestId: input.leaveRequestId ?? null,
        approved: input.approved ?? null,
      },
    });
  }

  publishOnboardingStepDue(
    input: TeamMemberNotificationInput & {
      stepId?: string | null;
      dueDate?: string | null;
    },
  ) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.onboarding_step_due',
      eventIdParts: [
        'team.onboarding_step_due',
        input.member.id,
        input.stepId,
        input.dueDate,
      ],
      title: 'Etapa de onboarding próxima do vencimento',
      body: `Uma etapa do seu onboarding está próxima do vencimento.`,
      payload: {
        stepId: input.stepId ?? null,
        dueDate: input.dueDate ?? null,
      },
    });
  }

  publishContractExpiring(
    input: TeamMemberNotificationInput & {
      contractId?: string | null;
      validUntil?: string | null;
    },
  ) {
    return this.publishMemberEvent({
      ...input,
      eventType: 'team.contract_expiring',
      eventIdParts: [
        'team.contract_expiring',
        input.member.id,
        input.contractId,
        input.validUntil,
      ],
      title: 'Contrato perto do vencimento',
      body: `O contrato vinculado a você está perto do vencimento.`,
      payload: {
        contractId: input.contractId ?? null,
        validUntil: input.validUntil ?? null,
      },
    });
  }

  private async publishMemberEvent(input: TeamMemberNotificationInput & {
    eventType: string;
    eventIdParts: Array<string | null | undefined>;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
  }) {
    const recipients = this.normalizeRecipients(
      input.recipients ?? this.defaultRecipients(input.member),
      input.actorUserId,
    );

    if (recipients.length === 0) {
      return;
    }

    try {
      await this.notificationEventProcessor.process({
        eventId: this.buildEventId(input.eventIdParts),
        eventType: input.eventType,
        tenantId: input.member.tenantId,
        workspaceId: input.member.workspaceId,
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'team',
        actorType: NotificationActorType.USER,
        actorUserId: input.actorUserId ?? null,
        resourceType: 'team_member',
        resourceId: input.member.id,
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        recipients,
        payload: {
          title: input.title,
          body: input.body,
          actionUrl: this.resolveActionUrl(input.member),
          memberId: input.member.id,
          memberDisplayName: input.member.displayName,
          status: input.member.status,
          ...input.payload,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish ${input.eventType} for team member ${input.member.id} tenant ${input.member.tenantId} workspace ${input.member.workspaceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private defaultRecipients(member: TeamMember): TeamRecipientInput[] {
    return [
      {
        userId: member.userId,
        interestReason: NotificationInterestReason.PARTICIPANT,
      },
    ];
  }

  private normalizeRecipients(
    recipients: TeamRecipientInput[],
    actorUserId?: string | null,
  ): NotificationExplicitRecipient[] {
    const normalized = new Map<string, NotificationInterestReason>();

    for (const recipient of recipients) {
      const userId = recipient.userId?.trim();

      if (!userId || userId === actorUserId) {
        continue;
      }

      if (!normalized.has(userId)) {
        normalized.set(userId, recipient.interestReason);
      }
    }

    return Array.from(normalized.entries()).map(
      ([userId, interestReason]) => ({
        userId,
        interestReason,
      }),
    );
  }

  private resolveActionUrl(member: TeamMember) {
    return `/team/members/${member.id}`;
  }

  private buildEventId(parts: Array<string | null | undefined>) {
    return parts.map((part) => part ?? 'none').join(':');
  }

  private timestampFor(value?: Date | string | null) {
    if (!value) {
      return new Date().toISOString();
    }

    return value instanceof Date ? value.toISOString() : value;
  }
}
