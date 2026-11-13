import { IsIn } from 'class-validator';
import { GOOGLE_PRODUCTS } from '../google-oauth.constants';

export class StartGoogleConnectionDto {
  @IsIn([...GOOGLE_PRODUCTS])
  product!: (typeof GOOGLE_PRODUCTS)[number];
}
