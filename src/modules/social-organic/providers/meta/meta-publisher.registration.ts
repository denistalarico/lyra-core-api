import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SocialPublisherRegistry } from '../social-publisher.registry';
import { FacebookPublisherAdapter } from './facebook-publisher.adapter';
import {
  DirectInstagramPublisherAdapter,
  InstagramPublisherAdapter,
} from './instagram-publisher.adapter';

/** Registers both Meta asset-specific adapters under the shared `meta` key. */
@Injectable()
export class MetaPublisherRegistration implements OnModuleInit {
  constructor(
    private readonly registry: SocialPublisherRegistry,
    private readonly facebook: FacebookPublisherAdapter,
    private readonly instagram: InstagramPublisherAdapter,
    private readonly directInstagram?: DirectInstagramPublisherAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.facebook);
    this.registry.register(this.instagram);
    if (this.directInstagram) this.registry.register(this.directInstagram);
  }
}
