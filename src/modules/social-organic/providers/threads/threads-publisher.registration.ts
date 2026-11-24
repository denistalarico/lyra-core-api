import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SocialPublisherRegistry } from '../social-publisher.registry';
import { ThreadsPublisherAdapter } from './threads-publisher.adapter';

/** Registers the adapter. Execution stays behind `SOCIAL_PUBLICATION_THREADS_ENABLED`. */
@Injectable()
export class ThreadsPublisherRegistration implements OnModuleInit {
  constructor(
    private readonly registry: SocialPublisherRegistry,
    private readonly adapter: ThreadsPublisherAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.adapter);
  }
}
