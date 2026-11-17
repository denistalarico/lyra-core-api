import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SocialPublisherRegistry } from '../social-publisher.registry';
import { TiktokBusinessPublisherAdapter } from './tiktok-business-publisher.adapter';

/** Registers the adapter. Execution stays behind `SOCIAL_PUBLICATION_TIKTOK_BUSINESS_ENABLED`. */
@Injectable()
export class TiktokBusinessPublisherRegistration implements OnModuleInit {
  constructor(
    private readonly registry: SocialPublisherRegistry,
    private readonly adapter: TiktokBusinessPublisherAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.adapter);
  }
}
