import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import type { Request } from 'express';
import { DataSource, type EntityManager, In } from 'typeorm';
import { AgencyIdentityCredentialsService } from '../../agency/agency-identity-credentials.service';
import { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceUserEntity,
} from '../../agency/entities/agency-settings.entities';
import { AgencyClientCompanyContext } from '../../clients/entities/agency-client-company-context.entity';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import { ContactMethodEntity } from '../../contacts/entities/contact-method.entity';
import { extractLoginContext } from '../../auth/utils/login-context.util';
import {
  assertClientAreaEnabled,
  isClientAreaEnabled,
} from '../client-area.config';
import { assertClientAreaPasswordPolicy } from '../client-area-password.policy';
import {
  CLIENT_AREA_ERROR_CODES,
  CLIENT_AREA_INVITATION_TWO_FACTOR_TOKEN_TYPE,
  isClientAreaRole,
  isUuid,
  normalizeClientAreaEmail,
  type ClientAreaInvitationTwoFactorTokenPayload,
  type ClientAreaRole,
} from '../client-area.types';
import { ClientAreaInvitationEntity } from '../entities/client-area-invitation.entity';
import { ClientAreaIdentityContactEntity } from '../entities/client-area-identity-contact.entity';
import { ClientAreaMembershipEntity } from '../entities/client-area-membership.entity';
import { companyDisplayName } from './client-area-authorization.service';
import {
  ClientAreaAuthService,
  type ClientAreaAuthenticatedResponse,
} from './client-area-auth.service';
import {
  CLIENT_AREA_ROLE_LABELS,
  ClientAreaEmailService,
} from './client-area-email.service';
import {
  ClientAreaMemberAuditService,
  type ClientAreaCompanyTuple,
} from './client-area-member-audit.service';
import {
  ClientAreaMembershipService,
  clientAreaCodedError,
  isUniqueViolation,
} from './client-area-membership.service';
import { ClientAreaEligibilityService } from './client-area-eligibility.service';

const AGENCY_CONNECTION = 'agency';

/** Invitation validity (CA0 §Q: same 7 days as the Suite precedent). */
export const CLIENT_AREA_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 32 random bytes → 64 hex chars; only the sha256 is persisted. */
const INVITATION_TOKEN_BYTES = 32;
const TWO_FACTOR_TOKEN_TTL = '5m';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Authenticated Agency operator, from the verified Agency JWT. */
export type ClientAreaAgencyActor = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

export type AcceptClientAreaInvitationInput = {
  token: string;
  mode: 'signup' | 'login';
  password?: string;
  passwordConfirmation?: string;
  displayName?: string;
  twoFactorToken?: string;
  code?: string;
};

export type ClientAreaInvitationAcceptTwoFactorChallenge = {
  requiresTwoFactor: true;
  method: 'email' | 'authenticator';
  twoFactorToken: string;
};

export type ClientAreaInvitationAcceptedResponse =
  ClientAreaAuthenticatedResponse & { accepted: true };

type CompanyRef = {
  company: AgencyClientCompanyContext;
  displayName: string;
};

function invitationInvalid() {
  // One answer for unknown, revoked, accepted, expired and "the company,
  // client or inviter is no longer valid": a token is not enumerable.
  return new NotFoundException({
    statusCode: 404,
    error: 'Not Found',
    message: 'This invitation is invalid or has expired.',
    code: CLIENT_AREA_ERROR_CODES.invitationInvalid,
  });
}

function invitationNotFound() {
  return clientAreaCodedError(
    NotFoundException,
    404,
    CLIENT_AREA_ERROR_CODES.invitationNotFound,
    'Invitation not found.',
  );
}

function companyUnavailable() {
  return clientAreaCodedError(
    NotFoundException,
    404,
    CLIENT_AREA_ERROR_CODES.companyUnavailable,
    'Company is not available.',
  );
}

function ambiguous() {
  return clientAreaCodedError(
    ConflictException,
    409,
    CLIENT_AREA_ERROR_CODES.accountAmbiguous,
    'This email is linked to more than one account in the agency. Contact your agency.',
  );
}

function agencyOperator() {
  return clientAreaCodedError(
    ConflictException,
    409,
    CLIENT_AREA_ERROR_CODES.identityIsAgencyOperator,
    'This email belongs to an Agency user and cannot join the Client Area.',
  );
}

function hasCode(error: unknown, code: string) {
  return (
    error instanceof HttpException &&
    (error.getResponse() as { code?: unknown })?.code === code
  );
}

/**
 * CA2 — Client Area invitations (CA0 §P/§Q) and the Agency side of member
 * management.
 *
 * - Only an authorized Agency operator creates, resends or revokes an
 *   invitation, always through a Company Context of an Agency Client of the
 *   operator's own workspace. Tenant/workspace/client come from the Company
 *   Context row, never from the request.
 * - The plaintext token exists only in the email; the row stores sha256.
 * - An invitation authorizes nothing by itself: no login, directory entry or
 *   company context. Only the membership created at acceptance does.
 * - Acceptance: the token finds the row; company, role and email come from
 *   the row. An existing identity must authenticate (password + 2FA when
 *   enabled); a new one is created with the invitation email. Invitation,
 *   identity and membership commit in one transaction.
 */
@Injectable()
export class ClientAreaInvitationService {
  private readonly logger = new Logger(ClientAreaInvitationService.name);

  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    private readonly memberships: ClientAreaMembershipService,
    private readonly audit: ClientAreaMemberAuditService,
    private readonly emails: ClientAreaEmailService,
    private readonly credentials: AgencyIdentityCredentialsService,
    private readonly auth: ClientAreaAuthService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly eligibility: ClientAreaEligibilityService,
  ) {}

  // ─── Agency side ──────────────────────────────────────────────────────────

  async listForCompany(
    actor: ClientAreaAgencyActor,
    clientId: string,
    companyContextId: string,
  ) {
    const manager = this.dataSource.manager;
    const { company, displayName } = await this.resolveAgencyCompany(
      manager,
      actor,
      clientId,
      companyContextId,
    );
    await this.memberships.assertAgencyActor(
      manager,
      actor.tenantId,
      company.workspaceId,
      actor.userId,
    );

    const [memberships, invitations] = await Promise.all([
      manager.getRepository(ClientAreaMembershipEntity).find({
        where: { tenantId: company.tenantId, companyContextId: company.id },
        order: { grantedAt: 'DESC' },
      }),
      manager.getRepository(ClientAreaInvitationEntity).find({
        where: {
          tenantId: company.tenantId,
          companyContextId: company.id,
          status: 'pending',
        },
        order: { createdAt: 'DESC' },
      }),
    ]);

    const userIds = [...new Set(memberships.map((entry) => entry.userId))];
    const [identities, profiles, identityContacts] = userIds.length
      ? await Promise.all([
          manager.getRepository(AgencyUserSecuritySettingsEntity).find({
            where: { tenantId: company.tenantId, userId: In(userIds) },
          }),
          manager.getRepository(AgencyUserProfileEntity).find({
            where: { tenantId: company.tenantId, userId: In(userIds) },
          }),
          manager.getRepository(ClientAreaIdentityContactEntity).find({
            where: {
              tenantId: company.tenantId,
              userId: In(userIds),
              status: 'active',
            },
          }),
        ])
      : [[], [], []];
    const contactIds = [
      ...new Set(identityContacts.map((link) => link.contactId)),
    ];
    const contacts = contactIds.length
      ? await manager.getRepository(ContactEntity).find({
          where: {
            tenantId: company.tenantId,
            workspaceId: company.workspaceId,
            id: In(contactIds),
          },
        })
      : [];
    const emailOf = new Map(identities.map((i) => [i.userId, i.currentEmail]));
    const nameOf = new Map(profiles.map((p) => [p.userId, p.displayName]));
    const identityContactOf = new Map(
      identityContacts.map((link) => [link.userId, link.contactId]),
    );
    const contactNameOf = new Map(
      contacts.map((contact) => [contact.id, contact.displayName]),
    );
    const now = Date.now();

    return {
      company: {
        companyContextId: company.id,
        displayName,
        status: company.status,
      },
      clientAreaEnabled: isClientAreaEnabled(this.config),
      members: memberships
        .sort(
          (left, right) =>
            Number(right.status === 'active') -
            Number(left.status === 'active'),
        )
        .map((membership) => {
          const email = emailOf.get(membership.userId) ?? null;
          const contactId = identityContactOf.get(membership.userId) ?? null;
          return {
            membershipId: membership.id,
            userId: membership.userId,
            email,
            displayName: nameOf.get(membership.userId)?.trim() || email,
            contactId,
            contactDisplayName: contactId
              ? (contactNameOf.get(contactId) ?? null)
              : null,
            companies: [{ companyContextId: company.id, displayName }],
            role: membership.role,
            status: membership.status,
            grantedAt: membership.grantedAt,
            revokedAt: membership.revokedAt,
          };
        }),
      invitations: invitations.map((invitation) => ({
        invitationId: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        expired: invitation.expiresAt.getTime() <= now,
        createdAt: invitation.createdAt,
        contactId: invitation.contactId,
      })),
    };
  }

  /** Agency-only, company-scoped projection for the person-first CA4 invite UI. */
  async listEligibleContacts(
    actor: ClientAreaAgencyActor,
    clientId: string,
    companyContextId: string,
  ) {
    const manager = this.dataSource.manager;
    const { company } = await this.resolveAgencyCompany(
      manager,
      actor,
      clientId,
      companyContextId,
      { requireUsable: true },
    );
    await this.memberships.assertAgencyActor(
      manager,
      actor.tenantId,
      company.workspaceId,
      actor.userId,
    );
    const rows = await manager
      .getRepository(ContactEntity)
      .createQueryBuilder('person')
      .innerJoin(
        'contact_company_links',
        'link',
        `link.person_contact_id = person.id AND link.tenant_id = person.tenant_id
          AND link.workspace_id = person.workspace_id AND link.status = 'active'`,
      )
      .where('person.tenant_id = :tenantId', { tenantId: company.tenantId })
      .andWhere('person.workspace_id = :workspaceId', {
        workspaceId: company.workspaceId,
      })
      .andWhere('link.company_contact_id = :companyContactId', {
        companyContactId: company.companyContactId,
      })
      .andWhere(`person.type = 'person' AND person.status = 'active'`)
      .orderBy('person.display_name', 'ASC')
      .getMany();
    const methods = rows.length
      ? await manager.getRepository(ContactMethodEntity).find({
          where: {
            tenantId: company.tenantId,
            workspaceId: company.workspaceId,
            type: 'email',
            contactId: In(rows.map((row) => row.id)),
          },
          order: { isPrimary: 'DESC', createdAt: 'ASC' },
        })
      : [];
    return rows.map((contact) => {
      const email = methods.find(
        (method) =>
          method.contactId === contact.id &&
          EMAIL_PATTERN.test(method.value.trim()),
      );
      return {
        contactId: contact.id,
        contactDisplayName: contact.displayName,
        email: email?.value.trim() ?? null,
      };
    });
  }

  async invite(
    actor: ClientAreaAgencyActor,
    clientId: string,
    companyContextId: string,
    input: { contactId?: unknown; email?: unknown; role: unknown },
  ) {
    // Fail closed: an invitation emails a link to the Client Area, which is
    // useless (404) while the surface is off.
    assertClientAreaEnabled(this.config);

    if (!isClientAreaRole(input.role)) {
      throw clientAreaCodedError(
        BadRequestException,
        400,
        CLIENT_AREA_ERROR_CODES.roleInvalid,
        'Invalid Client Area role.',
      );
    }
    const role = input.role;
    const token = randomBytes(INVITATION_TOKEN_BYTES).toString('hex');

    const created = await this.runInvitationTransaction(async (manager) => {
      const ref = await this.resolveAgencyCompany(
        manager,
        actor,
        clientId,
        companyContextId,
        { requireUsable: true },
      );
      await this.memberships.assertAgencyActor(
        manager,
        actor.tenantId,
        ref.company.workspaceId,
        actor.userId,
      );
      const contact = await this.resolveInvitationContact(
        manager,
        ref.company,
        input,
      );
      const existingAccount = await this.assertInvitable(
        manager,
        ref.company,
        contact.emailNormalized,
      );

      const invitations = manager.getRepository(ClientAreaInvitationEntity);
      const pending = await invitations.findOne({
        where: {
          companyContextId: ref.company.id,
          emailNormalized: contact.emailNormalized,
          status: 'pending',
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (pending && pending.expiresAt.getTime() > Date.now()) {
        throw clientAreaCodedError(
          ConflictException,
          409,
          CLIENT_AREA_ERROR_CODES.invitationPending,
          'There is already a pending invitation for this email. Resend it instead.',
        );
      }

      if (pending) {
        // An expired pending invitation is history, not a conflict.
        await invitations.update(
          { id: pending.id, status: 'pending' },
          {
            status: 'revoked',
            revokedAt: new Date(),
            revokedByUserId: actor.userId,
          },
        );
        await this.audit.record(manager, {
          company: tupleOf(ref.company),
          action: 'invitation_revoked',
          actorSurface: 'agency',
          actorUserId: actor.userId,
          invitationId: pending.id,
          targetEmail: pending.email,
          metadata: { reason: 'expired_replaced' },
        });
      }

      const invitation = await this.insertInvitation(manager, {
        company: tupleOf(ref.company),
        contactId: contact.contactId,
        email: contact.email,
        emailNormalized: contact.emailNormalized,
        role,
        token,
        invitedByUserId: actor.userId,
      });
      await this.audit.record(manager, {
        company: tupleOf(ref.company),
        action: 'invited',
        actorSurface: 'agency',
        actorUserId: actor.userId,
        invitationId: invitation.id,
        targetEmail: invitation.email,
        newRole: role,
        metadata: { existingAccount },
      });

      return { invitation, ref, existingAccount };
    });

    const delivery = await this.deliver(created.invitation, token, created.ref);

    return {
      invitation: this.projectInvitation(created.invitation),
      existingAccount: created.existingAccount,
      delivery,
    };
  }

  /**
   * New token, new expiry, old token dead: the pending row is revoked and
   * points at a fresh row (`superseded_by_invitation_id`), so every token
   * ever sent stays traceable and no token is ever reused.
   */
  async resend(
    actor: ClientAreaAgencyActor,
    clientId: string,
    companyContextId: string,
    invitationId: string,
  ) {
    assertClientAreaEnabled(this.config);

    if (!isUuid(invitationId)) {
      throw invitationNotFound();
    }
    const token = randomBytes(INVITATION_TOKEN_BYTES).toString('hex');

    const created = await this.runInvitationTransaction(async (manager) => {
      const ref = await this.resolveAgencyCompany(
        manager,
        actor,
        clientId,
        companyContextId,
        { requireUsable: true },
      );
      await this.memberships.assertAgencyActor(
        manager,
        actor.tenantId,
        ref.company.workspaceId,
        actor.userId,
      );

      const invitations = manager.getRepository(ClientAreaInvitationEntity);
      const previous = await invitations.findOne({
        where: {
          id: invitationId,
          tenantId: ref.company.tenantId,
          companyContextId: ref.company.id,
          status: 'pending',
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!previous) {
        throw invitationNotFound();
      }

      const existingAccount = await this.assertInvitable(
        manager,
        ref.company,
        previous.emailNormalized,
      );

      await invitations.update(
        { id: previous.id, status: 'pending' },
        {
          status: 'revoked',
          revokedAt: new Date(),
          revokedByUserId: actor.userId,
        },
      );
      const invitation = await this.insertInvitation(manager, {
        company: tupleOf(ref.company),
        contactId: await this.assertStoredInvitationContact(
          manager,
          ref.company,
          previous,
        ),
        email: previous.email,
        emailNormalized: previous.emailNormalized,
        role: previous.role,
        token,
        invitedByUserId: actor.userId,
      });
      await invitations.update(
        { id: previous.id },
        { supersededByInvitationId: invitation.id },
      );
      await this.audit.record(manager, {
        company: tupleOf(ref.company),
        action: 'invitation_resent',
        actorSurface: 'agency',
        actorUserId: actor.userId,
        invitationId: invitation.id,
        targetEmail: invitation.email,
        newRole: invitation.role,
        metadata: { previousInvitationId: previous.id },
      });

      return { invitation, ref, existingAccount };
    });

    const delivery = await this.deliver(created.invitation, token, created.ref);

    return {
      invitation: this.projectInvitation(created.invitation),
      existingAccount: created.existingAccount,
      delivery,
    };
  }

  /** Revokes a pending invitation. Never deletes; its token stops working. */
  async revokeInvitation(
    actor: ClientAreaAgencyActor,
    clientId: string,
    companyContextId: string,
    invitationId: string,
  ) {
    if (!isUuid(invitationId)) {
      throw invitationNotFound();
    }

    return this.dataSource.transaction(async (manager) => {
      const { company } = await this.resolveAgencyCompany(
        manager,
        actor,
        clientId,
        companyContextId,
      );
      await this.memberships.assertAgencyActor(
        manager,
        actor.tenantId,
        company.workspaceId,
        actor.userId,
      );

      const invitations = manager.getRepository(ClientAreaInvitationEntity);
      const invitation = await invitations.findOne({
        where: {
          id: invitationId,
          tenantId: company.tenantId,
          companyContextId: company.id,
          status: 'pending',
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!invitation) {
        throw invitationNotFound();
      }

      const revokedAt = new Date();
      await invitations.update(
        { id: invitation.id, status: 'pending' },
        { status: 'revoked', revokedAt, revokedByUserId: actor.userId },
      );
      await this.audit.record(manager, {
        company: tupleOf(company),
        action: 'invitation_revoked',
        actorSurface: 'agency',
        actorUserId: actor.userId,
        invitationId: invitation.id,
        targetEmail: invitation.email,
        previousRole: invitation.role,
      });

      return {
        invitation: this.projectInvitation({
          ...invitation,
          status: 'revoked',
        }),
      };
    });
  }

  async changeMemberRole(
    actor: ClientAreaAgencyActor,
    clientId: string,
    companyContextId: string,
    membershipId: string,
    role: unknown,
  ) {
    const { company } = await this.resolveAgencyCompany(
      this.dataSource.manager,
      actor,
      clientId,
      companyContextId,
    );
    const membership = await this.memberships.changeRole({
      tenantId: company.tenantId,
      companyContextId: company.id,
      membershipId,
      role: typeof role === 'string' ? role : '',
      changedByUserId: actor.userId,
    });

    return {
      member: {
        membershipId: membership.id,
        role: membership.role,
        status: membership.status,
      },
    };
  }

  async revokeMember(
    actor: ClientAreaAgencyActor,
    clientId: string,
    companyContextId: string,
    membershipId: string,
  ) {
    const { company } = await this.resolveAgencyCompany(
      this.dataSource.manager,
      actor,
      clientId,
      companyContextId,
    );
    const membership = await this.memberships.revoke({
      tenantId: company.tenantId,
      companyContextId: company.id,
      membershipId,
      revokedByUserId: actor.userId,
    });

    return {
      member: {
        membershipId: membership.id,
        role: membership.role,
        status: membership.status,
        revokedAt: membership.revokedAt,
      },
    };
  }

  // ─── Public (Client Area) side ────────────────────────────────────────────

  /** Minimal projection for the acceptance page. No internal ids. */
  async preview(token: unknown) {
    assertClientAreaEnabled(this.config);

    const manager = this.dataSource.manager;
    const invitation = await this.findUsableInvitation(manager, token);
    const ref = await this.resolveInvitationCompany(manager, invitation);
    const identities = await this.findIdentitiesByEmail(manager, invitation);

    if (identities.length > 1) throw ambiguous();
    if (await this.isEmailAgencyOperator(manager, invitation, identities)) {
      throw agencyOperator();
    }
    if (
      identities.length === 1 &&
      (await this.hasActiveMembership(manager, invitation, identities[0]))
    ) {
      throw this.memberships.membershipExists();
    }

    return {
      invitation: {
        companyDisplayName: ref.displayName,
        email: invitation.email,
        role: invitation.role,
        roleLabel: CLIENT_AREA_ROLE_LABELS[invitation.role],
        expiresAt: invitation.expiresAt,
        accountStatus: identities.length === 1 ? 'existing' : 'new',
      },
    };
  }

  async accept(
    input: AcceptClientAreaInvitationInput,
    req: Request,
  ): Promise<
    | ClientAreaInvitationAcceptedResponse
    | ClientAreaInvitationAcceptTwoFactorChallenge
  > {
    assertClientAreaEnabled(this.config);

    const client = extractLoginContext(req);
    const manager = this.dataSource.manager;
    const invitation = await this.findUsableInvitation(manager, input.token);
    await this.resolveInvitationCompany(manager, invitation);
    const identities = await this.findIdentitiesByEmail(manager, invitation);

    // Phase 1 — prove who is accepting, outside the transaction (argon2 is
    // slow and must not hold the invitation lock).
    let authenticatedUserId: string | null = null;
    let signup: { passwordHash: string; displayName: string } | null = null;

    if (identities.length > 1) {
      await this.recordBlocked(invitation, 'account_ambiguous');
      throw ambiguous();
    }

    if (await this.isEmailAgencyOperator(manager, invitation, identities)) {
      await this.recordBlocked(invitation, 'agency_operator');
      throw agencyOperator();
    }

    if (identities.length === 1) {
      const identity = identities[0];

      if (input.mode !== 'login') {
        throw clientAreaCodedError(
          ConflictException,
          409,
          CLIENT_AREA_ERROR_CODES.invitationRequiresLogin,
          'This email already has an account. Sign in to accept the invitation.',
        );
      }

      if (input.twoFactorToken) {
        const payload = await this.verifyTwoFactorToken(input.twoFactorToken);
        if (
          payload.invitationId !== invitation.id ||
          payload.tenantId !== invitation.tenantId ||
          payload.sub !== identity.userId
        ) {
          throw this.invalidTwoFactorToken();
        }
        await this.credentials.verifyTwoFactorCode(
          payload.method,
          { tenantId: payload.tenantId, userId: payload.sub },
          typeof input.code === 'string' ? input.code : '',
        );
      } else {
        const password =
          typeof input.password === 'string' ? input.password : '';
        if (!(await this.credentials.verifyPassword(identity, password))) {
          await this.credentials.recordLoginEvent(
            identity.tenantId,
            identity.userId,
            'login_failed',
            client,
            'client_area',
          );
          throw new UnauthorizedException({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Invalid credentials',
            code: CLIENT_AREA_ERROR_CODES.invalidCredentials,
          });
        }

        // Never a silent downgrade: an identity with 2FA proves it here too.
        if (this.credentials.hasTwoFactorEnabled(identity)) {
          return this.createTwoFactorChallenge(identity, invitation);
        }
      }

      authenticatedUserId = identity.userId;
    } else {
      if (input.mode !== 'signup') {
        throw clientAreaCodedError(
          ConflictException,
          409,
          CLIENT_AREA_ERROR_CODES.invitationRequiresSignup,
          'There is no account for this email yet. Create one to accept the invitation.',
        );
      }

      const displayName =
        typeof input.displayName === 'string' ? input.displayName.trim() : '';
      if (displayName.length < 2 || displayName.length > 120) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Display name must have 2 to 120 characters.',
        });
      }
      const password = assertClientAreaPasswordPolicy({
        password: input.password,
        confirmation: input.passwordConfirmation,
        email: invitation.emailNormalized,
      });
      signup = {
        passwordHash: await this.credentials.hashPassword(password),
        displayName,
      };
    }

    // Phase 2 — one transaction: invitation, identity, membership, audit.
    const userId = await this.acceptInTransaction(
      invitation.id,
      authenticatedUserId,
      signup,
    );

    // Phase 3 — the person proved possession of the invitation and of the
    // account (or just created it): open the Client Area session directly.
    const identity = await manager
      .getRepository(AgencyUserSecuritySettingsEntity)
      .findOneOrFail({ where: { tenantId: invitation.tenantId, userId } });
    const session = await this.auth.createAuthenticatedSession(
      identity,
      client,
    );

    return { accepted: true, ...session };
  }

  async sendTwoFactorEmail(twoFactorToken: unknown) {
    assertClientAreaEnabled(this.config);

    const payload = await this.verifyTwoFactorToken(twoFactorToken);
    if (payload.method !== 'email') {
      throw this.invalidTwoFactorToken();
    }

    const manager = this.dataSource.manager;
    const invitation = await manager
      .getRepository(ClientAreaInvitationEntity)
      .findOne({
        where: {
          id: payload.invitationId,
          tenantId: payload.tenantId,
          status: 'pending',
        },
      });
    const identity = await manager
      .getRepository(AgencyUserSecuritySettingsEntity)
      .findOne({ where: { tenantId: payload.tenantId, userId: payload.sub } });

    if (
      !invitation ||
      invitation.expiresAt.getTime() <= Date.now() ||
      !identity ||
      normalizeClientAreaEmail(identity.currentEmail) !==
        invitation.emailNormalized
    ) {
      throw this.invalidTwoFactorToken();
    }

    await this.credentials.sendEmailTwoFactorCode(
      identity,
      'login',
      this.auth.getProductName(),
    );

    return { success: true };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async acceptInTransaction(
    invitationId: string,
    authenticatedUserId: string | null,
    signup: { passwordHash: string; displayName: string } | null,
  ): Promise<string> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const invitation = await manager
          .getRepository(ClientAreaInvitationEntity)
          .findOne({
            where: { id: invitationId },
            lock: { mode: 'pessimistic_write' },
          });

        // Loser of a concurrent accept, or revoked/expired meanwhile.
        if (
          !invitation ||
          invitation.status !== 'pending' ||
          invitation.expiresAt.getTime() <= Date.now()
        ) {
          throw invitationInvalid();
        }

        // Serializes identity creation per (tenant, email): two invitations
        // of the same email to different companies cannot both create an
        // identity.
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `client_area_identity:${invitation.tenantId}:${invitation.emailNormalized}`,
        ]);

        await this.resolveInvitationCompany(manager, invitation);
        if (!invitation.contactId) throw invitationInvalid();
        await this.eligibility.assertContactEligibleForCompany(manager, {
          tenantId: invitation.tenantId,
          workspaceId: invitation.workspaceId,
          contactId: invitation.contactId,
          companyContextId: invitation.companyContextId,
        });
        const identities = await this.findIdentitiesByEmail(
          manager,
          invitation,
        );

        if (identities.length > 1) throw ambiguous();

        let userId: string;
        if (authenticatedUserId) {
          if (
            identities.length !== 1 ||
            identities[0].userId !== authenticatedUserId
          ) {
            throw invitationInvalid();
          }
          userId = authenticatedUserId;
        } else {
          if (identities.length !== 0 || !signup) {
            throw clientAreaCodedError(
              ConflictException,
              409,
              CLIENT_AREA_ERROR_CODES.invitationRequiresLogin,
              'This email already has an account. Sign in to accept the invitation.',
            );
          }
          userId = await this.createIdentity(manager, invitation, signup);
        }

        await this.eligibility.linkIdentityInTransaction(manager, {
          tenantId: invitation.tenantId,
          workspaceId: invitation.workspaceId,
          userId,
          contactId: invitation.contactId,
          linkedByUserId: invitation.invitedByUserId,
        });

        if (
          await this.isEmailAgencyOperator(manager, invitation, [
            { userId } as AgencyUserSecuritySettingsEntity,
          ])
        ) {
          throw agencyOperator();
        }

        let membership: ClientAreaMembershipEntity;
        try {
          membership = await this.memberships.grantInTransaction(manager, {
            tenantId: invitation.tenantId,
            companyContextId: invitation.companyContextId,
            userId,
            role: invitation.role,
            // The inviter must still be an active operator of the workspace:
            // an invitation of someone who left the agency dies with them.
            grantedByUserId: invitation.invitedByUserId,
          });
        } catch (error) {
          if (
            hasCode(error, CLIENT_AREA_ERROR_CODES.grantorInvalid) ||
            hasCode(error, CLIENT_AREA_ERROR_CODES.companyUnavailable)
          ) {
            throw invitationInvalid();
          }
          throw error;
        }

        const acceptedAt = new Date();
        const updated = await manager
          .getRepository(ClientAreaInvitationEntity)
          .update(
            { id: invitation.id, status: 'pending' },
            {
              status: 'accepted',
              acceptedAt,
              acceptedUserId: userId,
              acceptedMembershipId: membership.id,
            },
          );
        if (!updated.affected) throw invitationInvalid();

        await this.audit.record(manager, {
          company: invitation,
          action: 'invitation_accepted',
          actorSurface: 'client_area',
          actorUserId: userId,
          invitationId: invitation.id,
          membershipId: membership.id,
          targetUserId: userId,
          targetEmail: invitation.email,
          newRole: invitation.role,
          metadata: { newIdentity: !authenticatedUserId },
        });

        return userId;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw this.memberships.membershipExists();
      }
      throw error;
    }
  }

  private async createIdentity(
    manager: EntityManager,
    invitation: ClientAreaInvitationEntity,
    signup: { passwordHash: string; displayName: string },
  ): Promise<string> {
    const security = manager.getRepository(AgencyUserSecuritySettingsEntity);
    const created = await security.save(
      security.create({
        tenantId: invitation.tenantId,
        currentEmail: invitation.emailNormalized,
        passwordHash: signup.passwordHash,
        passwordUpdatedAt: new Date(),
        twoFactorEnabled: false,
        twoFactorMethod: 'authenticator',
        twoFactorSecretEncrypted: null,
        twoFactorPendingSecretEncrypted: null,
        // A fresh `user_id`, never a `workspace_users` row.
        userId: randomUUID(),
      }),
    );

    const profiles = manager.getRepository(AgencyUserProfileEntity);
    await profiles.save(
      profiles.create({
        tenantId: invitation.tenantId,
        userId: created.userId,
        displayName: signup.displayName,
        email: invitation.emailNormalized,
      }),
    );

    return created.userId;
  }

  private async insertInvitation(
    manager: EntityManager,
    input: {
      company: ClientAreaCompanyTuple;
      contactId: string;
      email: string;
      emailNormalized: string;
      role: ClientAreaRole;
      token: string;
      invitedByUserId: string;
    },
  ) {
    const repo = manager.getRepository(ClientAreaInvitationEntity);
    return repo.save(
      repo.create({
        tenantId: input.company.tenantId,
        workspaceId: input.company.workspaceId,
        agencyClientId: input.company.agencyClientId,
        companyContextId: input.company.companyContextId,
        contactId: input.contactId,
        email: input.email,
        emailNormalized: input.emailNormalized,
        role: input.role,
        tokenHash: hashToken(input.token),
        expiresAt: new Date(Date.now() + CLIENT_AREA_INVITATION_TTL_MS),
        status: 'pending',
        invitedByUserId: input.invitedByUserId,
        acceptedUserId: null,
        acceptedMembershipId: null,
        acceptedAt: null,
        revokedByUserId: null,
        revokedAt: null,
        supersededByInvitationId: null,
      }),
    );
  }

  /**
   * Rules shared by invite and resend. Returns whether an identity already
   * exists for the email (administrative information only — no membership
   * is granted before acceptance).
   */
  private async assertInvitable(
    manager: EntityManager,
    company: AgencyClientCompanyContext,
    emailNormalized: string,
  ): Promise<boolean> {
    const probe = {
      tenantId: company.tenantId,
      companyContextId: company.id,
      emailNormalized,
    };
    const identities = await this.findIdentitiesByEmail(manager, probe);

    if (identities.length > 1) throw ambiguous();
    if (await this.isEmailAgencyOperator(manager, probe, identities)) {
      throw agencyOperator();
    }
    if (
      identities.length === 1 &&
      (await this.hasActiveMembership(manager, probe, identities[0]))
    ) {
      throw this.memberships.membershipExists();
    }

    return identities.length === 1;
  }

  private async assertStoredInvitationContact(
    manager: EntityManager,
    company: AgencyClientCompanyContext,
    invitation: ClientAreaInvitationEntity,
  ): Promise<string> {
    if (!invitation.contactId) {
      throw clientAreaCodedError(
        ConflictException,
        409,
        CLIENT_AREA_ERROR_CODES.contactIneligible,
        'Legacy invitations without a CRM person cannot be resent. Create a new invitation from the contact.',
      );
    }
    await this.eligibility.assertContactEligibleForCompany(manager, {
      tenantId: company.tenantId,
      workspaceId: company.workspaceId,
      contactId: invitation.contactId,
      companyContextId: company.id,
    });
    return invitation.contactId;
  }

  /** Resolve the CRM person first; the delivery address is then derived. */
  private async resolveInvitationContact(
    manager: EntityManager,
    company: AgencyClientCompanyContext,
    input: { contactId?: unknown; email?: unknown },
  ): Promise<{ contactId: string; email: string; emailNormalized: string }> {
    let contactId =
      typeof input.contactId === 'string' ? input.contactId : null;
    if (contactId && !isUuid(contactId)) contactId = null;
    if (!contactId) {
      const email = typeof input.email === 'string' ? input.email.trim() : '';
      const emailNormalized = normalizeClientAreaEmail(email);
      if (!EMAIL_PATTERN.test(email) || email.length > 160) {
        throw clientAreaCodedError(
          BadRequestException,
          400,
          CLIENT_AREA_ERROR_CODES.emailInvalid,
          'Invalid email.',
        );
      }
      const candidates = await manager
        .getRepository(ContactMethodEntity)
        .createQueryBuilder('method')
        .innerJoin(
          ContactEntity,
          'contact',
          `contact.id = method.contact_id AND contact.tenant_id = method.tenant_id AND contact.workspace_id = method.workspace_id`,
        )
        .where('method.tenant_id = :tenantId', { tenantId: company.tenantId })
        .andWhere('method.workspace_id = :workspaceId', {
          workspaceId: company.workspaceId,
        })
        .andWhere(
          `method.type = 'email' AND LOWER(BTRIM(method.value)) = :email`,
          { email: emailNormalized },
        )
        .andWhere(`contact.type = 'person'`)
        .select('contact.id', 'contactId')
        .getRawMany<{ contactId: string }>();
      const eligible = await Promise.all(
        candidates.map(async (candidate) => {
          try {
            await this.eligibility.assertContactEligibleForCompany(manager, {
              tenantId: company.tenantId,
              workspaceId: company.workspaceId,
              contactId: candidate.contactId,
              companyContextId: company.id,
            });
            return candidate.contactId;
          } catch {
            return null;
          }
        }),
      );
      const exact = [
        ...new Set(eligible.filter((id): id is string => Boolean(id))),
      ];
      if (exact.length !== 1) {
        throw clientAreaCodedError(
          ConflictException,
          409,
          CLIENT_AREA_ERROR_CODES.contactIneligible,
          'Email must resolve to exactly one eligible CRM person.',
        );
      }
      contactId = exact[0];
    }
    await this.eligibility.assertContactEligibleForCompany(manager, {
      tenantId: company.tenantId,
      workspaceId: company.workspaceId,
      contactId,
      companyContextId: company.id,
    });
    const methods = await manager.getRepository(ContactMethodEntity).find({
      where: {
        tenantId: company.tenantId,
        workspaceId: company.workspaceId,
        contactId,
        type: 'email',
      },
      order: { isPrimary: 'DESC', createdAt: 'ASC' },
    });
    const method = methods.find((candidate) =>
      EMAIL_PATTERN.test(candidate.value.trim()),
    );
    if (!method) {
      throw clientAreaCodedError(
        BadRequestException,
        400,
        CLIENT_AREA_ERROR_CODES.contactEmailUnavailable,
        'The CRM person needs a valid email before an invitation can be sent.',
      );
    }
    const email = method.value.trim();
    return {
      contactId,
      email,
      emailNormalized: normalizeClientAreaEmail(email),
    };
  }

  private findIdentitiesByEmail(
    manager: EntityManager,
    invitation: { tenantId: string; emailNormalized: string },
  ) {
    return manager
      .getRepository(AgencyUserSecuritySettingsEntity)
      .createQueryBuilder('identity')
      .where('identity.tenant_id = :tenantId', {
        tenantId: invitation.tenantId,
      })
      .andWhere('LOWER(BTRIM(identity.current_email)) = :email', {
        email: invitation.emailNormalized,
      })
      .getMany();
  }

  /**
   * Agency operator XOR Client Area member (CA0 §C): refused when any
   * identity with the email is an active Agency user, or when the email has
   * an active or pending Agency seat in the tenant.
   */
  private async isEmailAgencyOperator(
    manager: EntityManager,
    invitation: { tenantId: string; emailNormalized: string },
    identities: Array<Pick<AgencyUserSecuritySettingsEntity, 'userId'>>,
  ) {
    for (const identity of identities) {
      if (
        await this.memberships.isAgencyOperator(
          manager,
          invitation.tenantId,
          identity.userId,
        )
      ) {
        return true;
      }
    }

    return manager
      .getRepository(AgencyWorkspaceUserEntity)
      .createQueryBuilder('seat')
      .where('seat.tenant_id = :tenantId', { tenantId: invitation.tenantId })
      .andWhere('LOWER(BTRIM(seat.email)) = :email', {
        email: invitation.emailNormalized,
      })
      .andWhere("seat.status IN ('active','invited')")
      .getExists();
  }

  private hasActiveMembership(
    manager: EntityManager,
    invitation: { tenantId: string; companyContextId: string },
    identity: Pick<AgencyUserSecuritySettingsEntity, 'userId'>,
  ) {
    return manager.getRepository(ClientAreaMembershipEntity).exists({
      where: {
        tenantId: invitation.tenantId,
        companyContextId: invitation.companyContextId,
        userId: identity.userId,
        status: 'active',
      },
    });
  }

  private async findUsableInvitation(manager: EntityManager, token: unknown) {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
      throw invitationInvalid();
    }

    const invitation = await manager
      .getRepository(ClientAreaInvitationEntity)
      .findOne({ where: { tokenHash: hashToken(token) } });

    if (
      !invitation ||
      invitation.status !== 'pending' ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      throw invitationInvalid();
    }

    return invitation;
  }

  /**
   * The invitation's company must still be usable and its inviter still an
   * active operator of the workspace; any failure is the generic
   * "invalid invitation".
   */
  private async resolveInvitationCompany(
    manager: EntityManager,
    invitation: ClientAreaInvitationEntity,
  ): Promise<CompanyRef> {
    try {
      const { company, organization } =
        await this.memberships.findUsableCompany(
          manager,
          invitation.tenantId,
          invitation.companyContextId,
        );

      if (
        company.workspaceId !== invitation.workspaceId ||
        company.agencyClientId !== invitation.agencyClientId
      ) {
        throw invitationInvalid();
      }

      await this.memberships.assertAgencyActor(
        manager,
        invitation.tenantId,
        invitation.workspaceId,
        invitation.invitedByUserId,
      );

      return { company, displayName: companyDisplayName(organization) };
    } catch (error) {
      if (error instanceof HttpException) throw invitationInvalid();
      throw error;
    }
  }

  /**
   * The Company Context named by the Agency route, only if it belongs to an
   * Agency Client of the operator's own tenant/workspace — the path ids are a
   * request, the operator's JWT scope decides.
   */
  private async resolveAgencyCompany(
    manager: EntityManager,
    actor: ClientAreaAgencyActor,
    clientId: string,
    companyContextId: string,
    options: { requireUsable?: boolean } = {},
  ): Promise<CompanyRef> {
    if (
      !isUuid(clientId) ||
      !isUuid(companyContextId) ||
      !isUuid(actor.tenantId) ||
      !isUuid(actor.workspaceId)
    ) {
      throw companyUnavailable();
    }

    const company = await manager
      .getRepository(AgencyClientCompanyContext)
      .findOne({
        where: {
          id: companyContextId,
          tenantId: actor.tenantId,
          workspaceId: actor.workspaceId,
          agencyClientId: clientId,
        },
      });

    if (!company) {
      throw companyUnavailable();
    }

    if (options.requireUsable) {
      const { organization } = await this.memberships.findUsableCompany(
        manager,
        company.tenantId,
        company.id,
      );
      return { company, displayName: companyDisplayName(organization) };
    }

    const organization = await manager.getRepository(ContactEntity).findOne({
      where: {
        id: company.companyContactId,
        tenantId: company.tenantId,
        workspaceId: company.workspaceId,
      },
    });

    return {
      company,
      displayName: organization ? companyDisplayName(organization) : 'Empresa',
    };
  }

  private async runInvitationTransaction<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (error) {
      // Concurrent invite for the same (company, email) lost the race
      // against the partial unique index of pending invitations.
      if (isUniqueViolation(error)) {
        throw clientAreaCodedError(
          ConflictException,
          409,
          CLIENT_AREA_ERROR_CODES.invitationPending,
          'There is already a pending invitation for this email. Resend it instead.',
        );
      }
      throw error;
    }
  }

  private async deliver(
    invitation: ClientAreaInvitationEntity,
    token: string,
    ref: CompanyRef,
  ): Promise<'sent' | 'failed'> {
    try {
      await this.emails.sendInvitation({
        tenantId: invitation.tenantId,
        workspaceId: invitation.workspaceId,
        to: invitation.email,
        token,
        companyDisplayName: ref.displayName,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      });
      return 'sent';
    } catch (error) {
      // The invitation is committed; the operator sees the failure and can
      // resend (which issues a new token).
      this.logger.warn(
        `Client Area invitation ${invitation.id} email failed: ${(error as Error)?.message}`,
      );
      return 'failed';
    }
  }

  private async recordBlocked(
    invitation: ClientAreaInvitationEntity,
    reason: 'account_ambiguous' | 'agency_operator',
  ) {
    this.logger.warn(
      `Client Area invitation ${invitation.id} acceptance blocked: ${reason}`,
    );
    await this.dataSource.transaction((manager) =>
      this.audit.record(manager, {
        company: invitation,
        action: 'invitation_acceptance_blocked',
        actorSurface: 'client_area',
        actorUserId: null,
        invitationId: invitation.id,
        targetEmail: invitation.email,
        metadata: { reason },
      }),
    );
  }

  private projectInvitation(
    invitation: Pick<
      ClientAreaInvitationEntity,
      'id' | 'email' | 'role' | 'status' | 'expiresAt' | 'createdAt'
    >,
  ) {
    return {
      invitationId: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    };
  }

  private async createTwoFactorChallenge(
    identity: AgencyUserSecuritySettingsEntity,
    invitation: ClientAreaInvitationEntity,
  ): Promise<ClientAreaInvitationAcceptTwoFactorChallenge> {
    const method = this.credentials.getTwoFactorMethod(identity);

    if (method === 'email') {
      await this.credentials.sendEmailTwoFactorCode(
        identity,
        'login',
        this.auth.getProductName(),
      );
    }

    const payload: ClientAreaInvitationTwoFactorTokenPayload = {
      sub: identity.userId,
      tenantId: identity.tenantId,
      invitationId: invitation.id,
      typ: CLIENT_AREA_INVITATION_TWO_FACTOR_TOKEN_TYPE,
      method,
    };

    return {
      requiresTwoFactor: true,
      method,
      twoFactorToken: await this.jwtService.signAsync(payload, {
        secret: this.auth.getAccessSecret(),
        expiresIn: TWO_FACTOR_TOKEN_TTL,
        algorithm: 'HS256',
      }),
    };
  }

  private async verifyTwoFactorToken(
    token: unknown,
  ): Promise<ClientAreaInvitationTwoFactorTokenPayload> {
    try {
      if (typeof token !== 'string') throw new Error('missing');
      const payload =
        await this.jwtService.verifyAsync<ClientAreaInvitationTwoFactorTokenPayload>(
          token,
          { secret: this.auth.getAccessSecret(), algorithms: ['HS256'] },
        );

      if (
        payload.typ !== CLIENT_AREA_INVITATION_TWO_FACTOR_TOKEN_TYPE ||
        !isUuid(payload.sub) ||
        !isUuid(payload.tenantId) ||
        !isUuid(payload.invitationId) ||
        (payload.method !== 'email' && payload.method !== 'authenticator')
      ) {
        throw new Error('invalid_client_area_invite_2fa_token');
      }

      return payload;
    } catch {
      throw this.invalidTwoFactorToken();
    }
  }

  private invalidTwoFactorToken() {
    return new UnauthorizedException({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid 2FA token',
      code: CLIENT_AREA_ERROR_CODES.sessionInvalid,
    });
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function tupleOf(company: AgencyClientCompanyContext): ClientAreaCompanyTuple {
  return {
    tenantId: company.tenantId,
    workspaceId: company.workspaceId,
    agencyClientId: company.agencyClientId,
    companyContextId: company.id,
  };
}
