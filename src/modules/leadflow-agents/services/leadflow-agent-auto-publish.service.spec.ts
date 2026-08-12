import { BadRequestException } from '@nestjs/common';
import { LeadFlowAgentService } from './leadflow-agent.service';
import { LeadFlowAgentRuntimeConfigService } from './leadflow-agent-runtime-config.service';
import { LeadFlowAgentStatus } from '../enums/leadflow-agent-status.enum';
import { LeadFlowAgentType } from '../enums/leadflow-agent-type.enum';

/**
 * Publicação sem botão.
 *
 * O usuário não deve precisar lembrar de publicar: se o agente está ativo, o
 * que ele salva é o que está no ar. Estes testes cobrem as três metades disso
 * — publicar ao ativar, publicar ao alterar um agente ativo e *não* publicar
 * de novo quando nada mudou — além da troca de tipo, que reajusta o papel.
 */
function buildAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    settingsId: 'settings-1',
    contextType: 'agency',
    agencyClientId: null,
    businessModeKey: 'agency_services',
    presetKey: null,
    type: LeadFlowAgentType.Reception,
    name: 'Recepção',
    description: null,
    status: LeadFlowAgentStatus.Active,
    isSystem: false,
    isCustom: true,
    isProtected: false,
    behaviorConfig: {} as Record<string, unknown>,
    promptConfig: {} as Record<string, unknown>,
    handoffPolicy: {} as { targetUserIds?: string[] },
    crmPolicy: {} as Record<string, unknown>,
    channelPolicy: {} as {
      channelActivationPolicies?: Record<
        string,
        { keywords?: string[]; automaticEffects?: unknown }
      >;
    },
    avatarConfig: {} as Record<string, unknown>,
    readiness: {} as { missing?: string[] },
    publishedVersionId: null as string | null,
    metadata: {} as Record<string, unknown>,
    createdById: 'user-1',
    updatedById: 'user-1',
    archivedAt: null as Date | null,
    deletedAt: null as Date | null,
    deletedById: null as string | null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildService(agent: ReturnType<typeof buildAgent>) {
  const versions: { id: string; agentId: string; snapshot: unknown }[] = [];

  const agentsRepository = {
    findOne: jest.fn().mockImplementation(async () => agent),
    save: jest
      .fn()
      .mockImplementation(async (value) => Object.assign(agent, value)),
  };
  const versionsRepository = {
    create: jest.fn().mockImplementation((value) => ({
      ...value,
      id: `version-${versions.length + 1}`,
    })),
    save: jest.fn().mockImplementation(async (value) => {
      versions.push(value);
      return value;
    }),
    findOne: jest.fn().mockImplementation(async ({ where }) => {
      const found = versions.find((version) => version.id === where.id);
      // O Postgres devolve jsonb sem preservar a ordem das chaves: embaralhar
      // aqui garante que a comparação não dependa dela.
      return found
        ? { ...found, snapshot: shuffleKeys(found.snapshot) }
        : null;
    }),
  };
  const bindingsRepository = { find: jest.fn().mockResolvedValue([]) };
  const settingsRepository = {
    findOne: jest.fn().mockResolvedValue({
      id: agent.settingsId,
      tenantId: agent.tenantId,
      workspaceId: agent.workspaceId,
      contextType: agent.contextType,
      agencyClientId: agent.agencyClientId,
      businessModeKey: agent.businessModeKey,
      clientPromptConfig: { about: 'contexto' },
    }),
  };

  const service = new LeadFlowAgentService(
    agentsRepository as never,
    versionsRepository as never,
    bindingsRepository as never,
    settingsRepository as never,
    { count: jest.fn().mockResolvedValue(0) } as never,
    { find: jest.fn().mockResolvedValue([]) } as never,
    { find: jest.fn().mockResolvedValue([]) } as never,
    { isCustomBusinessMode: jest.fn().mockReturnValue(false) } as never,
    new LeadFlowAgentRuntimeConfigService() as never,
    { can: jest.fn().mockResolvedValue(true) } as never,
    { reconcile: jest.fn().mockResolvedValue([]) } as never,
    { recordTransition: jest.fn().mockResolvedValue(undefined) } as never,
  );

  return { service, agent, versions, versionsRepository };
}

/** Reordena as chaves de um objeto, como o jsonb faz na volta do banco. */
function shuffleKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shuffleKeys);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    return Object.fromEntries(
      entries.map(([key, item]) => [key, shuffleKeys(item)]),
    );
  }
  return value;
}

const ctx = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  role: 'admin',
} as never;

describe('LeadFlowAgentService automatic publishing', () => {
  it('publishes when an agent is activated, without a separate publish step', async () => {
    const { service, agent, versions } = buildService(
      buildAgent({ status: LeadFlowAgentStatus.Draft }),
    );

    await service.activate(ctx, agent.id);

    expect(versions).toHaveLength(1);
    expect(agent.publishedVersionId).toBe('version-1');
    // A versão publicada é dependência de readiness: ela tem de sair da lista
    // de pendências no mesmo movimento.
    expect(agent.readiness.missing).not.toContain('published_version');
  });

  it('publishes every configuration change of a live agent', async () => {
    const { service, agent, versions } = buildService(buildAgent());

    await service.patch(ctx, agent.id, { name: 'Recepção Norte' });

    expect(versions).toHaveLength(1);
    expect(agent.publishedVersionId).toBe('version-1');
  });

  it('does not publish an agent that is not live', async () => {
    const { service, agent, versions } = buildService(
      buildAgent({ status: LeadFlowAgentStatus.Paused }),
    );

    await service.patch(ctx, agent.id, { name: 'Recepção pausada' });

    expect(versions).toHaveLength(0);
    expect(agent.publishedVersionId).toBeNull();
  });

  it('skips a redundant version when the configuration did not change', async () => {
    const { service, agent, versions } = buildService(buildAgent());

    await service.patch(ctx, agent.id, { name: 'Recepção Norte' });
    await service.patch(ctx, agent.id, { name: 'Recepção Norte' });

    expect(versions).toHaveLength(1);
  });

  it('still publishes on an explicit request, even with nothing to change', async () => {
    const { service, agent, versions } = buildService(buildAgent());

    await service.patch(ctx, agent.id, { name: 'Recepção Norte' });
    await service.publish(ctx, agent.id);

    expect(versions).toHaveLength(2);
  });
});

describe('LeadFlowAgentService agent type change', () => {
  it('adopts the new role actions and unlinks the origin preset', async () => {
    const { service, agent } = buildService(
      buildAgent({
        presetKey: 'agency_services_reception',
        isSystem: true,
        isCustom: false,
        metadata: {
          allowedActions: ['send_message', 'capture_lead', 'request_handoff'],
          source: 'preset',
          presetKey: 'agency_services_reception',
        },
      }),
    );

    await service.patch(ctx, agent.id, { type: LeadFlowAgentType.Sales });

    expect(agent.type).toBe(LeadFlowAgentType.Sales);
    expect(agent.metadata.allowedActions).toContain('update_crm_stage');
    expect(agent.presetKey).toBeNull();
    expect(agent.isSystem).toBe(false);
    expect(agent.isCustom).toBe(true);
    expect(agent.metadata.derivedFromPresetKey).toBe(
      'agency_services_reception',
    );
  });

  it('keeps the name and the avatar the operator chose', async () => {
    const { service, agent } = buildService(
      buildAgent({ name: 'Marina', avatarConfig: { preset: 'avatar-03' } }),
    );

    await service.patch(ctx, agent.id, { type: LeadFlowAgentType.Qualifier });

    expect(agent.name).toBe('Marina');
    expect(agent.avatarConfig).toEqual({ preset: 'avatar-03' });
  });

  it('refuses to change the type of a platform-protected agent', async () => {
    const { service, agent } = buildService(buildAgent({ isProtected: true }));

    await expect(
      service.patch(ctx, agent.id, { type: LeadFlowAgentType.Sales }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(agent.type).toBe(LeadFlowAgentType.Reception);
  });
});

describe('LeadFlowAgentService activation policies', () => {
  it('validates each per-channel rule like the default one', async () => {
    const { service, agent } = buildService(buildAgent());
    const channelId = '22222222-2222-4222-8222-222222222222';

    await service.patch(ctx, agent.id, {
      channelPolicy: {
        activationPolicy: { version: 1, trigger: 'manual' },
        channelActivationPolicies: {
          [channelId]: {
            version: 1,
            trigger: 'keywords',
            keywords: [' orçamento '],
            keywordMode: 'word',
          },
        },
      },
    });

    const stored = agent.channelPolicy.channelActivationPolicies?.[channelId];
    expect(stored?.keywords).toEqual(['orçamento']);
    expect(stored?.automaticEffects).toEqual({
      reply: false,
      crm: false,
      followUp: false,
    });
  });

  it('rejects a per-channel rule carrying a regular expression', async () => {
    const { service, agent } = buildService(buildAgent());

    await expect(
      service.patch(ctx, agent.id, {
        channelPolicy: {
          channelActivationPolicies: {
            '22222222-2222-4222-8222-222222222222': {
              version: 1,
              trigger: 'keywords',
              keywords: ['or(ca|ça)mento.*'],
            },
          },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a rule keyed by something that is not a channel id', async () => {
    const { service, agent } = buildService(buildAgent());

    await expect(
      service.patch(ctx, agent.id, {
        channelPolicy: {
          channelActivationPolicies: {
            whatsapp: { version: 1, trigger: 'every_eligible' },
          },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('LeadFlowAgentService handoff owners', () => {
  it('keeps the configured owners on the handoff policy', async () => {
    const { service, agent } = buildService(buildAgent());
    const userId = '33333333-3333-4333-8333-333333333333';

    await service.patch(ctx, agent.id, {
      handoffPolicy: { target: 'sales_team', targetUserIds: [userId, userId] },
    });

    // Repetido no payload, guardado uma vez só.
    expect(agent.handoffPolicy.targetUserIds).toEqual([userId]);
  });

  it('rejects an owner that is not a user id', async () => {
    const { service, agent } = buildService(buildAgent());

    await expect(
      service.patch(ctx, agent.id, {
        handoffPolicy: { targetUserIds: ['equipe-comercial'] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
