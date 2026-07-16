import { Injectable } from '@nestjs/common';

export type OperationsRoomRealtimeMetricsSnapshot = {
  connections: number;
  connects: number;
  disconnects: number;
  rejectedConnections: number;
  published: number;
  delivered: number;
  retries: number;
  deadLetters: number;
  resyncSignals: number;
  pending: number;
  oldestPendingAgeSeconds: number;
  lastPublishLatencyMs: number | null;
};

@Injectable()
export class OperationsRoomRealtimeMetrics {
  private readonly values: OperationsRoomRealtimeMetricsSnapshot = {
    connections: 0,
    connects: 0,
    disconnects: 0,
    rejectedConnections: 0,
    published: 0,
    delivered: 0,
    retries: 0,
    deadLetters: 0,
    resyncSignals: 0,
    pending: 0,
    oldestPendingAgeSeconds: 0,
    lastPublishLatencyMs: null,
  };

  connected(): void {
    this.values.connections += 1;
    this.values.connects += 1;
  }

  disconnected(): void {
    this.values.connections = Math.max(0, this.values.connections - 1);
    this.values.disconnects += 1;
  }

  rejected(): void {
    this.values.rejectedConnections += 1;
  }

  published(latencyMs: number): void {
    this.values.published += 1;
    this.values.lastPublishLatencyMs = Math.max(0, Math.round(latencyMs));
  }

  delivered(count: number): void {
    this.values.delivered += Math.max(0, count);
  }

  retried(): void {
    this.values.retries += 1;
  }

  deadLettered(): void {
    this.values.deadLetters += 1;
  }

  resyncSignalled(): void {
    this.values.resyncSignals += 1;
  }

  setBacklog(pending: number, oldestPendingAgeSeconds: number): void {
    this.values.pending = Math.max(0, pending);
    this.values.oldestPendingAgeSeconds = Math.max(
      0,
      Math.round(oldestPendingAgeSeconds),
    );
  }

  snapshot(): OperationsRoomRealtimeMetricsSnapshot {
    return { ...this.values };
  }
}
