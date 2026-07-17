import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { hostname } from 'os';
import { InboxAgentRuntimeService } from './inbox-agent-runtime.service';

@Injectable()
export class InboxAgentRuntimeWorker {
  private readonly logger = new Logger(InboxAgentRuntimeWorker.name);
  private running = false;
  constructor(private readonly runtime: InboxAgentRuntimeService) {}
  @Interval(2000)
  async tick() {
    if (process.env.INBOX_RUNTIME_WORKERS_ENABLED !== 'true' || this.running)
      return;
    this.running = true;
    try {
      await this.runtime.claimAndProcess(`${hostname()}:${process.pid}`);
    } catch (error) {
      this.logger.error(
        'Inbox agent runtime cycle failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}
