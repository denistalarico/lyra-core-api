import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesModule } from '../../common/files/files.module';
import { AgencyContactsController } from './agency-contacts.controller';
import { AgencyContactsService } from './agency-contacts.service';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { ContactListEntity } from '../contacts/entities/contact-list.entity';
import { ContactListMemberEntity } from '../contacts/entities/contact-list-member.entity';
import {
  AgencyBankEntity,
  AgencyContactBankAccountEntity,
  AgencyContactIdentificationTypeEntity,
  AgencyContactProfileEntity,
} from './entities/agency-contact-details.entities';
import { ContactMethodEntity } from '../contacts/entities/contact-method.entity';
import { ContactAddressEntity } from '../contacts/entities/contact-address.entity';
import { ContactTagEntity } from '../contacts/entities/contact-tag.entity';
import { ContactSegmentEntity } from '../contacts/entities/contact-segment.entity';
import { ContactTagAssignmentEntity } from '../contacts/entities/contact-tag-assignment.entity';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    FilesModule,
    TypeOrmModule.forFeature(
      [
        ContactEntity,
        ContactListEntity,
        ContactListMemberEntity,
        AgencyContactProfileEntity,
        AgencyContactIdentificationTypeEntity,
        AgencyBankEntity,
        AgencyContactBankAccountEntity,
        ContactMethodEntity,
        ContactAddressEntity,
        ContactTagEntity,
        ContactSegmentEntity,
        ContactTagAssignmentEntity,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [AgencyContactsController],
  providers: [AgencyContactsService],
  exports: [AgencyContactsService],
})
export class AgencyContactsModule {}
