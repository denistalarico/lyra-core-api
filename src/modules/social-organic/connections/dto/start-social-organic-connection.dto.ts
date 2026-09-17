import { IsIn } from 'class-validator';

export const SOCIAL_ORGANIC_CONNECTION_MODES = [
  'facebook',
  'instagram_facebook',
  'instagram_direct',
] as const;

export type SocialOrganicConnectionMode =
  (typeof SOCIAL_ORGANIC_CONNECTION_MODES)[number];

export class StartSocialOrganicConnectionDto {
  @IsIn(SOCIAL_ORGANIC_CONNECTION_MODES)
  mode!: SocialOrganicConnectionMode;
}
