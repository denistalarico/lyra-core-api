import { inboxRoom } from './inbox-realtime.constants';
import { InboxGateway } from './inbox.gateway';
import type { InboxRealtimeEvent } from './inbox-realtime-event-bus.service';

describe('Inbox realtime isolation', () => {
  it('composes rooms with tenant, workspace, client and company', () => {
    const companyA = {
      scopeKind: 'company' as const,
      agencyClientId: 'client-x',
      companyContextId: 'company-a',
    };
    expect(inboxRoom('tenant-a', 'workspace-a', companyA)).toBe(
      'inbox:tenant-a:workspace-a:company:client-x:company-a',
    );
    expect(inboxRoom('tenant-a', 'workspace-a', companyA)).not.toBe(
      inboxRoom('tenant-a', 'workspace-b', companyA),
    );
    expect(inboxRoom('tenant-a', 'workspace-a', companyA)).not.toBe(
      inboxRoom('tenant-b', 'workspace-a', companyA),
    );
    expect(inboxRoom('tenant-a', 'workspace-a', companyA)).not.toBe(
      inboxRoom('tenant-a', 'workspace-a', {
        ...companyA,
        companyContextId: 'company-b',
      }),
    );
  });

  it('publishes an event only to its composed company room', () => {
    let listener: ((event: InboxRealtimeEvent) => void) | null = null;
    const bus = {
      onEvent: jest.fn((next: (event: InboxRealtimeEvent) => void) => {
        listener = next;
        return jest.fn();
      }),
      onResync: jest.fn(() => jest.fn()),
    };
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const gateway = new InboxGateway(
      {} as never,
      {} as never,
      bus as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    gateway.server = { to, emit: jest.fn() } as never;
    gateway.afterInit();
    const event: InboxRealtimeEvent = {
      eventId: 'event',
      idempotencyKey: 'key',
      eventName: 'updated',
      eventVersion: 1,
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-x',
      companyContextId: 'company-a',
      scopeKind: 'company',
      aggregateId: 'aggregate',
      occurredAt: new Date().toISOString(),
      projection: {},
    };
    expect(listener).not.toBeNull();
    (listener as unknown as (value: InboxRealtimeEvent) => void)(event);
    expect(to).toHaveBeenCalledWith(
      'inbox:tenant-a:workspace-a:company:client-x:company-a',
    );
    expect(emit).toHaveBeenCalledWith('inbox.event', event);
  });
});
