import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import { permissionsForClientAreaRole } from '../../client-area/client-area-permissions.catalog';
import { isClientAreaRole } from '../../client-area/client-area.types';
import { ClientAreaMembershipEntity } from '../../client-area/entities/client-area-membership.entity';
import { ClientAreaEligibilityService } from '../../client-area/services/client-area-eligibility.service';
import { EmailService } from '../../email/email.service';
import { renderTransactionalEmail } from '../../email/templates/transactional-email.template';
import type { SocialApprovalRequestEntity } from '../entities';
import { ClientAreaApprovalNotificationEntity } from './client-approval-notification.entity';
import type {
  ClientApprovalNotificationType,
  ClientApprovalNotifier,
} from '../client-approval-notifier.port';

const AGENCY_CONNECTION = 'agency';

/**
 * The one thing this service needs from the credentials stack: the agency's
 * SMTP override, so client mail leaves from the same sender as every other
 * Client Area email.
 *
 * Injected through a token against a narrow port rather than by importing the
 * concrete class, because that class pulls `otplib` (ESM) into the module
 * graph of anything that so much as type-references it — including every spec
 * that transitively reaches this file.
 */
export const CLIENT_APPROVAL_EMAIL_TRANSPORT =
  'CLIENT_APPROVAL_EMAIL_TRANSPORT';

export type ClientApprovalEmailTransport = {
  getEmailTransportOverride(
    tenantId: string,
    workspaceId?: string,
  ): Promise<Parameters<EmailService['sendEmail']>[0]['override']>;
};

export type { ClientApprovalNotificationType };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * AP3 — notifying the *client* that something needs them (§44–§52).
 *
 * RECIPIENTS ARE MEMBERSHIPS, RESOLVED AT DELIVERY TIME
 * -----------------------------------------------------
 *   active ClientAreaMembership for approval.companyContextId
 *   AND role preset contains `client_area.approvals.view`
 *   AND CRM eligibility still valid (CA4 chain)
 *   → recipient = membership.userId
 *
 * Never a Contact email, an Organization, an Agency Client or a managed
 * tenant. A Contact's email address is where an *invitation* is sent; it is
 * not evidence that a person holds access today, which is the only question
 * that matters here. Eligibility is re-checked in this method rather than
 * trusted from when the membership was granted, so a revoked membership or a
 * broken CRM chain stops mail going out even if the event was queued before
 * the revocation (§46).
 *
 * EMAIL ONLY, DELIBERATELY
 * ------------------------
 * The shared notification feed is Agency-only (CA0 §AD): recipient email
 * resolves through `workspace_users`, where a client identity has no row, and
 * the realtime channel feeds the Agency UI. Rather than force a client
 * recipient into that stack and produce unreadable notifications, this channel
 * sends email and records what it sent. Client in-app/realtime notifications
 * are named as debt in the AP3 report, not faked here.
 *
 * Failures never propagate: a notification problem must not roll back an
 * approval transition that already happened, exactly as the Agency publisher
 * behaves.
 */
@Injectable()
export class ClientApprovalNotificationService implements ClientApprovalNotifier {
  private readonly logger = new Logger(ClientApprovalNotificationService.name);

  constructor(
    @InjectRepository(ClientAreaMembershipEntity, AGENCY_CONNECTION)
    private readonly memberships: Repository<ClientAreaMembershipEntity>,
    @InjectRepository(AgencyUserSecuritySettingsEntity, AGENCY_CONNECTION)
    private readonly identities: Repository<AgencyUserSecuritySettingsEntity>,
    @InjectRepository(ClientAreaApprovalNotificationEntity, AGENCY_CONNECTION)
    private readonly ledger: Repository<ClientAreaApprovalNotificationEntity>,
    private readonly eligibility: ClientAreaEligibilityService,
    private readonly email: EmailService,
    @Inject(CLIENT_APPROVAL_EMAIL_TRANSPORT)
    private readonly credentials: ClientApprovalEmailTransport,
    private readonly config: ConfigService,
  ) {}

  /**
   * Active, approvals-capable, still-eligible memberships of the approval's
   * company. Exposed for tests and for callers that need the audience without
   * sending.
   */
  async resolveRecipients(approval: SocialApprovalRequestEntity) {
    const memberships = await this.memberships.find({
      where: {
        tenantId: approval.tenantId,
        workspaceId: approval.workspaceId,
        companyContextId: approval.companyContextId,
        status: 'active',
      },
    });

    const withPermission = memberships.filter(
      (membership) =>
        isClientAreaRole(membership.role) &&
        permissionsForClientAreaRole(membership.role).has(
          'client_area.approvals.view',
        ),
    );

    const eligible = await Promise.all(
      withPermission.map(async (membership) =>
        (await this.eligibility.isMembershipEligible(this.memberships.manager, {
          tenantId: membership.tenantId,
          userId: membership.userId,
          companyContextId: membership.companyContextId,
        }))
          ? membership
          : null,
      ),
    );

    return eligible.filter(
      (membership): membership is ClientAreaMembershipEntity =>
        membership !== null,
    );
  }

  async publish(
    type: ClientApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
    event?: { id: string; occurredAt: Date },
  ): Promise<void> {
    try {
      // Nothing the client never saw is worth telling them about.
      if (!approval.sentToClientAt) return;

      const recipients = await this.resolveRecipients(approval);
      if (recipients.length === 0) return;

      const sourceEventId = this.sourceEventId(type, approval, event);
      const emails = await this.resolveEmails(
        approval.tenantId,
        recipients.map((membership) => membership.userId),
      );

      for (const membership of recipients) {
        await this.deliverOne(
          type,
          approval,
          membership,
          sourceEventId,
          emails,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to publish client approval notification ${type} for ${approval.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Claim-then-send. The unique index on (tenant, event, user) makes the claim
   * the idempotency point: if a retry loses the race the insert conflicts, the
   * row is already there, and no second email goes out.
   */
  private async deliverOne(
    type: ClientApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
    membership: ClientAreaMembershipEntity,
    sourceEventId: string,
    emails: Map<string, string>,
  ) {
    const claimed = await this.ledger
      .createQueryBuilder()
      .insert()
      .into(ClientAreaApprovalNotificationEntity)
      .values({
        tenantId: approval.tenantId,
        workspaceId: approval.workspaceId,
        companyContextId: approval.companyContextId,
        approvalRequestId: approval.id,
        sourceEventId,
        eventType: `client_area.approval.${type}`,
        userId: membership.userId,
        membershipId: membership.id,
        channel: 'email',
        deliveredAt: null,
        skippedReason: null,
      })
      .orIgnore()
      .execute();

    // `orIgnore` returns no identifiers on conflict: already delivered.
    const claimedId = claimed.identifiers?.[0]?.id as string | undefined;
    if (!claimedId) return;

    const to = emails.get(membership.userId);
    if (!to) {
      await this.ledger.update(claimedId, { skippedReason: 'no_email' });
      return;
    }

    try {
      const message = this.render(type, approval);
      await this.email.sendEmail({
        to,
        ...message,
        override: await this.credentials.getEmailTransportOverride(
          approval.tenantId,
          approval.workspaceId,
        ),
      });
      await this.ledger.update(claimedId, { deliveredAt: new Date() });
    } catch (error) {
      await this.ledger.update(claimedId, { skippedReason: 'send_failed' });
      this.logger.error(
        `Client approval email failed for ${membership.userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * §51 — email comes from the Client Area identity
   * (`user_security_settings.current_email`), never `workspace_users` (which
   * has no client row) and never `Contact.email` (which is CRM data, not an
   * authenticated credential).
   */
  private async resolveEmails(tenantId: string, userIds: string[]) {
    if (userIds.length === 0) return new Map<string, string>();
    const rows = await this.identities.find({
      where: { tenantId, userId: In(userIds) },
    });
    return new Map(
      rows
        .filter((row) => row.currentEmail?.trim())
        .map((row) => [row.userId, row.currentEmail.trim()]),
    );
  }

  /** Stable per (type, approval, transition moment), matching AP2's shape. */
  private sourceEventId(
    type: ClientApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
    event?: { id: string; occurredAt: Date },
  ) {
    // AP4 — a reply is a comment, not an approval transition: there is no
    // dedicated timestamp column on the approval row for it, and two replies
    // could otherwise collide on `approval.updatedAt`. The comment's own id
    // is the stable, always-distinct identity.
    if (type === 'agency_reply' && event)
      return `client_area.approval.${type}:${approval.id}:${event.id}`;
    const occurredAt =
      (type === 'awaiting_client' && approval.sentToClientAt) ||
      (type === 'superseded' && approval.supersededAt) ||
      (type === 'cancelled' && approval.cancelledAt) ||
      event?.occurredAt ||
      approval.updatedAt ||
      new Date();
    return `client_area.approval.${type}:${approval.id}:${occurredAt.toISOString()}`;
  }

  /** §47 — the action URL is always the Client Area route, never Agency. */
  private actionUrl(approval: SocialApprovalRequestEntity) {
    const base = (
      this.config.get<string>('CLIENT_AREA_FRONTEND_URL') ??
      this.config.get<string>('AGENCY_FRONTEND_URL') ??
      'http://localhost:3003'
    ).replace(/\/$/, '');
    return `${base}/client-area/companies/${encodeURIComponent(
      approval.companyContextId,
    )}/approvals/${encodeURIComponent(approval.id)}`;
  }

  private render(
    type: ClientApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
  ) {
    const title = escapeHtml(approval.title);
    const version = escapeHtml(approval.subjectVersionLabel);
    const url = this.actionUrl(approval);
    const productName =
      this.config.get<string>('CLIENT_AREA_PRODUCT_NAME') ?? 'Área do Cliente';

    const copy: Record<
      ClientApprovalNotificationType,
      { subject: string; heading: string; intro: string; button: string }
    > = {
      awaiting_client: {
        subject: `Aprovação pendente: ${approval.title}`,
        heading: 'Uma aprovação aguarda você',
        intro: `<strong>${title}</strong> (${version}) foi enviado para a sua aprovação.`,
        button: 'Ver aprovação',
      },
      superseded: {
        subject: `Nova versão disponível: ${approval.title}`,
        heading: 'Uma nova versão substituiu esta',
        intro: `<strong>${title}</strong> (${version}) foi substituído por uma versão mais recente.`,
        button: 'Ver na Área do Cliente',
      },
      cancelled: {
        subject: `Aprovação cancelada: ${approval.title}`,
        heading: 'Uma aprovação foi cancelada',
        intro: `<strong>${title}</strong> (${version}) não precisa mais da sua avaliação.`,
        button: 'Ver na Área do Cliente',
      },
      agency_reply: {
        subject: `Nova resposta: ${approval.title}`,
        heading: 'A agência respondeu',
        // §25/§31 — the operator's name and the comment body never leave the
        // app and are not embedded in email copy; the email only tells the
        // client that something was said and sends them to read it in session.
        intro: `A agência respondeu sobre <strong>${title}</strong> (${version}).`,
        button: 'Ver conversa',
      },
    };

    const entry = copy[type];
    const { html, text } = renderTransactionalEmail({
      title: entry.heading,
      intro: entry.intro,
      buttonLabel: entry.button,
      buttonUrl: url,
      secondaryText: `Se o botão não funcionar, copie este endereço no navegador:<br/>${escapeHtml(url)}`,
      footerText: `Você recebeu este e-mail porque tem acesso à ${escapeHtml(productName)}.`,
    });

    return { subject: entry.subject, html, text };
  }
}
