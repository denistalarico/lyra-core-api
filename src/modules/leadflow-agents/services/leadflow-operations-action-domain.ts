import type {
  LeadFlowAgentEntity,
  LeadFlowOperationsActionIntent,
  LeadFlowOperationsActionTargetType,
} from '../entities';

/** The intents the runtime reads as operational rules (AO-04). */
export const RULE_INTENTS = new Set<LeadFlowOperationsActionIntent>([
  'capacity_unavailable',
  'capacity_released',
  'add_closure',
]);

/** OR5 — intents the confirmation executes through a domain service. */
export const DOMAIN_INTENTS = new Set<LeadFlowOperationsActionIntent>([
  'pause_agent',
  'activate_agent',
  'create_contact',
  'move_opportunity',
  'update_contact_fields',
  'create_appointment',
]);

export const isDomainIntent = (intent: LeadFlowOperationsActionIntent) =>
  DOMAIN_INTENTS.has(intent);

/** "Campos simples" (§3.3): identity labels only, never methods or owners. */
export const CONTACT_FIELD_ALLOWLIST = [
  'displayName',
  'firstName',
  'lastName',
  'jobTitle',
] as const;

export const APPOINTMENT_TYPES = [
  'meeting',
  'call',
  'event',
  'follow_up',
  'task',
  'reminder',
] as const;

export const MAX_PAUSE_DAYS = 90;
const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FIELD_LABELS: Record<(typeof CONTACT_FIELD_ALLOWLIST)[number], string> = {
  displayName: 'nome de exibição',
  firstName: 'nome',
  lastName: 'sobrenome',
  jobTitle: 'cargo',
};

export type DomainNormalized = {
  targetType: LeadFlowOperationsActionTargetType;
  targetId: string | null;
  timezone: string | null;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  validationIssues: string[];
  title: string;
  summary: string;
};

/**
 * OR5 — validates the payload of an executable intent. The payload carries
 * resolved record IDs (the Orion resolves names server-side, under the
 * caller's scope); the labels are for the card only. The confirmation
 * re-checks permission and scope; nothing here grants anything.
 */
export function normalizeDomainAction(
  intent: LeadFlowOperationsActionIntent,
  payload: Record<string, unknown>,
  now = new Date(),
): DomainNormalized {
  const issues: string[] = [];
  const rawTimezone = readString(payload.timezone);
  const timezone =
    rawTimezone && isValidTimezone(rawTimezone) ? rawTimezone : null;
  if (rawTimezone && !timezone)
    issues.push('Informe um fuso horário IANA válido.');
  const zone = timezone ?? 'UTC';
  const done = (
    targetType: LeadFlowOperationsActionTargetType,
    targetId: string | null,
    summary: string,
    period: { from?: Date | null; until?: Date | null } = {},
  ): DomainNormalized => ({
    targetType,
    targetId,
    timezone,
    effectiveFrom: period.from ?? null,
    effectiveUntil: period.until ?? null,
    validationIssues: [...new Set(issues)],
    title: DOMAIN_TITLES[intent],
    summary,
  });

  switch (intent) {
    case 'pause_agent':
    case 'activate_agent': {
      const agentId = readUuid(payload.targetAgentId);
      if (!agentId) issues.push('Identifique o agente.');
      const name = readString(payload.targetAgentName) ?? 'o agente';
      if (intent === 'activate_agent')
        return done('agent', agentId, `Ativar ${name} agora.`);
      const period = readRecord(payload.effectivePeriod);
      const rawUntil = period?.endsAt;
      const until = readDate(rawUntil);
      if (rawUntil !== undefined && rawUntil !== null && !until)
        issues.push('Informe uma data de retorno válida.');
      if (until && until.getTime() <= now.getTime())
        issues.push('A data de retorno precisa estar no futuro.');
      if (until && until.getTime() > now.getTime() + MAX_PAUSE_DAYS * DAY_MS)
        issues.push(`A pausa por período vai até ${MAX_PAUSE_DAYS} dias.`);
      return done(
        'agent',
        agentId,
        until
          ? `Pausar ${name} até ${formatDateTime(until, zone)}; volta a atender sozinho depois.`
          : `Pausar ${name} sem data de retorno.`,
        { until },
      );
    }
    case 'create_contact': {
      const name = readString(payload.displayName);
      if (!name || name.length < 2 || name.length > 160)
        issues.push('Informe o nome do contato (2 a 160 caracteres).');
      const email = readString(payload.email);
      if (
        email &&
        (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      )
        issues.push('O e-mail informado não é válido.');
      const phone = readString(payload.phone);
      if (phone && !/^[+\d][\d\s().-]{5,39}$/.test(phone))
        issues.push('O telefone informado não é válido.');
      const extras = [email && 'e-mail', phone && 'telefone'].filter(Boolean);
      return done(
        'contact',
        null,
        `Criar o contato ${name ?? '(sem nome)'}${extras.length ? ` com ${extras.join(' e ')}` : ''}.`,
      );
    }
    case 'move_opportunity': {
      const opportunityId = readUuid(payload.opportunityId);
      if (!opportunityId) issues.push('Identifique a oportunidade.');
      if (!readUuid(payload.stageId))
        issues.push('Identifique a etapa de destino.');
      const title = readString(payload.opportunityTitle) ?? 'a oportunidade';
      const stage = readString(payload.stageName) ?? 'a etapa escolhida';
      return done(
        'opportunity',
        opportunityId,
        `Mover "${title}" para ${stage}.`,
      );
    }
    case 'update_contact_fields': {
      const contactId = readUuid(payload.contactId);
      if (!contactId) issues.push('Identifique o contato.');
      const fields = contactFields(payload.fields);
      const keys = Object.keys(fields) as Array<keyof typeof FIELD_LABELS>;
      if (!keys.length)
        issues.push(
          'Informe ao menos um campo: nome, sobrenome, nome de exibição ou cargo.',
        );
      const rawKeys = Object.keys(readRecord(payload.fields) ?? {});
      if (
        rawKeys.some(
          (key) =>
            !(CONTACT_FIELD_ALLOWLIST as readonly string[]).includes(key),
        )
      )
        issues.push(
          'Pelo chat só é possível alterar nome, sobrenome, nome de exibição e cargo.',
        );
      const name = readString(payload.contactName) ?? 'o contato';
      return done(
        'contact',
        contactId,
        `Atualizar ${name}: ${keys.map((key) => FIELD_LABELS[key]).join(', ') || 'nenhum campo'}.`,
      );
    }
    case 'create_appointment': {
      const title = readString(payload.title);
      if (!title || title.length > 180)
        issues.push('Informe o título do compromisso (até 180 caracteres).');
      const startAt = readDate(payload.startAt);
      const endAt = readDate(payload.endAt);
      if (!startAt) issues.push('Informe quando o compromisso começa.');
      if (startAt && startAt.getTime() < now.getTime() - 5 * 60_000)
        issues.push('O compromisso precisa começar no futuro.');
      if (payload.endAt !== undefined && payload.endAt !== null && !endAt)
        issues.push('Informe um término válido.');
      if (startAt && endAt && endAt.getTime() <= startAt.getTime())
        issues.push('O término precisa ser posterior ao início.');
      const type = readString(payload.type) ?? 'meeting';
      if (!(APPOINTMENT_TYPES as readonly string[]).includes(type))
        issues.push('Tipo de compromisso inválido.');
      if (
        payload.contactId !== undefined &&
        payload.contactId !== null &&
        !readUuid(payload.contactId)
      )
        issues.push('Identifique o contato do compromisso.');
      const contact = readString(payload.contactName);
      return done(
        'appointment',
        null,
        `Agendar "${title ?? '(sem título)'}"${startAt ? ` em ${formatDateTime(startAt, zone)}` : ''}${contact ? ` com ${contact}` : ''}.`,
        { from: startAt, until: endAt },
      );
    }
    default:
      throw new Error(`Not a domain intent: ${intent}`);
  }
}

const DOMAIN_TITLES: Record<LeadFlowOperationsActionIntent, string> = {
  update_offer_price: 'Alterar preço',
  schedule_discount: 'Programar desconto',
  add_closure: 'Registrar fechamento',
  update_business_hours: 'Alterar horário',
  capacity_unavailable: 'Registrar indisponibilidade',
  capacity_released: 'Liberar capacidade',
  pause_agent: 'Pausar agente',
  activate_agent: 'Ativar agente',
  create_contact: 'Criar contato',
  move_opportunity: 'Mover oportunidade',
  update_contact_fields: 'Atualizar contato',
  create_appointment: 'Criar compromisso',
};

export const actionTitle = (intent: LeadFlowOperationsActionIntent) =>
  DOMAIN_TITLES[intent];

/** The agent action (preset `allowedActions`) each CRM/agenda intent needs. */
const AGENT_ACTIONS: Partial<
  Record<LeadFlowOperationsActionIntent, readonly string[]>
> = {
  create_contact: ['capture_lead'],
  update_contact_fields: ['collect_qualification', 'capture_lead'],
  move_opportunity: ['update_crm_stage'],
  create_appointment: ['schedule_appointment'],
};

/**
 * OR5 item 4 — a proposal made to an agent stays inside that agent's scope:
 * it only pauses/activates itself, only touches the CRM/agenda through the
 * actions its preset grants, and only in its pipeline when it has one. The
 * Orion (no agent) is limited by the user's permission only. Returns the
 * refusal, or `null` when allowed.
 */
export function agentScopeIssue(
  intent: LeadFlowOperationsActionIntent,
  agent: Pick<LeadFlowAgentEntity, 'id' | 'name' | 'metadata' | 'crmPolicy'>,
  payload: Record<string, unknown>,
): string | null {
  if (intent === 'pause_agent' || intent === 'activate_agent') {
    return readUuid(payload.targetAgentId) === agent.id
      ? null
      : `${agent.name} só pode pausar ou ativar a si mesmo. Peça ao Orion para alterar outro agente.`;
  }
  const required = AGENT_ACTIONS[intent];
  if (!required) return null;
  const allowed = Array.isArray(agent.metadata?.allowedActions)
    ? (agent.metadata.allowedActions as unknown[])
    : [];
  if (!required.some((action) => allowed.includes(action)))
    return `${agent.name} não faz "${DOMAIN_TITLES[intent].toLowerCase()}". Peça ao Orion ou a outro agente.`;
  if (intent === 'move_opportunity') {
    const scoped = readString(
      readRecord(agent.crmPolicy?.pipelineRef)?.pipelineId,
    );
    const target = readString(payload.pipelineId);
    if (scoped && target !== scoped)
      return `${agent.name} só move oportunidades do funil dele.`;
  }
  return null;
}

/** The allowlisted contact fields of a payload; anything else is dropped. */
export function contactFields(value: unknown) {
  const record = readRecord(value) ?? {};
  const fields: Partial<
    Record<(typeof CONTACT_FIELD_ALLOWLIST)[number], string>
  > = {};
  for (const key of CONTACT_FIELD_ALLOWLIST) {
    const text = readString(record[key]);
    if (text && text.length <= 160) fields[key] = text;
  }
  return fields;
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function readUuid(value: unknown): string | null {
  const text = readString(value);
  return text && UUID.test(text) ? text.toLowerCase() : null;
}

export function readDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function formatDateTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}
