import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { DataSource } from 'typeorm';
import { AdminIdentityGateway } from '../contracts/admin-identity.gateway';
import {
  PlatformAdminAuditEventEntity,
  PlatformInternalAdminEntity,
} from '../entities';
import {
  type PlatformAdminRoleKey,
  isPlatformAdminRoleDowngrade,
} from '../types/admin-access.types';
import { normalizeAdminEmail } from '../utils/admin-identity.util';
import { sanitizeAdminAuditMetadata } from './admin-audit.service';

const AGENCY_CONNECTION = 'agency';
const BOOTSTRAP_SOURCE = 'bootstrap_cli';
const DEFAULT_LOCALE = 'pt-BR';
const DEFAULT_THEME = 'system';
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export type PlatformAdminBootstrapResultKind =
  | 'created'
  | 'updated'
  | 'unchanged';

export type BootstrapPlatformAdminInput = {
  email: string;
  requestedRole: PlatformAdminRoleKey;
  allowRoleChange: boolean;
};

export type BootstrapPlatformAdminResult = {
  result: PlatformAdminBootstrapResultKind;
  roleKey: PlatformAdminRoleKey;
  status: 'active';
  twoFactorRequired: true;
  identityTwoFactorEnabled: boolean;
  maskedEmail: string;
  roleChangeDenied: boolean;
};

export type PlatformAdminBootstrapErrorCode =
  | 'platform_admin_email_required'
  | 'platform_admin_identity_not_found'
  | 'platform_admin_identity_ambiguous'
  | 'platform_admin_bootstrap_failed';

export class PlatformAdminBootstrapError extends Error {
  constructor(readonly code: PlatformAdminBootstrapErrorCode) {
    super(code);
    this.name = 'PlatformAdminBootstrapError';
  }
}

type TransactionResult =
  | { ok: true; value: BootstrapPlatformAdminResult }
  | {
      ok: false;
      code:
        | 'platform_admin_identity_not_found'
        | 'platform_admin_identity_ambiguous';
    };

function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) {
    return '***';
  }

  return `${localPart.slice(0, 1)}***@${domain}`;
}

function auditMetadata(input: {
  requestedRole: PlatformAdminRoleKey;
  effectiveRole: PlatformAdminRoleKey;
  result: PlatformAdminBootstrapResultKind | 'denied' | 'failed';
  twoFactorEnabled: boolean;
}): Record<string, unknown> {
  return sanitizeAdminAuditMetadata({
    source: BOOTSTRAP_SOURCE,
    requestedRole: input.requestedRole,
    effectiveRole: input.effectiveRole,
    result: input.result,
    twoFactorEnabled: input.twoFactorEnabled,
  }) as Record<string, unknown>;
}

async function recordAudit(
  manager: EntityManager,
  input: {
    actorUserId: string | null;
    action:
      | 'admin.bootstrap.created'
      | 'admin.bootstrap.updated'
      | 'admin.bootstrap.unchanged'
      | 'admin.bootstrap.denied'
      | 'admin.bootstrap.failed';
    outcome: 'success' | 'denied' | 'failure';
    targetId: string | null;
    requestedRole: PlatformAdminRoleKey;
    effectiveRole: PlatformAdminRoleKey;
    result: PlatformAdminBootstrapResultKind | 'denied' | 'failed';
    twoFactorEnabled: boolean;
  },
): Promise<void> {
  const auditRepository = manager.getRepository(PlatformAdminAuditEventEntity);
  await auditRepository.save(
    auditRepository.create({
      actorAdminId: null,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: 'platform_internal_admin',
      targetId: input.targetId,
      outcome: input.outcome,
      ipAddress: null,
      userAgent: null,
      metadata: auditMetadata(input),
    }),
  );
}

@Injectable()
export class AdminBootstrapService {
  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly agencyDataSource: DataSource,
    private readonly identityGateway: AdminIdentityGateway,
  ) {}

  async bootstrap(
    input: BootstrapPlatformAdminInput,
  ): Promise<BootstrapPlatformAdminResult> {
    const normalizedEmail = normalizeAdminEmail(input.email);
    if (!normalizedEmail) {
      throw new PlatformAdminBootstrapError('platform_admin_email_required');
    }

    let resolvedActorUserId: string | null = null;
    let resolvedTwoFactorEnabled = false;

    try {
      const transactionResult =
        await this.agencyDataSource.transaction<TransactionResult>(
          async (manager) => {
            await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
              `platform-admin-bootstrap:${normalizedEmail}`,
            ]);

            const candidates = (
              await this.identityGateway.findCandidatesByEmail(normalizedEmail)
            ).filter(
              (candidate) =>
                candidate.status === 'active' &&
                normalizeAdminEmail(candidate.email) === normalizedEmail,
            );

            if (candidates.length === 0) {
              await recordAudit(manager, {
                actorUserId: null,
                action: 'admin.bootstrap.denied',
                outcome: 'denied',
                targetId: null,
                requestedRole: input.requestedRole,
                effectiveRole: input.requestedRole,
                result: 'denied',
                twoFactorEnabled: false,
              });
              return {
                ok: false,
                code: 'platform_admin_identity_not_found',
              };
            }

            if (candidates.length > 1) {
              await recordAudit(manager, {
                actorUserId: null,
                action: 'admin.bootstrap.denied',
                outcome: 'denied',
                targetId: null,
                requestedRole: input.requestedRole,
                effectiveRole: input.requestedRole,
                result: 'denied',
                twoFactorEnabled: false,
              });
              return {
                ok: false,
                code: 'platform_admin_identity_ambiguous',
              };
            }

            const identity = candidates[0];
            resolvedActorUserId = identity.userId;
            resolvedTwoFactorEnabled = identity.twoFactorEnabled;

            const adminRepository = manager.getRepository(
              PlatformInternalAdminEntity,
            );
            const existing = await this.findExistingAdmin(
              adminRepository,
              identity.tenantId,
              identity.userId,
            );

            if (!existing) {
              const created = await adminRepository.save(
                adminRepository.create({
                  identityTenantId: identity.tenantId,
                  userId: identity.userId,
                  status: 'active',
                  roleKey: input.requestedRole,
                  twoFactorRequired: true,
                  locale: DEFAULT_LOCALE,
                  theme: DEFAULT_THEME,
                  timezone: DEFAULT_TIMEZONE,
                  dateFormat: 'dd/MM/yyyy',
                  timeFormat: '24h',
                  lastAdminLoginAt: null,
                  createdBy: null,
                  updatedBy: null,
                  metadata: { source: BOOTSTRAP_SOURCE },
                }),
              );

              await recordAudit(manager, {
                actorUserId: identity.userId,
                action: 'admin.bootstrap.created',
                outcome: 'success',
                targetId: created.id,
                requestedRole: input.requestedRole,
                effectiveRole: created.roleKey,
                result: 'created',
                twoFactorEnabled: identity.twoFactorEnabled,
              });

              return {
                ok: true,
                value: this.toResult(
                  'created',
                  created.roleKey,
                  identity.email,
                  identity.twoFactorEnabled,
                  false,
                ),
              };
            }

            const roleChangeDenied =
              !input.allowRoleChange &&
              isPlatformAdminRoleDowngrade(
                existing.roleKey,
                input.requestedRole,
              );
            const effectiveRole = roleChangeDenied
              ? existing.roleKey
              : input.requestedRole;
            const needsUpdate =
              existing.status !== 'active' ||
              existing.twoFactorRequired !== true ||
              existing.roleKey !== effectiveRole;
            const result: PlatformAdminBootstrapResultKind = needsUpdate
              ? 'updated'
              : 'unchanged';

            if (needsUpdate) {
              existing.status = 'active';
              existing.roleKey = effectiveRole;
              existing.twoFactorRequired = true;
              await adminRepository.save(existing);
            }

            await recordAudit(manager, {
              actorUserId: identity.userId,
              action: roleChangeDenied
                ? 'admin.bootstrap.denied'
                : result === 'updated'
                  ? 'admin.bootstrap.updated'
                  : 'admin.bootstrap.unchanged',
              outcome: roleChangeDenied ? 'denied' : 'success',
              targetId: existing.id,
              requestedRole: input.requestedRole,
              effectiveRole,
              result,
              twoFactorEnabled: identity.twoFactorEnabled,
            });

            return {
              ok: true,
              value: this.toResult(
                result,
                effectiveRole,
                identity.email,
                identity.twoFactorEnabled,
                roleChangeDenied,
              ),
            };
          },
        );

      if (!transactionResult.ok) {
        throw new PlatformAdminBootstrapError(transactionResult.code);
      }

      return transactionResult.value;
    } catch (error) {
      if (error instanceof PlatformAdminBootstrapError) {
        throw error;
      }

      await this.recordFailureSafely({
        actorUserId: resolvedActorUserId,
        requestedRole: input.requestedRole,
        twoFactorEnabled: resolvedTwoFactorEnabled,
      });
      throw new PlatformAdminBootstrapError('platform_admin_bootstrap_failed');
    }
  }

  private findExistingAdmin(
    repository: Repository<PlatformInternalAdminEntity>,
    identityTenantId: string,
    userId: string,
  ): Promise<PlatformInternalAdminEntity | null> {
    return repository.findOne({
      where: { identityTenantId, userId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private toResult(
    result: PlatformAdminBootstrapResultKind,
    roleKey: PlatformAdminRoleKey,
    email: string,
    identityTwoFactorEnabled: boolean,
    roleChangeDenied: boolean,
  ): BootstrapPlatformAdminResult {
    return {
      result,
      roleKey,
      status: 'active',
      twoFactorRequired: true,
      identityTwoFactorEnabled,
      maskedEmail: maskEmail(email),
      roleChangeDenied,
    };
  }

  private async recordFailureSafely(input: {
    actorUserId: string | null;
    requestedRole: PlatformAdminRoleKey;
    twoFactorEnabled: boolean;
  }): Promise<void> {
    try {
      await this.agencyDataSource.transaction(async (manager) => {
        await recordAudit(manager, {
          actorUserId: input.actorUserId,
          action: 'admin.bootstrap.failed',
          outcome: 'failure',
          targetId: null,
          requestedRole: input.requestedRole,
          effectiveRole: input.requestedRole,
          result: 'failed',
          twoFactorEnabled: input.twoFactorEnabled,
        });
      });
    } catch {
      // The original failure is authoritative; audit persistence must not mask it.
    }
  }
}
