import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DecideIntelligenceRecommendationDto } from './decide-intelligence-recommendation.dto';
import { GenerateIntelligenceRecommendationsDto } from './generate-intelligence-recommendations.dto';

describe('Intelligence recommendation DTOs', () => {
  it('accepts an explicit supported decision and rejects automatic actions', async () => {
    const supported = plainToInstance(DecideIntelligenceRecommendationDto, {
      action: 'approve',
    });
    const unsupported = plainToInstance(DecideIntelligenceRecommendationDto, {
      action: 'auto_apply',
    });

    await expect(validate(supported)).resolves.toHaveLength(0);
    await expect(validate(unsupported)).resolves.not.toHaveLength(0);
  });

  it('validates the evidence period and business mode syntax', async () => {
    const valid = plainToInstance(GenerateIntelligenceRecommendationsDto, {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-30T23:59:59.000Z',
      businessMode: 'services_b2b',
    });
    const invalid = plainToInstance(GenerateIntelligenceRecommendationsDto, {
      from: 'yesterday',
      businessMode: 'services b2b',
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(validate(invalid)).resolves.not.toHaveLength(0);
  });
});
