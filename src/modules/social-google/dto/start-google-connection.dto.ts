import { IsIn } from 'class-validator';
import { GOOGLE_AUTHORIZABLE_PRODUCTS } from '../google-oauth.constants';

export class StartGoogleConnectionDto {
  @IsIn([...GOOGLE_AUTHORIZABLE_PRODUCTS])
  product!: (typeof GOOGLE_AUTHORIZABLE_PRODUCTS)[number];
}
