import type { TimerFireEnvelope } from './scheduler-runtime.contract';

/** A named destination for a fired timer. */
export interface ScheduledTimerConsumer {
  readonly consumerKey: string;
  handleTimer(envelope: TimerFireEnvelope): Promise<void>;
}
