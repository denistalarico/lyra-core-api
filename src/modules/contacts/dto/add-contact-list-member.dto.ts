import { IsUUID } from 'class-validator';

export class AddContactListMemberDto {
  @IsUUID()
  contactId!: string;
}
