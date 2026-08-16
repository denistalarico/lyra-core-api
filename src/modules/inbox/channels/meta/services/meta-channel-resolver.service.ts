import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';

@Injectable()
export class MetaChannelResolverService {
  constructor(
    @InjectRepository(InboxChannelEntity, 'agency')
    private readonly channelsRepository: Repository<InboxChannelEntity>,
  ) {}

  async findWhatsAppChannelByPhoneNumberId(phoneNumberId: string) {
    const channels = await this.channelsRepository.find({
      where: {
        type: 'whatsapp',
        provider: 'meta',
        externalPhoneNumberId: phoneNumberId,
        status: 'active',
        connectionStatus: 'connected',
        deletedAt: IsNull(),
      },
      take: 2,
    });

    if (channels.length === 0) {
      const unavailable = await this.channelsRepository.find({
        where: {
          type: 'whatsapp',
          provider: 'meta',
          externalPhoneNumberId: phoneNumberId,
          deletedAt: IsNull(),
        },
        take: 2,
      });
      if (unavailable.length === 1) {
        throw new MetaChannelUnavailableError(unavailable[0]);
      }
      throw new NotFoundException(
        'WhatsApp channel not found for the supplied provider key.',
      );
    }

    if (channels.length !== 1) {
      throw new ConflictException(
        'Ambiguous WhatsApp channel provider key; webhook was not processed.',
      );
    }

    return channels[0];
  }

  async findInstagramChannelByAccountId(accountId: string) {
    const channels = await this.channelsRepository.find({
      where: {
        type: 'instagram',
        provider: 'meta',
        externalAccountId: accountId,
        status: 'active',
        connectionStatus: 'connected',
        deletedAt: IsNull(),
      },
      take: 2,
    });

    if (channels.length === 0) {
      const unavailable = await this.channelsRepository.find({
        where: {
          type: 'instagram',
          provider: 'meta',
          externalAccountId: accountId,
          deletedAt: IsNull(),
        },
        take: 2,
      });
      if (unavailable.length === 1) {
        throw new MetaChannelUnavailableError(unavailable[0]);
      }
      throw new NotFoundException(
        'Instagram channel not found for the supplied provider key.',
      );
    }

    if (channels.length !== 1) {
      throw new ConflictException(
        'Ambiguous Instagram channel provider key; webhook was not processed.',
      );
    }

    return channels[0];
  }
}

export class MetaChannelUnavailableError extends Error {
  readonly code = 'meta_channel_unavailable';
  constructor(public readonly channel: InboxChannelEntity) {
    super('Meta channel is disconnected or suspended.');
  }
}
