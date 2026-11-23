import { IsNull } from 'typeorm';
import { SocialChannelPreferencesService } from './social-channel-preferences.service';

const agencyScope = {
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: null,
  companyContextId: null,
};

function setup(rows: Array<Record<string, unknown>> = []) {
  const repository = {
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((row) => row.enabled === where.enabled),
    ),
    findOne: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((row) => row.channel === where.channel) ?? null,
    ),
    create: jest.fn((value: Record<string, unknown>) => value),
    save: jest.fn(async (row: Record<string, unknown>) => {
      if (!rows.includes(row)) rows.push(row);
      return row;
    }),
  };
  return {
    service: new SocialChannelPreferencesService(repository as never),
    repository,
    rows,
  };
}

describe('SocialChannelPreferencesService', () => {
  it('reads the agency context with NULL scope ids, never an unscoped query', async () => {
    const { service, repository } = setup();
    await service.disabled(agencyScope);
    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 't',
          workspaceId: 'w',
          agencyClientId: IsNull(),
          companyContextId: IsNull(),
          enabled: false,
        },
      }),
    );
  });

  it('switching off creates the row; switching back on keeps it as enabled', async () => {
    const { service, rows } = setup();
    await expect(
      service.set(agencyScope, 'linkedin', false, 'u'),
    ).resolves.toEqual(['linkedin']);
    expect(rows).toHaveLength(1);
    await expect(
      service.set(agencyScope, 'linkedin', true, 'u'),
    ).resolves.toEqual([]);
    expect(rows[0]).toMatchObject({
      channel: 'linkedin',
      enabled: true,
      updatedById: 'u',
    });
  });

  it('switching on a channel that was never off writes nothing', async () => {
    const { service, repository } = setup();
    await service.set(agencyScope, 'youtube', true, 'u');
    expect(repository.save).not.toHaveBeenCalled();
  });
});
