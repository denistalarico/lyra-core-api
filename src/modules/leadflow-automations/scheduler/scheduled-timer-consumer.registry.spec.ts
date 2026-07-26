import { ScheduledTimerConsumerRegistry } from './scheduled-timer-consumer.registry';

describe('ScheduledTimerConsumerRegistry', () => {
  it('registers and resolves a named consumer', () => {
    const registry = new ScheduledTimerConsumerRegistry();
    const consumer = {
      consumerKey: 'leadflow.test',
      handleTimer: jest.fn(),
    };
    registry.register(consumer);
    expect(registry.resolve('leadflow.test')).toBe(consumer);
  });

  it('rejects two different consumers with the same key', () => {
    const registry = new ScheduledTimerConsumerRegistry();
    registry.register({
      consumerKey: 'leadflow.test',
      handleTimer: jest.fn(),
    });
    expect(() =>
      registry.register({
        consumerKey: 'leadflow.test',
        handleTimer: jest.fn(),
      }),
    ).toThrow('scheduled_timer_consumer_key_duplicate');
  });
});
