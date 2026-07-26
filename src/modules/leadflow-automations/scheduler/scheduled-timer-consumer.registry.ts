import { Injectable } from '@nestjs/common';
import type { ScheduledTimerConsumer } from './scheduled-timer-consumer.contract';

/**
 * Runtime routing table for timer consumers.
 *
 * Consumers register during module initialization. Keeping routing behind this
 * tiny registry avoids coupling the PostgreSQL engine to any automation recipe
 * and avoids a DI cycle when a consumer itself schedules the next timer.
 */
@Injectable()
export class ScheduledTimerConsumerRegistry {
  private readonly consumers = new Map<string, ScheduledTimerConsumer>();

  register(consumer: ScheduledTimerConsumer): void {
    const key = consumer.consumerKey.trim();
    if (!key) throw new Error('scheduled_timer_consumer_key_required');
    const existing = this.consumers.get(key);
    if (existing && existing !== consumer) {
      throw new Error('scheduled_timer_consumer_key_duplicate');
    }
    this.consumers.set(key, consumer);
  }

  resolve(consumerKey: string): ScheduledTimerConsumer | null {
    return this.consumers.get(consumerKey) ?? null;
  }
}
