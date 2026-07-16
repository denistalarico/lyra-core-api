import { Controller, Get } from '@nestjs/common';
import { OperationsRoomRealtimeHealthService } from '../leadflow-agents/realtime/operations-room-realtime-health.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly operationsRoomRealtime: OperationsRoomRealtimeHealthService,
  ) {}

  @Get()
  async health() {
    return {
      status: 'ok',
      service: 'lyra-core-api',
      timestamp: new Date().toISOString(),
      operationsRoomRealtime: await this.operationsRoomRealtime.snapshot(),
    };
  }
}
