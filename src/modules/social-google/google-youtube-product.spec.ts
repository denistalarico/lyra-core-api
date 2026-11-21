import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { StartGoogleConnectionDto } from './dto/start-google-connection.dto';
import {
  GOOGLE_AUTHORIZABLE_PRODUCTS,
  GOOGLE_PRODUCTS,
  GOOGLE_PRODUCT_REQUIRED_SCOPES,
  hasProductScopes,
  isGoogleAuthorizableProduct,
  scopesForProduct,
} from './google-oauth.constants';
import { toGoogleStatusView } from './social-google.support';

const UPLOAD = 'https://www.googleapis.com/auth/youtube.upload';
const READ = 'https://www.googleapis.com/auth/youtube.readonly';
const ANALYTICS = 'https://www.googleapis.com/auth/yt-analytics.readonly';

describe('youtube Google product (D-I1)', () => {
  it('requests identity plus the three YouTube scopes', () => {
    expect(GOOGLE_PRODUCTS).toContain('youtube');
    expect(scopesForProduct('youtube')).toEqual([
      'openid',
      UPLOAD,
      READ,
      ANALYTICS,
    ]);
  });

  it('counts as granted only when every scope is granted', () => {
    expect(hasProductScopes([UPLOAD, READ, ANALYTICS], 'youtube')).toBe(true);
    expect(hasProductScopes([UPLOAD, READ], 'youtube')).toBe(false);
  });

  it('keeps a single scope for the other products', () => {
    for (const product of ['ga4', 'ads', 'business_profile'] as const) {
      expect(GOOGLE_PRODUCT_REQUIRED_SCOPES[product]).toHaveLength(1);
    }
  });

  it('never starts an authorization for Business Profile (business.manage)', () => {
    expect(GOOGLE_AUTHORIZABLE_PRODUCTS).toEqual(['ga4', 'ads', 'youtube']);
    expect(isGoogleAuthorizableProduct('business_profile')).toBe(false);
    const errors = (product: string) =>
      validateSync(plainToInstance(StartGoogleConnectionDto, { product }));
    expect(errors('business_profile')).not.toHaveLength(0);
    for (const product of GOOGLE_AUTHORIZABLE_PRODUCTS) {
      expect(errors(product)).toHaveLength(0);
      expect(scopesForProduct(product)).not.toContain(
        'https://www.googleapis.com/auth/business.manage',
      );
    }
  });

  it('never asks for a selection in the Google status (D-I2)', () => {
    const auth = {
      id: 'a1',
      tenantId: 't',
      googleSub: 's',
      status: 'connected',
      grantedScopes: [UPLOAD, READ, ANALYTICS],
      connectedAt: new Date(),
      lastError: null,
    };
    const link = {
      authorizationId: 'a1',
      product: 'youtube',
      status: 'connected',
      connectedAt: new Date(),
      resources: [],
    };
    const view = toGoogleStatusView([auth as never], [link as never]);
    const yt = view.products.find((p) => p.product === 'youtube');
    expect(yt?.status).toBe('connected');
    expect(yt?.scopeGranted).toBe(true);
    expect(yt?.selection).toEqual({ required: false, selected: [] });
  });
});
