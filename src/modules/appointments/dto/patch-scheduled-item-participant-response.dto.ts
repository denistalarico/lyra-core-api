import { IsIn } from 'class-validator';

export class PatchScheduledItemParticipantResponseDto {
  @IsIn(['needs_action', 'accepted', 'declined', 'tentative'])
  responseStatus!: string;
}
