import {
  agentScopeIssue,
  contactFields,
  MAX_PAUSE_DAYS,
  normalizeDomainAction,
} from './leadflow-operations-action-domain';
import { projectLeadFlowOperationalRules } from './leadflow-operations-runtime-projection';
import type { LeadFlowOperationsActionEntity } from '../entities';

const NOW = new Date('2026-10-25T12:00:00.000Z');
const AGENT = '00000000-0000-4000-8000-0000000000e1';
const day = (n: number) =>
  new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe('OR5 operations action domain', () => {
  it('pause_agent: future date up to the ceiling, or no date at all', () => {
    const pause = (endsAt?: unknown) =>
      normalizeDomainAction(
        'pause_agent',
        {
          targetAgentId: AGENT,
          targetAgentName: 'Ana',
          timezone: 'America/Sao_Paulo',
          effectivePeriod: endsAt === undefined ? undefined : { endsAt },
        },
        NOW,
      );
    const ok = pause(day(2));
    expect(ok.validationIssues).toEqual([]);
    expect(ok.effectiveUntil?.toISOString()).toBe(day(2));
    expect(ok.targetId).toBe(AGENT);
    expect(ok.summary).toContain('Pausar Ana até');
    expect(pause().summary).toBe('Pausar Ana sem data de retorno.');
    expect(pause(day(-1)).validationIssues).toContain(
      'A data de retorno precisa estar no futuro.',
    );
    expect(pause(day(MAX_PAUSE_DAYS + 1)).validationIssues).toContain(
      `A pausa por período vai até ${MAX_PAUSE_DAYS} dias.`,
    );
    expect(pause('segunda').validationIssues).toContain(
      'Informe uma data de retorno válida.',
    );
    expect(
      normalizeDomainAction('pause_agent', { targetAgentId: 'ana' }, NOW)
        .validationIssues,
    ).toContain('Identifique o agente.');
  });

  it('create_appointment: future start, end after start, known type', () => {
    const ok = normalizeDomainAction(
      'create_appointment',
      { title: 'Reunião', startAt: day(1), endAt: day(1.05), timezone: 'UTC' },
      NOW,
    );
    expect(ok.validationIssues).toEqual([]);
    expect(ok.targetType).toBe('appointment');
    const bad = normalizeDomainAction(
      'create_appointment',
      { title: 'x', startAt: day(-1), endAt: day(-2), type: 'party' },
      NOW,
    );
    expect(bad.validationIssues).toEqual(
      expect.arrayContaining([
        'O compromisso precisa começar no futuro.',
        'O término precisa ser posterior ao início.',
        'Tipo de compromisso inválido.',
      ]),
    );
  });

  it('create_contact and update_contact_fields validate the allowlist', () => {
    expect(
      normalizeDomainAction(
        'create_contact',
        { displayName: 'M', email: 'x' },
        NOW,
      ).validationIssues,
    ).toEqual([
      'Informe o nome do contato (2 a 160 caracteres).',
      'O e-mail informado não é válido.',
    ]);
    expect(
      contactFields({ jobTitle: 'CEO', ownerUserId: AGENT, email: 'a@b.co' }),
    ).toEqual({ jobTitle: 'CEO' });
  });

  it('agent scope: preset actions, own pipeline, self pause', () => {
    const agent = {
      id: AGENT,
      name: 'Ana',
      metadata: { allowedActions: ['schedule_appointment'] },
      crmPolicy: {},
    } as never;
    expect(agentScopeIssue('create_appointment', agent, {})).toBeNull();
    expect(agentScopeIssue('create_contact', agent, {})).toContain('não faz');
    expect(agentScopeIssue('capacity_released', agent, {})).toBeNull();
    expect(
      agentScopeIssue('activate_agent', agent, { targetAgentId: AGENT }),
    ).toBeNull();
  });

  it('confirmed executed intents never become runtime rules', () => {
    const base = {
      status: 'confirmed',
      effectiveFrom: new Date(NOW),
      effectiveUntil: new Date(day(2)),
      confirmedAt: NOW,
      updatedAt: NOW,
      payload: {},
      resourceKey: null,
      timezone: 'UTC',
    };
    const rules = projectLeadFlowOperationalRules(
      [
        { ...base, id: 'a', intent: 'create_appointment' },
        { ...base, id: 'b', intent: 'pause_agent' },
        { ...base, id: 'c', intent: 'add_closure' },
      ] as unknown as LeadFlowOperationsActionEntity[],
      NOW,
    );
    expect(rules.map((rule) => rule.actionId)).toEqual(['c']);
  });
});
