import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { ContactEntity } from './entities/contact.entity';
import { ContactMethodEntity } from './entities/contact-method.entity';
import { ContactAddressEntity } from './entities/contact-address.entity';
import { ContactListEntity } from './entities/contact-list.entity';
import { ContactListMemberEntity } from './entities/contact-list-member.entity';
import { ContactTagEntity } from './entities/contact-tag.entity';
import { ContactTagAssignmentEntity } from './entities/contact-tag-assignment.entity';
import { ContactCustomFieldEntity } from './entities/contact-custom-field.entity';
import { ContactCustomFieldValueEntity } from './entities/contact-custom-field-value.entity';
import { ContactSegmentEntity } from './entities/contact-segment.entity';
import { ContactBusinessModeEntity } from './entities/contact-business-mode.entity';
import { ContactViewPreferenceEntity } from './entities/contact-view-preference.entity';


@Module({
  imports: [
    TypeOrmModule.forFeature([
      ContactEntity,
      ContactMethodEntity,
      ContactAddressEntity,
      ContactListEntity,
      ContactListMemberEntity,
      ContactTagEntity,
      ContactTagAssignmentEntity,
      ContactCustomFieldEntity,
      ContactCustomFieldValueEntity,
      ContactSegmentEntity,
      ContactBusinessModeEntity,
      ContactViewPreferenceEntity,
    ]),
  ],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
