import { Equals, IsBoolean, IsOptional } from 'class-validator';

export class RevokeGoogleAuthorizationDto {
  /** Must be literally `true`: the UI shows the impact before asking. */
  @Equals(true)
  confirm!: boolean;

  /**
   * Also revoke the grant at Google. Distinct from disconnecting: it can
   * affect the same Google account's other products and contexts, so it is
   * opt-in and refused when the identity is shared.
   */
  @IsOptional()
  @IsBoolean()
  revokeAtGoogle?: boolean;
}
