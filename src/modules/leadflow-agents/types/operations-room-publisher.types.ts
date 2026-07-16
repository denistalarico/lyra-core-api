import type { OperationsRoomEventEnvelope } from './operations-room.types';

/** Port only. Marco 8B intentionally has no transport or no-op delivery. */
export interface OperationsRoomEventPublisher {
  publish(event: OperationsRoomEventEnvelope): Promise<void>;
}
