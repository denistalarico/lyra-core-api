import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SocialPublisherRegistry } from '../social-publisher.registry';
import { TiktokPublisherAdapter } from './tiktok-publisher.adapter';

/** Registers the TikTok adapter. Execution stays behind its provider flag. */
@Injectable()
export class TiktokPublisherRegistration implements OnModuleInit {
  constructor(
    private readonly registry: SocialPublisherRegistry,
    private readonly adapter: TiktokPublisherAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.adapter);
  }
}
