import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyContactsController } from './agency-contacts.controller';
import { AgencyContactsService } from './agency-contacts.service';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { ContactListEntity } from '../contacts/entities/contact-list.entity';
import { ContactListMemberEntity } from '../contacts/entities/contact-list-member.entity';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [ContactEntity, ContactListEntity, ContactListMemberEntity],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [AgencyContactsController],
  providers: [AgencyContactsService],
  exports: [AgencyContactsService],
})
export class AgencyContactsModule {}
