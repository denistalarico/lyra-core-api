import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CollectLeadFlowTelemetryDto,
  LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
  OptInLeadFlowTelemetryDto,
} from './telemetry-consent.dto';

describe('LeadFlow telemetry consent DTOs', () => {
  it('accepts only the declared purpose and exact content hash shape', async () => {
    const dto = plainToInstance(OptInLeadFlowTelemetryDto, {
      noticeId: 'ef37c34a-9255-453a-9b5a-1d5f36921da5',
      purposeKey: LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
      contentHash: 'a'.repeat(64),
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an unknown purpose and malformed hash', async () => {
    const dto = plainToInstance(OptInLeadFlowTelemetryDto, {
      noticeId: 'ef37c34a-9255-453a-9b5a-1d5f36921da5',
      purposeKey: 'marketing',
      contentHash: 'not-a-hash',
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property).sort()).toEqual([
      'contentHash',
      'purposeKey',
    ]);
  });

  it('requires ISO dates for collection boundaries', async () => {
    const dto = plainToInstance(CollectLeadFlowTelemetryDto, {
      from: 'yesterday',
      to: 'tomorrow',
    });

    expect((await validate(dto)).map((error) => error.property).sort()).toEqual(
      ['from', 'to'],
    );
  });
});
