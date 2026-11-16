import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SocialPublisherRegistry } from '../social-publisher.registry';
import { LinkedInPublisherAdapter } from './linkedin-publisher.adapter';

/** Registers the LinkedIn adapter. Execution stays behind its provider flag. */
@Injectable()
export class LinkedInPublisherRegistration implements OnModuleInit {
  constructor(
    private readonly registry: SocialPublisherRegistry,
    private readonly adapter: LinkedInPublisherAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.adapter);
  }
}
