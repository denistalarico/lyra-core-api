import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateSocialPublicationDto } from './create-social-publication.dto';

const ids = {
  contentItemId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  destinationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  assetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};
const options = {
  privacyLevel: 'SELF_ONLY',
  disableComment: true,
  disableDuet: false,
  disableStitch: true,
};
function errors(providerOptions: unknown) {
  return validateSync(
    plainToInstance(CreateSocialPublicationDto, { ...ids, providerOptions }),
    { whitelist: true, forbidNonWhitelisted: true },
  );
}
describe('TikTok publication choices DTO', () => {
  it('accepts the complete typed choices', () =>
    expect(errors(options)).toHaveLength(0));
  it('rejects an invented privacy value', () =>
    expect(errors({ ...options, privacyLevel: 'invented' })).not.toHaveLength(
      0,
    ));
  it('rejects a string instead of a boolean', () =>
    expect(errors({ ...options, disableComment: 'false' })).not.toHaveLength(
      0,
    ));
  it('rejects incomplete interaction choices', () =>
    expect(errors({ privacyLevel: 'SELF_ONLY' })).not.toHaveLength(0));
  it('rejects arbitrary nested fields', () =>
    expect(errors({ ...options, caption: 'smuggled' })).not.toHaveLength(0));
});
