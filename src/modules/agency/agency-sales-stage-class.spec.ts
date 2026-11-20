import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateAgencySalesStageDto } from './dto/agency-sales.dto';
import {
  AGENCY_SALES_QUALIFIED_STAGE_TYPES,
  agencySalesStageFlags,
} from './entities/agency-sales.entities';

/** AN-CRM (owner decision, 2026-11-20): the stage class of the Agency CRM. */
describe('Agency CRM stage class', () => {
  it('derives the legacy flags from the class', () => {
    expect(agencySalesStageFlags('won')).toEqual({
      isClosed: true,
      isWon: true,
    });
    expect(agencySalesStageFlags('lost')).toEqual({
      isClosed: true,
      isWon: false,
    });
    for (const type of ['new', 'qualified', 'proposal', 'custom'] as const)
      expect(agencySalesStageFlags(type)).toEqual({
        isClosed: false,
        isWon: false,
      });
  });

  it('counts qualified, proposal and negotiation as qualified leads', () => {
    expect(AGENCY_SALES_QUALIFIED_STAGE_TYPES).toEqual([
      'qualified',
      'proposal',
      'negotiation',
    ]);
  });

  it('accepts the ordinary class and refuses unknown ones', () => {
    const errors = (type: string) =>
      validateSync(plainToInstance(UpdateAgencySalesStageDto, { type }));
    expect(errors('custom')).toHaveLength(0);
    expect(errors('qualified')).toHaveLength(0);
    expect(errors('vip')).not.toHaveLength(0);
  });
});
