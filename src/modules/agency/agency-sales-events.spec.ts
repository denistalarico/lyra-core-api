import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { agencyEntities } from '../../config/typeorm.config';
import { AgencySalesService } from './agency-sales.service';
import {
  opportunityEventTypes,
  snapshotOf,
  withLossNote,
} from './agency-sales-events.rules';
import {
  AgencySalesOpportunityEntity,
  AgencySalesOpportunityEventEntity,
} from './entities/agency-sales.entities';

const TENANT = '00000000-0000-4000-8000-0000000000a1';
const WORKSPACE = '00000000-0000-4000-8000-0000000000b1';
const USER = '00000000-0000-4000-8000-0000000000c1';
const OPP = '00000000-0000-4000-8000-0000000000d1';
const context = { tenantId: TENANT, workspaceId: WORKSPACE, userId: USER };
const FICTITIOUS_TITLE = 'Lead Fictício da Silva';
const FICTITIOUS_DESCRIPTION = 'fulano.ficticio@example.test';

const stages = [
  {
    id: 'st-new',
    pipelineId: 'p1',
    isClosed: false,
    isWon: false,
    type: 'new',
  },
  {
    id: 'st-qual',
    pipelineId: 'p1',
    isClosed: false,
    isWon: false,
    type: 'qualified',
  },
  { id: 'st-won', pipelineId: 'p1', isClosed: true, isWon: true, type: 'won' },
  {
    id: 'st-lost',
    pipelineId: 'p1',
    isClosed: true,
    isWon: false,
    type: 'lost',
  },
];

function setup(options: { failEvents?: boolean } = {}) {
  let stored: Record<string, unknown> = {
    id: OPP,
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    title: FICTITIOUS_TITLE,
    description: FICTITIOUS_DESCRIPTION,
    pipelineId: 'p1',
    stageId: 'st-new',
    contactId: '00000000-0000-4000-8000-0000000000e1',
    ownerUserId: USER,
    amountCents: 0,
    recurringAmountCents: 0,
    currency: 'BRL',
    status: 'open',
    metadata: {},
  };
  const events: Array<Record<string, unknown>> = [];
  const matches = (
    where: Record<string, unknown>,
    row: Record<string, unknown>,
  ) => Object.entries(where).every(([key, value]) => row[key] === value);
  const txOpportunities = {
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(matches(where, stored) ? { ...stored } : null),
    ),
    update: jest.fn(
      (where: Record<string, unknown>, patch: Record<string, unknown>) => {
        if (matches(where, stored))
          stored = {
            ...stored,
            ...Object.fromEntries(
              Object.entries(patch).filter(([, value]) => value !== undefined),
            ),
          };
        return Promise.resolve({ affected: 1 });
      },
    ),
    create: jest.fn((row: Record<string, unknown>) => ({ ...row })),
    save: jest.fn((row: Record<string, unknown>) => {
      stored = { ...row, id: OPP };
      return Promise.resolve({ ...stored });
    }),
  };
  const txEvents = {
    insert: jest.fn((rows: Array<Record<string, unknown>>) =>
      options.failEvents
        ? Promise.reject(new Error('insert failed'))
        : (events.push(...rows), Promise.resolve({})),
    ),
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === AgencySalesOpportunityEntity
        ? txOpportunities
        : entity === AgencySalesOpportunityEventEntity
          ? txEvents
          : (() => {
              throw new Error('unexpected repository');
            })(),
  };
  const dataSource = {
    transaction: jest.fn((work: (m: unknown) => Promise<unknown>) =>
      work(manager),
    ),
  };
  const rootOpportunities = {
    findOne: jest.fn(() => Promise.resolve({ ...stored })),
    update: jest.fn(),
    save: jest.fn(),
  };
  const stagesRepo = {
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        stages.find((stage) =>
          Object.entries(where)
            .filter(([key]) => !['tenantId', 'workspaceId'].includes(key))
            .every(
              ([key, value]) =>
                (stage as Record<string, unknown>)[key] === value,
            ),
        ) ?? null,
      ),
    ),
  };
  const pipelinesRepo = {
    findOne: jest.fn(() => Promise.resolve({ id: 'p1' })),
  };
  const opportunityItemsRepo = {
    find: jest.fn(() =>
      Promise.resolve([{ subtotalCents: 150000, recurringSubtotalCents: 0 }]),
    ),
    save: jest.fn((row: Record<string, unknown>) => Promise.resolve(row)),
    create: jest.fn((row: Record<string, unknown>) => row),
  };
  const activitiesRepo = { find: jest.fn(() => Promise.resolve([])) };
  const itemsRepo = { findOne: jest.fn() };
  const service = new AgencySalesService(
    activitiesRepo as never,
    itemsRepo as never,
    pipelinesRepo as never,
    stagesRepo as never,
    rootOpportunities as never,
    opportunityItemsRepo as never,
    {} as never,
    dataSource as never,
  );
  const types = () => events.map((event) => event.eventType);
  return {
    service,
    events,
    types,
    rootOpportunities,
    txOpportunities,
    dataSource,
  };
}

describe('AgencySalesService events (AG-EVT)', () => {
  it('records the creation with the snapshot only', async () => {
    const { service, events } = setup();
    await service.createOpportunity(context, {
      title: FICTITIOUS_TITLE,
      description: FICTITIOUS_DESCRIPTION,
      pipelineId: 'p1',
      stageId: 'st-new',
      amountCents: 90000,
    } as never);
    expect(events).toEqual([
      expect.objectContaining({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        opportunityId: OPP,
        eventType: 'opportunity_created',
        beforeData: null,
        actorType: 'user',
        actorUserId: USER,
        idempotencyKey: `${OPP}:created`,
      }),
    ]);
    expect(Object.keys(events[0].afterData as object).sort()).toEqual([
      'amountCents',
      'currency',
      'hasContact',
      'ownerUserId',
      'pipelineId',
      'recurringAmountCents',
      'stageId',
      'status',
    ]);
  });

  it('marks a lead created by Forms (no user) as system', async () => {
    const { service, events } = setup();
    await service.createQuickOpportunity(
      { tenantId: TENANT, workspaceId: WORKSPACE },
      { title: FICTITIOUS_TITLE, pipelineId: 'p1', stageId: 'st-new' } as never,
    );
    expect(events[0]).toMatchObject({ actorType: 'system', actorUserId: null });
  });

  it('moves between open stages with one stage_changed, and not at all within the stage', async () => {
    const moved = setup();
    await moved.service.moveOpportunity(context, OPP, {
      stageId: 'st-qual',
    } as never);
    expect(moved.types()).toEqual(['stage_changed']);
    expect(moved.events[0].beforeData).toMatchObject({ stageId: 'st-new' });
    expect(moved.events[0].afterData).toMatchObject({ stageId: 'st-qual' });

    const same = setup();
    await same.service.moveOpportunity(context, OPP, {
      stageId: 'st-new',
    } as never);
    expect(same.types()).toEqual([]);
  });

  it('wins, loses and reopens with the status events', async () => {
    const won = setup();
    await won.service.moveOpportunity(context, OPP, {
      stageId: 'st-won',
    } as never);
    expect(won.types()).toEqual([
      'stage_changed',
      'status_changed',
      'opportunity_won',
    ]);

    const lost = setup();
    await lost.service.loseOpportunity(context, OPP, {
      lostReason: 'Preço',
    } as never);
    expect(lost.types()).toEqual([
      'stage_changed',
      'status_changed',
      'opportunity_lost',
    ]);

    const reopened = setup();
    await reopened.service.winOpportunity(context, OPP, {} as never);
    reopened.events.length = 0;
    await reopened.service.reopenOpportunity(context, OPP, {
      stageId: 'st-qual',
    } as never);
    expect(reopened.types()).toEqual([
      'stage_changed',
      'status_changed',
      'opportunity_reopened',
    ]);
  });

  it('carries the loss reason and note on opportunity_lost only, and drops the note on reopen', async () => {
    const lost = setup();
    await lost.service.loseOpportunity(context, OPP, {
      lostReason: 'Preço',
      lostNote: '  Fechou com outra agência pela metade do preço.  ',
    } as never);
    const lostEvent = lost.events.find(
      (event) => event.eventType === 'opportunity_lost',
    );
    expect(lostEvent?.afterData).toMatchObject({
      status: 'lost',
      lostReason: 'Preço',
      lostNote: 'Fechou com outra agência pela metade do preço.',
    });
    for (const event of lost.events.filter((e) => e !== lostEvent))
      expect(event.afterData).not.toHaveProperty('lostNote');

    lost.events.length = 0;
    await lost.service.reopenOpportunity(context, OPP, {
      stageId: 'st-qual',
    } as never);
    const reopenedNote = (
      lost.events.find((event) => event.eventType === 'opportunity_reopened')
        ?.afterData as Record<string, unknown>
    )?.lostNote;
    expect(reopenedNote).toBeUndefined();
  });

  it('archives, and records value or owner changes but not title edits', async () => {
    const archived = setup();
    await archived.service.updateOpportunity(context, OPP, {
      status: 'archived',
    } as never);
    expect(archived.types()).toEqual([
      'status_changed',
      'opportunity_archived',
    ]);

    const value = setup();
    await value.service.updateOpportunity(context, OPP, {
      amountCents: 120000,
      ownerUserId: null,
    } as never);
    expect(value.types()).toEqual(['opportunity_updated']);

    const title = setup();
    await title.service.updateOpportunity(context, OPP, {
      title: 'Outro título fictício',
      description: 'outro texto',
    } as never);
    expect(title.types()).toEqual([]);
  });

  it('records the contact link and the recurring value, the contact as a flag only', () => {
    const base = {
      pipelineId: 'p1',
      stageId: 'st-new',
      status: 'open',
      amountCents: 0,
      recurringAmountCents: 0,
      currency: 'BRL',
      ownerUserId: USER,
      contactId: null,
    };
    const before = snapshotOf(base as never);
    const linked = snapshotOf({
      ...base,
      contactId: '00000000-0000-4000-8000-0000000000e2',
    } as never);
    expect(opportunityEventTypes(before, linked)).toEqual([
      'opportunity_updated',
    ]);
    expect(linked).toMatchObject({ hasContact: true });
    expect(JSON.stringify(linked)).not.toContain('0000000000e2');
    const recurring = snapshotOf({
      ...base,
      recurringAmountCents: 5000,
    } as never);
    expect(opportunityEventTypes(before, recurring)).toEqual([
      'opportunity_updated',
    ]);
    // Rows written before the flag existed are not a change.
    const legacy = { ...before } as Record<string, unknown>;
    delete legacy.hasContact;
    delete legacy.recurringAmountCents;
    expect(opportunityEventTypes(legacy as never, before)).toEqual([]);
  });

  it('records the new value when items change the totals', async () => {
    const { service, types, events } = setup();
    await service.createOpportunityItem(context, OPP, {
      name: 'Serviço fictício',
      unitPriceCents: 150000,
    } as never);
    expect(types()).toEqual(['opportunity_updated']);
    expect(events[0].afterData).toMatchObject({ amountCents: 150000 });
  });

  it('writes the change through the transaction and fails with the event', async () => {
    const { service, rootOpportunities, txOpportunities, dataSource } = setup({
      failEvents: true,
    });
    await expect(
      service.moveOpportunity(context, OPP, { stageId: 'st-qual' } as never),
    ).rejects.toThrow('insert failed');
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(txOpportunities.update).toHaveBeenCalledTimes(1);
    expect(rootOpportunities.update).not.toHaveBeenCalled();
    expect(txOpportunities.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });

  it('never carries lead PII', async () => {
    const { service, events } = setup();
    await service.createOpportunity(context, {
      title: FICTITIOUS_TITLE,
      description: FICTITIOUS_DESCRIPTION,
      pipelineId: 'p1',
      stageId: 'st-new',
      contactId: '00000000-0000-4000-8000-0000000000e1',
    } as never);
    await service.moveOpportunity(context, OPP, { stageId: 'st-won' } as never);
    const json = JSON.stringify(events);
    expect(json).not.toContain(FICTITIOUS_TITLE);
    expect(json).not.toContain(FICTITIOUS_DESCRIPTION);
    expect(json).not.toContain('0000000000e1');
  });
});

describe('withLossNote', () => {
  it('stores a trimmed note on loss, clears it on an empty note or any other status', () => {
    expect(withLossNote({ a: 1 }, 'lost', ' detalhe ')).toEqual({
      a: 1,
      lossNote: 'detalhe',
    });
    expect(withLossNote({ a: 1, lossNote: 'x' }, 'lost', '')).toEqual({ a: 1 });
    expect(withLossNote({ a: 1, lossNote: 'x' }, 'lost')).toEqual({
      a: 1,
      lossNote: 'x',
    });
    expect(withLossNote({ a: 1, lossNote: 'x' }, 'open')).toEqual({ a: 1 });
  });
});

describe('AG-EVT boundaries', () => {
  const modules = join(__dirname, '..');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory()
        ? walk(path)
        : path.endsWith('.ts')
          ? [path]
          : [];
    });

  it('registers the event entity in agencyEntities', () => {
    expect(agencyEntities).toContain(AgencySalesOpportunityEventEntity);
  });

  it('keeps the Agency CRM and the LeadFlow CRM apart', () => {
    const agencySales = walk(__dirname).filter(
      (path) =>
        /[\\/]agency-sales[^\\/]*\.ts$/.test(path) &&
        !path.endsWith('.spec.ts'),
    );
    expect(agencySales.length).toBeGreaterThanOrEqual(5);
    for (const path of agencySales) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/from '(\.\.\/)+(crm|leadflow[\w-]*)\//);
      expect(source).not.toMatch(/crm_opportunity_events|leadflow\.crm\./);
    }

    const leadflow = readdirSync(modules)
      .filter((name) => name === 'crm' || name.startsWith('leadflow'))
      .flatMap((name) => walk(join(modules, name)));
    for (const path of leadflow)
      expect(readFileSync(path, 'utf8')).not.toMatch(
        /from '(\.\.\/)+agency\/(agency-sales|entities\/agency-sales)/,
      );
  });
});
