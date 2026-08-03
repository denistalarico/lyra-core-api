import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import type { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowAutomationGlobalConfigVersionEntity } from '../entities';
import type {
  LeadFlowAutomationActionConfig,
  LeadFlowAutomationConditionConfig,
  LeadFlowAutomationGlobalDefaults,
  LeadFlowAutomationGlobalDefaultsSnapshot,
  LeadFlowAutomationMessageConfig,
  LeadFlowAutomationSchedulePolicy,
  LeadFlowAutomationTriggerConfig,
  LeadFlowFollowupChannel,
} from '../types/leadflow-automation.types';

const AGENCY_CONNECTION = 'agency';
const WEEKDAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const FOLLOWUP_CHANNELS = new Set<LeadFlowFollowupChannel>([
  'whatsapp',
  'email',
  'sms',
  'facebook_messenger',
  'instagram_direct',
  'webchat',
]);

export interface LeadFlowAutomationEffectiveConfig {
  trigger: LeadFlowAutomationTriggerConfig;
  conditions: LeadFlowAutomationConditionConfig;
  actions: LeadFlowAutomationActionConfig;
  message: LeadFlowAutomationMessageConfig;
  schedulePolicy: LeadFlowAutomationSchedulePolicy;
  globalDefaults: LeadFlowAutomationGlobalDefaultsSnapshot;
  inheritedFields: string[];
}

export const DEFAULT_LEADFLOW_AUTOMATION_GLOBAL_DEFAULTS: LeadFlowAutomationGlobalDefaults =
  {
    schemaVersion: 1,
    timezone: 'UTC',
    businessHours: { enabled: false, windows: {} },
    crm: { pipelineRef: null, stageRef: null },
    channels: { defaultChannel: null },
    consent: { requireExplicitConsent: false },
    followUp: { defaultDelayHours: null, maxAttempts: null },
  };

/**
 * Immutable global-defaults store plus the pure effective-value resolver.
 * No automation instance is rewritten when a global version changes: the next
 * publication snapshots the resolved contract and historical versions keep
 * their own serialized values.
 */
@Injectable()
export class LeadFlowAutomationGlobalConfigService {
  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    @InjectRepository(
      LeadFlowAutomationGlobalConfigVersionEntity,
      AGENCY_CONNECTION,
    )
    private readonly versionsRepository: Repository<LeadFlowAutomationGlobalConfigVersionEntity>,
  ) {}

  async getCurrent(
    settings: LeadFlowClientSettingsEntity,
  ): Promise<LeadFlowAutomationGlobalDefaultsSnapshot> {
    const current = await this.versionsRepository.findOne({
      where: {
        tenantId: settings.tenantId,
        workspaceId: settings.workspaceId,
        settingsId: settings.id,
      },
      order: { version: 'DESC' },
    });

    return current ? this.toSnapshot(current) : this.fallbackSnapshot();
  }

  async createVersion(
    settings: LeadFlowClientSettingsEntity,
    config: unknown,
    expectedVersion: number | undefined,
    userId: string | null | undefined,
  ): Promise<LeadFlowAutomationGlobalDefaultsSnapshot> {
    const normalized = normalizeGlobalDefaults(config);

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(
        LeadFlowAutomationGlobalConfigVersionEntity,
      );
      const current = await repository.findOne({
        where: {
          tenantId: settings.tenantId,
          workspaceId: settings.workspaceId,
          settingsId: settings.id,
        },
        order: { version: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });
      const currentVersion = current?.version ?? 0;

      if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
        throw new ConflictException(
          'A versão dos padrões globais foi alterada. Atualize a tela e tente novamente.',
        );
      }

      const saved = await repository.save(
        repository.create({
          tenantId: settings.tenantId,
          workspaceId: settings.workspaceId,
          settingsId: settings.id,
          version: currentVersion + 1,
          config: normalized,
          createdById: userId ?? null,
        }),
      );

      return this.toSnapshot(saved);
    });
  }

  /**
   * `template < global < override`, with one safety exception: an explicit
   * consent requirement is monotonic. A local recipe can add consent, never
   * silently turn off a global consent gate.
   */
  resolve(
    globalDefaults: LeadFlowAutomationGlobalDefaultsSnapshot,
    input: {
      template?: Partial<LeadFlowAutomationEffectiveConfig>;
      override?: Partial<LeadFlowAutomationEffectiveConfig>;
    },
  ): LeadFlowAutomationEffectiveConfig {
    return resolveLeadFlowAutomationEffectiveConfig(globalDefaults, input);
  }

  private fallbackSnapshot(): LeadFlowAutomationGlobalDefaultsSnapshot {
    return {
      version: 0,
      source: 'fallback',
      createdAt: null,
      config: cloneDefaults(DEFAULT_LEADFLOW_AUTOMATION_GLOBAL_DEFAULTS),
    };
  }

  private toSnapshot(
    version: LeadFlowAutomationGlobalConfigVersionEntity,
  ): LeadFlowAutomationGlobalDefaultsSnapshot {
    return {
      version: version.version,
      source: 'persisted',
      createdAt: version.createdAt?.toISOString?.() ?? null,
      config: normalizeGlobalDefaults(version.config),
    };
  }
}

export function resolveLeadFlowAutomationEffectiveConfig(
  globalDefaults: LeadFlowAutomationGlobalDefaultsSnapshot,
  input: {
    template?: Partial<LeadFlowAutomationEffectiveConfig>;
    override?: Partial<LeadFlowAutomationEffectiveConfig>;
  },
): LeadFlowAutomationEffectiveConfig {
  const inheritedFields: string[] = [];
  const template = input.template ?? {};
  const override = input.override ?? {};
  const global = globalDefaults.config;

  const trigger = { ...(template.trigger ?? {}) };
  applyGlobal(
    trigger,
    'pipelineRef',
    global.crm.pipelineRef,
    'trigger.pipelineRef',
    inheritedFields,
  );
  applyGlobal(
    trigger,
    'stageRef',
    global.crm.stageRef,
    'trigger.stageRef',
    inheritedFields,
  );
  applyGlobal(
    trigger,
    'delayHours',
    global.followUp.defaultDelayHours,
    'trigger.delayHours',
    inheritedFields,
  );
  applyOverride(trigger, override.trigger);

  const conditions = { ...(template.conditions ?? {}) };
  applyGlobal(
    conditions,
    'businessHoursOnly',
    global.businessHours.enabled,
    'conditions.businessHoursOnly',
    inheritedFields,
  );
  const overrideConsent = override.conditions?.requireExplicitConsent === true;
  if (global.consent.requireExplicitConsent && !overrideConsent) {
    conditions.requireExplicitConsent = true;
    inheritedFields.push('conditions.requireExplicitConsent');
  } else if (override.conditions?.requireExplicitConsent !== undefined) {
    conditions.requireExplicitConsent =
      override.conditions.requireExplicitConsent;
  }
  applyOverride(conditions, withoutConsent(override.conditions));

  const actions = { ...(template.actions ?? {}) };
  applyGlobal(
    actions,
    'maxAttempts',
    global.followUp.maxAttempts,
    'actions.maxAttempts',
    inheritedFields,
  );
  applyOverride(actions, override.actions);

  const message = { ...(template.message ?? {}) };
  applyGlobal(
    message,
    'channel',
    global.channels.defaultChannel,
    'message.channel',
    inheritedFields,
  );
  applyOverride(message, override.message);

  const schedulePolicy = { ...(template.schedulePolicy ?? {}) };
  applyGlobal(
    schedulePolicy,
    'timezone',
    global.timezone,
    'schedulePolicy.timezone',
    inheritedFields,
  );
  applyGlobal(
    schedulePolicy,
    'respectBusinessHours',
    global.businessHours.enabled,
    'schedulePolicy.respectBusinessHours',
    inheritedFields,
  );
  applyOverride(schedulePolicy, override.schedulePolicy);

  return {
    trigger,
    conditions,
    actions,
    message,
    schedulePolicy,
    globalDefaults,
    inheritedFields,
  };
}

function applyGlobal<T extends Record<string, unknown>>(
  target: T,
  key: string,
  value: unknown,
  path: string,
  inheritedFields: string[],
): void {
  if (value !== null) {
    (target as Record<string, unknown>)[key] = value;
    inheritedFields.push(path);
  }
}

/** `null` is the reversible "inherit/reset" value for inheritable fields. */
function applyOverride<T extends Record<string, unknown>>(
  target: T,
  override: Record<string, unknown> | undefined,
): void {
  if (!override) return;
  for (const [key, value] of Object.entries(override)) {
    if (value !== null) (target as Record<string, unknown>)[key] = value;
  }
}

function withoutConsent(
  value: LeadFlowAutomationConditionConfig | undefined,
): Omit<LeadFlowAutomationConditionConfig, 'requireExplicitConsent'> {
  if (!value) return {};
  const { requireExplicitConsent: _ignored, ...rest } = value;
  return rest;
}

export function normalizeGlobalDefaults(
  value: unknown,
): LeadFlowAutomationGlobalDefaults {
  if (!isRecord(value)) {
    throw new BadRequestException('Os padrões globais devem ser um objeto.');
  }
  assertExactKeys(
    value,
    [
      'schemaVersion',
      'timezone',
      'businessHours',
      'crm',
      'channels',
      'consent',
      'followUp',
    ],
    'padrões globais',
  );
  if (value.schemaVersion !== 1) {
    throw new BadRequestException(
      'Versão de schema de padrões globais não suportada.',
    );
  }
  if (typeof value.timezone !== 'string' || !isValidTimeZone(value.timezone)) {
    throw new BadRequestException('Timezone global inválido.');
  }

  const businessHours = normalizeBusinessHours(value.businessHours);
  const crm = normalizeCrm(value.crm);
  const channels = normalizeChannels(value.channels);
  const consent = normalizeConsent(value.consent);
  const followUp = normalizeFollowUp(value.followUp);

  return {
    schemaVersion: 1,
    timezone: value.timezone,
    businessHours,
    crm,
    channels,
    consent,
    followUp,
  };
}

function normalizeBusinessHours(
  value: unknown,
): LeadFlowAutomationGlobalDefaults['businessHours'] {
  if (!isRecord(value))
    throw new BadRequestException('Horários globais inválidos.');
  assertExactKeys(value, ['enabled', 'windows'], 'horários globais');
  if (typeof value.enabled !== 'boolean' || !isRecord(value.windows)) {
    throw new BadRequestException('Horários globais inválidos.');
  }
  const windows: LeadFlowAutomationGlobalDefaults['businessHours']['windows'] =
    {};
  for (const [day, window] of Object.entries(value.windows)) {
    if (
      !WEEKDAYS.has(day) ||
      !isRecord(window) ||
      !isTime(window.start) ||
      !isTime(window.end)
    ) {
      throw new BadRequestException('Janela de horário global inválida.');
    }
    windows[day as keyof typeof windows] = {
      start: window.start,
      end: window.end,
    };
  }
  return { enabled: value.enabled, windows };
}

function normalizeCrm(value: unknown): LeadFlowAutomationGlobalDefaults['crm'] {
  if (!isRecord(value))
    throw new BadRequestException('Padrões de CRM inválidos.');
  assertExactKeys(value, ['pipelineRef', 'stageRef'], 'padrões de CRM');
  return {
    pipelineRef: nullableString(value.pipelineRef, 'Pipeline global inválido.'),
    stageRef: nullableString(value.stageRef, 'Etapa global inválida.'),
  };
}

function normalizeChannels(
  value: unknown,
): LeadFlowAutomationGlobalDefaults['channels'] {
  if (!isRecord(value))
    throw new BadRequestException('Padrões de canais inválidos.');
  assertExactKeys(value, ['defaultChannel'], 'padrões de canais');
  if (
    value.defaultChannel !== null &&
    !FOLLOWUP_CHANNELS.has(value.defaultChannel as LeadFlowFollowupChannel)
  ) {
    throw new BadRequestException('Canal global padrão inválido.');
  }
  return {
    defaultChannel: value.defaultChannel as LeadFlowFollowupChannel | null,
  };
}

function normalizeConsent(
  value: unknown,
): LeadFlowAutomationGlobalDefaults['consent'] {
  if (!isRecord(value))
    throw new BadRequestException('Padrões de consentimento inválidos.');
  assertExactKeys(
    value,
    ['requireExplicitConsent'],
    'padrões de consentimento',
  );
  if (typeof value.requireExplicitConsent !== 'boolean') {
    throw new BadRequestException('Padrão de consentimento inválido.');
  }
  return { requireExplicitConsent: value.requireExplicitConsent };
}

function normalizeFollowUp(
  value: unknown,
): LeadFlowAutomationGlobalDefaults['followUp'] {
  if (!isRecord(value))
    throw new BadRequestException('Padrões de follow-up inválidos.');
  assertExactKeys(
    value,
    ['defaultDelayHours', 'maxAttempts'],
    'padrões de follow-up',
  );
  return {
    defaultDelayHours: nullablePositiveNumber(
      value.defaultDelayHours,
      'Atraso padrão de follow-up inválido.',
    ),
    maxAttempts: nullablePositiveInteger(
      value.maxAttempts,
      'Máximo de tentativas de follow-up inválido.',
    ),
  };
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: string[],
  label: string,
): void {
  if (
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in value))
  ) {
    throw new BadRequestException(`Schema fechado inválido para ${label}.`);
  }
}

function nullableString(value: unknown, message: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > 160)
    throw new BadRequestException(message);
  return value;
}

function nullablePositiveNumber(
  value: unknown,
  message: string,
): number | null {
  if (value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 720
  )
    throw new BadRequestException(message);
  return value;
}

function nullablePositiveInteger(
  value: unknown,
  message: string,
): number | null {
  const number = nullablePositiveNumber(value, message);
  if (number !== null && !Number.isInteger(number))
    throw new BadRequestException(message);
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function cloneDefaults(
  value: LeadFlowAutomationGlobalDefaults,
): LeadFlowAutomationGlobalDefaults {
  return JSON.parse(JSON.stringify(value)) as LeadFlowAutomationGlobalDefaults;
}
