import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { LoginRequestContext } from '../../auth/utils/login-context.util';
import { renderTransactionalEmail } from '../../email/templates/transactional-email.template';
import { EmailService } from '../../email/email.service';
import { DataSource, LessThan, Not, Repository } from 'typeorm';
import {
  AdminIdentityGateway,
  resolveAdminIdentityRecord,
} from '../contracts/admin-identity.gateway';
import type {
  CreateAdminInvitationDto,
  ListAdminInvitationsQueryDto,
} from '../dto/admin-internal-users.dto';
import {
  PlatformAdminInvitationEntity,
  PlatformAdminSessionEntity,
  PlatformInternalAdminEntity,
} from '../entities';
import type { AdminPrincipal } from '../types/admin-access.types';
import {
  adminIdentityReference,
  identityColumns,
  normalizeAdminEmail,
} from '../utils/admin-identity.util';
import { AdminAuditService } from './admin-audit.service';
import { AdminInvitationTokenService } from './admin-invitation-token.service';
import { AdminIdentityLifecycleService } from './admin-identity-lifecycle.service';
import { AdminRolePolicyService } from './admin-role-policy.service';

const AGENCY_CONNECTION = 'agency';
const DEFAULT_TTL_MS = 72 * 60 * 60 * 1000;

@Injectable()
export class AdminInvitationsService {
  constructor(
    @InjectRepository(PlatformAdminInvitationEntity, AGENCY_CONNECTION)
    private readonly invitationRepository: Repository<PlatformAdminInvitationEntity>,
    @InjectRepository(PlatformInternalAdminEntity, AGENCY_CONNECTION)
    private readonly adminRepository: Repository<PlatformInternalAdminEntity>,
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    private readonly identityGateway: AdminIdentityGateway,
    private readonly rolePolicy: AdminRolePolicyService,
    private readonly tokenService: AdminInvitationTokenService,
    private readonly auditService: AdminAuditService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    @Optional()
    private readonly identityLifecycle?: AdminIdentityLifecycleService,
  ) {}

  async create(
    principal: AdminPrincipal,
    dto: CreateAdminInvitationDto,
    client: LoginRequestContext,
  ) {
    const normalizedEmail = normalizeAdminEmail(dto.email);
    try {
      this.rolePolicy.assertCanGrant(principal, dto.roleKey);
      await this.expirePending(normalizedEmail);
      const pending = await this.invitationRepository.findOne({
        where: { normalizedEmail, status: 'pending' },
      });
      if (pending) {
        throw new ConflictException(
          'A valid pending invitation already exists for this email.',
        );
      }
      await this.assertNoExistingAdmin(normalizedEmail);
    } catch (error) {
      await this.auditDenied(principal, null, 'invite', client, error);
      throw error;
    }

    const { token, hash } = this.tokenService.create();
    const invitation = this.invitationRepository.create({
      email: normalizedEmail,
      normalizedEmail,
      roleKey: dto.roleKey,
      status: 'pending',
      tokenHash: hash,
      expiresAt: new Date(Date.now() + this.getTtlMs()),
      acceptedAt: null,
      cancelledAt: null,
      invitedByAdminId: principal.adminId,
      acceptedByUserId: null,
      metadata: {},
    });
    try {
      await this.invitationRepository.save(invitation);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'A valid pending invitation already exists for this email.',
        );
      }
      throw error;
    }
    await this.sendInvitationEmail(invitation, token, principal.displayName);
    await this.auditService.record({
      actorAdminId: principal.adminId,
      actorUserId: principal.userId,
      action: 'admin.internal_user.invited',
      targetType: 'platform_admin_invitation',
      targetId: invitation.id,
      outcome: 'success',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: {
        invitationId: invitation.id,
        identityExists: await this.hasUniqueIdentity(normalizedEmail),
      },
    });
    return this.toSafeInvitation(invitation, principal, principal.displayName);
  }

  async list(principal: AdminPrincipal, query: ListAdminInvitationsQueryDto) {
    await this.expirePending();
    const builder = this.invitationRepository
      .createQueryBuilder('invitation')
      .orderBy('invitation.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    if (query.status) {
      builder.andWhere('invitation.status = :status', { status: query.status });
    }
    if (query.roleKey) {
      builder.andWhere('invitation.roleKey = :roleKey', {
        roleKey: query.roleKey,
      });
    }
    if (query.search) {
      builder.andWhere('invitation.normalizedEmail ILIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }
    const [items, total] = await builder.getManyAndCount();
    const safeItems = await Promise.all(
      items.map(async (invitation) =>
        this.toSafeInvitation(
          invitation,
          principal,
          await this.getInviterName(invitation.invitedByAdminId),
        ),
      ),
    );
    return {
      items: safeItems,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async get(principal: AdminPrincipal, invitationId: string) {
    const invitation = await this.requireInvitation(invitationId);
    await this.expireInvitationIfNeeded(invitation);
    return this.toSafeInvitation(
      invitation,
      principal,
      await this.getInviterName(invitation.invitedByAdminId),
    );
  }

  async resend(
    principal: AdminPrincipal,
    invitationId: string,
    client: LoginRequestContext,
  ) {
    const invitation = await this.requireInvitation(invitationId);
    try {
      this.rolePolicy.assertCanGrant(principal, invitation.roleKey);
      if (
        invitation.status === 'accepted' ||
        invitation.status === 'cancelled'
      ) {
        throw new ConflictException(
          'Accepted or cancelled invitations cannot be resent.',
        );
      }
      await this.assertNoExistingAdmin(invitation.normalizedEmail);
    } catch (error) {
      await this.auditDenied(
        principal,
        invitation.id,
        'invitation_resend',
        client,
        error,
      );
      throw error;
    }
    const { token, hash } = this.tokenService.create();
    invitation.tokenHash = hash;
    invitation.status = 'pending';
    invitation.expiresAt = new Date(Date.now() + this.getTtlMs());
    invitation.acceptedAt = null;
    invitation.cancelledAt = null;
    await this.invitationRepository.save(invitation);
    await this.sendInvitationEmail(invitation, token, principal.displayName);
    await this.auditInvitation(
      principal,
      invitation,
      'admin.internal_user.invitation_resent',
      client,
    );
    return this.toSafeInvitation(invitation, principal, principal.displayName);
  }

  async cancel(
    principal: AdminPrincipal,
    invitationId: string,
    client: LoginRequestContext,
  ) {
    const invitation = await this.requireInvitation(invitationId);
    try {
      this.rolePolicy.assertCanGrant(principal, invitation.roleKey);
      if (invitation.status !== 'pending') {
        throw new ConflictException(
          'Only pending invitations can be cancelled.',
        );
      }
    } catch (error) {
      await this.auditDenied(
        principal,
        invitation.id,
        'invitation_cancel',
        client,
        error,
      );
      throw error;
    }
    invitation.status = 'cancelled';
    invitation.cancelledAt = new Date();
    await this.invitationRepository.save(invitation);
    await this.auditInvitation(
      principal,
      invitation,
      'admin.internal_user.invitation_cancelled',
      client,
    );
    return this.toSafeInvitation(invitation, principal, principal.displayName);
  }

  async validate(rawToken: string) {
    const invitation = await this.findByToken(rawToken);
    await this.assertInvitationUsable(invitation);
    const candidates = await this.identityGateway.findCandidatesByEmail(
      invitation.normalizedEmail,
    );
    const identity =
      candidates.length === 1
        ? resolveAdminIdentityRecord(candidates[0])
        : null;
    return {
      valid: true,
      emailMasked: maskEmail(invitation.email),
      roleKey: invitation.roleKey,
      expiresAt: invitation.expiresAt,
      identityExists: Boolean(
        identity &&
        identity.source === 'agency' &&
        identity.status === 'active',
      ),
    };
  }

  async accept(rawToken: string, client: LoginRequestContext) {
    const tokenHash = this.tokenService.hash(rawToken);
    const result = await this.dataSource.transaction(async (manager) => {
      const invitation = await manager.findOne(PlatformAdminInvitationEntity, {
        where: { tokenHash },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invitation) return { kind: 'invalid' as const };
      if (
        invitation.status === 'pending' &&
        invitation.expiresAt.getTime() <= Date.now()
      ) {
        invitation.status = 'expired';
        await manager.save(invitation);
        return { kind: 'expired' as const };
      }
      if (invitation.status !== 'pending') {
        return { kind: invitation.status as 'accepted' | 'cancelled' };
      }
      const candidates = await this.identityGateway.findCandidatesByEmail(
        invitation.normalizedEmail,
      );
      if (candidates.length === 0) {
        return {
          kind: 'provisioning_required' as const,
          invitation,
        };
      }
      if (candidates.length > 1) {
        return { kind: 'ambiguous_identity' as const };
      }
      const identity = resolveAdminIdentityRecord(candidates[0]);
      if (!identity) return { kind: 'ambiguous_identity' as const };
      if (
        identity.source === 'platform_admin' &&
        identity.status === 'pending'
      ) {
        return { kind: 'provisioning_required' as const, invitation };
      }
      const columns = identityColumns(identity.reference);
      let admin = await manager.findOne(PlatformInternalAdminEntity, {
        where:
          identity.reference.source === 'agency'
            ? {
                identitySource: 'agency',
                identityTenantId: identity.reference.tenantId,
                userId: identity.reference.userId,
              }
            : {
                identitySource: 'platform_admin',
                platformAdminIdentityId: identity.reference.identityId,
              },
        lock: { mode: 'pessimistic_write' },
      });
      if (admin && admin.status !== 'pending') {
        return { kind: 'existing_admin' as const };
      }
      if (!admin) {
        admin = manager.create(PlatformInternalAdminEntity, {
          ...columns,
          createdBy: invitation.invitedByAdminId,
          metadata: {},
        });
      }
      admin.status = 'active';
      admin.roleKey = invitation.roleKey;
      admin.twoFactorRequired = true;
      admin.updatedBy =
        identity.reference.source === 'agency'
          ? identity.reference.userId
          : null;
      await manager.save(admin);
      invitation.status = 'accepted';
      invitation.acceptedAt = new Date();
      invitation.acceptedByUserId =
        identity.reference.source === 'agency'
          ? identity.reference.userId
          : null;
      await manager.save(invitation);
      await manager.update(
        PlatformAdminInvitationEntity,
        {
          normalizedEmail: invitation.normalizedEmail,
          status: 'pending',
          id: Not(invitation.id),
        },
        { status: 'cancelled', cancelledAt: new Date() },
      );
      await manager.update(
        PlatformAdminSessionEntity,
        { adminId: admin.id, status: 'active' },
        { status: 'revoked', revokedAt: new Date() },
      );
      return {
        kind: 'accepted_now' as const,
        invitation,
        admin,
        identity,
      };
    });

    if (result.kind === 'invalid') {
      throw new NotFoundException('Administrative invitation is invalid.');
    }
    if (result.kind === 'expired') {
      throw new GoneException('Administrative invitation has expired.');
    }
    if (result.kind === 'accepted') {
      throw new ConflictException(
        'Administrative invitation was already accepted.',
      );
    }
    if (result.kind === 'cancelled') {
      throw new GoneException('Administrative invitation was cancelled.');
    }
    if (result.kind === 'provisioning_required') {
      if (!this.identityLifecycle) {
        throw new ConflictException({
          code: 'ADMIN_IDENTITY_PROVISIONING_REQUIRED',
          message: 'Administrative identity provisioning is required.',
          identityExists: false,
        });
      }
      return this.identityLifecycle.provisionFromInvitation(
        result.invitation,
        client,
      );
    }
    if (result.kind === 'ambiguous_identity') {
      throw new ConflictException({
        code: 'ADMIN_IDENTITY_AMBIGUOUS',
        message:
          'More than one active identity matches this invitation. Contact platform support.',
      });
    }
    if (result.kind === 'existing_admin') {
      throw new ConflictException(
        'This identity already has an administrative authorization record.',
      );
    }
    if (result.kind !== 'accepted_now') {
      throw new ConflictException(
        'Administrative invitation cannot be accepted.',
      );
    }
    await this.auditService.record({
      actorAdminId: result.admin.id,
      actorUserId:
        result.identity.reference.source === 'agency'
          ? result.identity.reference.userId
          : null,
      action: 'admin.internal_user.invitation_accepted',
      targetType: 'platform_internal_admin',
      targetId: result.admin.id,
      outcome: 'success',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: {
        targetAdminId: result.admin.id,
        targetUserId:
          result.identity.reference.source === 'agency'
            ? result.identity.reference.userId
            : null,
        identitySource: result.identity.source,
        invitationId: result.invitation.id,
        identityExists: true,
      },
    });
    return {
      accepted: true,
      adminId: result.admin.id,
      requiresAuthentication: true,
      twoFactorRequired: true,
    };
  }

  private async assertInvitationUsable(
    invitation: PlatformAdminInvitationEntity,
  ) {
    if (
      invitation.status === 'pending' &&
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      invitation.status = 'expired';
      await this.invitationRepository.save(invitation);
    }
    if (invitation.status === 'expired') {
      throw new GoneException('Administrative invitation has expired.');
    }
    if (invitation.status === 'cancelled') {
      throw new GoneException('Administrative invitation was cancelled.');
    }
    if (invitation.status === 'accepted') {
      throw new ConflictException(
        'Administrative invitation was already accepted.',
      );
    }
  }

  private async findByToken(rawToken: string) {
    const invitation = await this.invitationRepository.findOne({
      where: { tokenHash: this.tokenService.hash(rawToken) },
    });
    if (!invitation) {
      throw new NotFoundException('Administrative invitation is invalid.');
    }
    return invitation;
  }

  private async requireInvitation(id: string) {
    const invitation = await this.invitationRepository.findOne({
      where: { id },
    });
    if (!invitation) {
      throw new NotFoundException('Administrative invitation not found.');
    }
    return invitation;
  }

  private expirePending(normalizedEmail?: string) {
    return this.invitationRepository.update(
      {
        status: 'pending',
        expiresAt: LessThan(new Date()),
        ...(normalizedEmail ? { normalizedEmail } : {}),
      },
      { status: 'expired' },
    );
  }

  private async expireInvitationIfNeeded(
    invitation: PlatformAdminInvitationEntity,
  ) {
    if (
      invitation.status === 'pending' &&
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      invitation.status = 'expired';
      await this.invitationRepository.save(invitation);
    }
  }

  private async assertNoExistingAdmin(normalizedEmail: string) {
    const candidates =
      await this.identityGateway.findCandidatesByEmail(normalizedEmail);
    for (const identity of candidates) {
      const resolved = resolveAdminIdentityRecord(identity);
      if (!resolved) continue;
      const existing = await this.adminRepository.findOne({
        where:
          resolved.reference.source === 'agency'
            ? {
                identitySource: 'agency',
                identityTenantId: resolved.reference.tenantId,
                userId: resolved.reference.userId,
              }
            : {
                identitySource: 'platform_admin',
                platformAdminIdentityId: resolved.reference.identityId,
              },
      });
      if (existing) {
        throw new ConflictException(
          'An administrative authorization already exists for this identity.',
        );
      }
    }
  }

  private async hasUniqueIdentity(normalizedEmail: string) {
    return (
      (await this.identityGateway.findCandidatesByEmail(normalizedEmail))
        .length === 1
    );
  }

  private async getInviterName(adminId: string) {
    const admin = await this.adminRepository.findOne({
      where: { id: adminId },
    });
    if (!admin) return 'Lyra Admin';
    const reference = adminIdentityReference(admin);
    const identity = reference
      ? await this.identityGateway.findByReference(reference)
      : null;
    return identity?.displayName ?? 'Lyra Admin';
  }

  private toSafeInvitation(
    invitation: PlatformAdminInvitationEntity,
    principal: AdminPrincipal,
    invitedByDisplayName: string,
  ) {
    const canSeeFullEmail = principal.permissions.includes(
      'admin.internal_users.create',
    );
    return {
      invitationId: invitation.id,
      email: canSeeFullEmail ? invitation.email : maskEmail(invitation.email),
      roleKey: invitation.roleKey,
      status: invitation.status,
      invitedByAdminId: invitation.invitedByAdminId,
      invitedByDisplayName,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      cancelledAt: invitation.cancelledAt,
      allowedActions: {
        resend:
          invitation.status !== 'accepted' &&
          invitation.status !== 'cancelled' &&
          this.rolePolicy
            .grantableRoles(principal)
            .includes(invitation.roleKey),
        cancel:
          invitation.status === 'pending' &&
          this.rolePolicy
            .grantableRoles(principal)
            .includes(invitation.roleKey),
      },
    };
  }

  private async sendInvitationEmail(
    invitation: PlatformAdminInvitationEntity,
    rawToken: string,
    invitedBy: string,
  ) {
    const webUrl = (
      this.configService.get<string>('ADMIN_WEB_URL') ??
      this.configService.get<string>('ADMIN_FRONTEND_URL') ??
      'http://localhost:3004'
    ).replace(/\/$/, '');
    const inviteUrl = `${webUrl}/accept-invite?token=${encodeURIComponent(rawToken)}`;
    const expires = new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(invitation.expiresAt);
    const { html, text } = renderTransactionalEmail({
      title: 'Convite para o Lyra Admin',
      intro: `${escapeHtml(invitedBy)} convidou você para administrar a plataforma Lyra com o papel <strong>${escapeHtml(invitation.roleKey)}</strong>.`,
      buttonLabel: 'Aceitar convite',
      buttonUrl: inviteUrl,
      secondaryText: `O convite é válido até ${escapeHtml(expires)}.`,
      footerText:
        'Se você não reconhece este convite, ignore esta mensagem. O link é pessoal e expira automaticamente.',
    });
    await this.emailService.sendEmail({
      to: invitation.email,
      subject: 'Convite para administrar a plataforma Lyra',
      html,
      text,
    });
  }

  private getTtlMs() {
    const configured = this.configService.get<string>('ADMIN_INVITATION_TTL');
    return parseDuration(configured) ?? DEFAULT_TTL_MS;
  }

  private auditInvitation(
    principal: AdminPrincipal,
    invitation: PlatformAdminInvitationEntity,
    action: string,
    client: LoginRequestContext,
  ) {
    return this.auditService.record({
      actorAdminId: principal.adminId,
      actorUserId: principal.userId,
      action,
      targetType: 'platform_admin_invitation',
      targetId: invitation.id,
      outcome: 'success',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: { invitationId: invitation.id },
    });
  }

  private async auditDenied(
    principal: AdminPrincipal,
    invitationId: string | null,
    reason: string,
    client: LoginRequestContext,
    error: unknown,
  ) {
    if (
      !(
        error instanceof ForbiddenException ||
        error instanceof ConflictException
      )
    ) {
      return;
    }
    await this.auditService.record({
      actorAdminId: principal.adminId,
      actorUserId: principal.userId,
      action: 'admin.internal_user.action_denied',
      targetType: invitationId ? 'platform_admin_invitation' : null,
      targetId: invitationId,
      outcome: 'denied',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: { invitationId, reason },
    });
  }
}

function parseDuration(value: string | undefined): number | null {
  const match = value?.trim().match(/^(\d+)(m|h|d)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unitMs =
    match[2].toLowerCase() === 'm'
      ? 60_000
      : match[2].toLowerCase() === 'h'
        ? 3_600_000
        : 86_400_000;
  const duration = amount * unitMs;
  return duration > 0 && duration <= 30 * 86_400_000 ? duration : null;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
