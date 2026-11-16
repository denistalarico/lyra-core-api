import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SocialPublisherRegistry } from '../social-publisher.registry';
import { YoutubePublisherAdapter } from './youtube-publisher.adapter';

/** Registers the YouTube adapter. Execution stays behind its provider flag. */
@Injectable()
export class YoutubePublisherRegistration implements OnModuleInit {
  constructor(
    private readonly registry: SocialPublisherRegistry,
    private readonly adapter: YoutubePublisherAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.adapter);
  }
}
