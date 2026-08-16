import { createHmac } from 'node:crypto';
import {
  buildEnvelope,
  classifyAttempt,
  nextAttemptDelaySeconds,
  selectFields,
  signPayload,
} from './leadflow-webhook-payload';

describe('webhook payload', () => {
  const base = {
    deliveryId: '11111111-1111-4111-8111-111111111111',
    eventName: 'leadflow.crm.opportunity.won',
    eventVersion: 1,
    occurredAt: new Date('2026-09-01T12:00:00.000Z'),
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    aggregateType: 'crm_opportunity',
    aggregateId: 'opportunity-1',
    payload: { value: 1200, currency: 'BRL', stageId: 'stage-9' },
  };

  it('sends only the fields the operator ticked', () => {
    const envelope = buildEnvelope({ ...base, fields: ['value', 'currency'] });
    expect(envelope.data).toEqual({ value: 1200, currency: 'BRL' });
  });

  it('reads an empty selection as the whole payload', () => {
    // An endpoint subscribed to an event and receiving `{}` looks broken, and a
    // wildcard subscription keeps working as the contract grows.
    expect(selectFields(base.payload, [])).toEqual(base.payload);
    expect(selectFields(base.payload, ['*'])).toEqual(base.payload);
  });

  it('ignores a selected field the event does not carry', () => {
    expect(selectFields(base.payload, ['value', 'ghost'])).toEqual({
      value: 1200,
    });
  });

  it('describes the resource next to the data', () => {
    const envelope = buildEnvelope({ ...base, fields: [] });
    expect(envelope).toMatchObject({
      id: base.deliveryId,
      event: 'leadflow.crm.opportunity.won',
      version: 1,
      occurredAt: '2026-09-01T12:00:00.000Z',
      resource: { type: 'crm_opportunity', id: 'opportunity-1' },
    });
  });

  it('signs the timestamp together with the body', () => {
    const body = '{"a":1}';
    const header = signPayload(body, 'shhh', 1_760_000_000);
    const expected = createHmac('sha256', 'shhh')
      .update(`1760000000.${body}`)
      .digest('hex');

    expect(header).toBe(`t=1760000000,v1=${expected}`);
    // Without the timestamp in the signed string, a captured request would be
    // replayable forever.
    expect(header).not.toContain(
      createHmac('sha256', 'shhh').update(body).digest('hex'),
    );
  });

  describe('what a response means for the next attempt', () => {
    it('treats every 2xx as delivered', () => {
      expect(classifyAttempt(200, 1, 3)).toBe('delivered');
      expect(classifyAttempt(204, 1, 3)).toBe('delivered');
    });

    it('retries the endpoint bad day, not the disagreement', () => {
      expect(classifyAttempt(500, 1, 3)).toBe('retry');
      expect(classifyAttempt(null, 1, 3)).toBe('retry');
      // 401 and 404 would answer the same way in a minute.
      expect(classifyAttempt(401, 1, 3)).toBe('dead_letter');
      expect(classifyAttempt(404, 1, 3)).toBe('dead_letter');
    });

    it('honours the two 4xx that are asking for later', () => {
      expect(classifyAttempt(429, 1, 3)).toBe('retry');
      expect(classifyAttempt(408, 1, 3)).toBe('retry');
    });

    it('stops once the configured retries are spent', () => {
      expect(classifyAttempt(500, 4, 3)).toBe('dead_letter');
    });
  });

  it('backs off exponentially, capped at an hour', () => {
    expect(nextAttemptDelaySeconds(1, 30)).toBe(30);
    expect(nextAttemptDelaySeconds(3, 30)).toBe(120);
    // Without the cap, the sixth retry of a 300s endpoint lands nine hours out.
    expect(nextAttemptDelaySeconds(8, 300)).toBe(3600);
  });
});
