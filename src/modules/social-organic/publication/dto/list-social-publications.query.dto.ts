import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  SOCIAL_PUBLICATION_STATUSES,
  type SocialPublicationStatus,
} from '../social-publication.state';

export class ListSocialPublicationsQueryDto {
  @IsOptional()
  @IsUUID()
  contentItemId?: string;

  @IsOptional()
  @IsIn(SOCIAL_PUBLICATION_STATUSES as unknown as string[])
  status?: SocialPublicationStatus;
}
