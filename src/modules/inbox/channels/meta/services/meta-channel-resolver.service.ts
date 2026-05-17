import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';

@Injectable()
export class MetaChannelResolverService {
  constructor(
    @InjectRepository(InboxChannelEntity)
    private readonly channelsRepository: Repository<InboxChannelEntity>,
  ) {}

  async findWhatsAppChannelByPhoneNumberId(phoneNumberId: string) {
    const channel = await this.channelsRepository.findOne({
      where: {
        type: 'whatsapp',
        provider: 'meta',
        externalPhoneNumberId: phoneNumberId,
        status: 'active',
        deletedAt: IsNull(),
      },
    });

    if (!channel) {
      throw new NotFoundException(
        `WhatsApp channel not found for phone_number_id ${phoneNumberId}.`,
      );
    }

    return channel;
  }
}
