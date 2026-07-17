import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { hostname } from 'os';
import { InboxAgentRuntimeService } from './inbox-agent-runtime.service';
import { InboxRuntimeConfigService } from '../runtime/inbox-runtime-config.service';

@Injectable()
export class InboxAgentRuntimeWorker {
  private readonly logger = new Logger(InboxAgentRuntimeWorker.name);
  private running = false;
  constructor(
    private readonly runtime: InboxAgentRuntimeService,
    private readonly config: InboxRuntimeConfigService,
  ) {}
  @Interval(2000)
  async tick() {
    if (
      !this.config.workersEnabled ||
      this.config.decisionMode === 'disabled' ||
      this.running
    )
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
