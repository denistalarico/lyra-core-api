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
        deletedAt: IsNull(),
      },
      take: 2,
    });

    if (channels.length === 0) {
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
}
