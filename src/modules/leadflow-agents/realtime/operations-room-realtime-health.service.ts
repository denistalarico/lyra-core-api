import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OperationsRoomEventBusService } from './operations-room-event-bus.service';
import { OperationsRoomOutboxWorker } from './operations-room-outbox.worker';
import { OperationsRoomRealtimeMetrics } from './operations-room-realtime.metrics';

@Injectable()
export class OperationsRoomRealtimeHealthService {
  constructor(
    @InjectDataSource('agency') private readonly agencyDataSource: DataSource,
    private readonly bus: OperationsRoomEventBusService,
    private readonly worker: OperationsRoomOutboxWorker,
    private readonly metrics: OperationsRoomRealtimeMetrics,
  ) {}

  async snapshot() {
    let agency = 'up';
    try {
      await this.agencyDataSource.query('SELECT 1');
    } catch {
      agency = 'down';
    }
    const enabled = this.bus.isEnabled();
    const bus = enabled ? (this.bus.isReady() ? 'up' : 'degraded') : 'disabled';
    const worker = enabled
      ? this.worker.isRunning()
        ? 'up'
        : 'degraded'
      : 'disabled';
    return {
      enabled,
      status: !enabled
        ? 'disabled'
        : agency === 'up' && bus === 'up'
          ? 'up'
          : 'degraded',
      agency,
      bus,
      worker,
      transport: enabled ? 'postgres-listen-notify' : 'none',
      metrics: this.metrics.snapshot(),
    };
  }
}
