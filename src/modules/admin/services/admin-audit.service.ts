import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PlatformAdminAuditEventEntity,
  type PlatformAdminAuditOutcome,
} from '../entities';

const AGENCY_CONNECTION = 'agency';
const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /(password|passphrase|hash|token|secret|authorization|cookie|otp|totp|two.?factor|2fa|code)/i;
const SENSITIVE_VALUE =
  /(\$argon2|bearer\s+[a-z0-9._~+/-]+=*|eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+)/i;
const SAFE_PUBLIC_SECURITY_KEYS = new Set(['twoFactorEnabled']);

export function sanitizeAdminAuditMetadata(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') {
    return SENSITIVE_VALUE.test(value) ? REDACTED : value;
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== 'object') {
    return '[UNSUPPORTED]';
  }

  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAdminAuditMetadata(item, seen));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] =
      SENSITIVE_KEY.test(key) && !SAFE_PUBLIC_SECURITY_KEYS.has(key)
        ? REDACTED
        : sanitizeAdminAuditMetadata(item, seen);
  }
  return sanitized;
}

export type RecordAdminAuditEvent = {
  actorAdminId?: string | null;
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  outcome: PlatformAdminAuditOutcome;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class AdminAuditService {
  constructor(
    @InjectRepository(PlatformAdminAuditEventEntity, AGENCY_CONNECTION)
    private readonly auditRepository: Repository<PlatformAdminAuditEventEntity>,
  ) {}

  record(input: RecordAdminAuditEvent): Promise<PlatformAdminAuditEventEntity> {
    const event = this.auditRepository.create({
      actorAdminId: input.actorAdminId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      outcome: input.outcome,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: sanitizeAdminAuditMetadata(input.metadata ?? {}) as Record<
        string,
        unknown
      >,
    });

    return this.auditRepository.save(event);
  }
}
