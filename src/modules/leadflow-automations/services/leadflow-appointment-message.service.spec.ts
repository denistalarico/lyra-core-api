import { LeadFlowAppointmentMessageService } from './leadflow-appointment-message.service';

describe('LeadFlowAppointmentMessageService', () => {
  const query = jest.fn();
  const service = new LeadFlowAppointmentMessageService({ query } as never);
  const scope = {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    appointmentId: 'appointment-1',
    automationId: 'automation-1',
  };

  beforeEach(() => query.mockReset());

  function row(overrides: Record<string, unknown> = {}) {
    return [
      {
        title: 'Avaliação estética',
        start_at: new Date('2026-09-10T17:30:00.000Z'),
        due_at: null,
        timezone: 'America/Sao_Paulo',
        location_text: 'Rua das Acácias, 120',
        video_url: null,
        contact_first_name: 'Marina',
        contact_display_name: 'Marina Alves',
        professional_name: 'Helena Braga',
        business_name: 'Clínica Aurora',
        ...overrides,
      },
    ];
  }

  it('does not touch the database when the text has no variables', async () => {
    const result = await service.render(scope, 'Passando para lembrar!');

    expect(query).not.toHaveBeenCalled();
    expect(result.text).toBe('Passando para lembrar!');
    expect(result.templateParameters).toEqual([]);
  });

  it('resolves date and time in the commitment own timezone', async () => {
    query.mockResolvedValue(row());

    const result = await service.render(
      scope,
      '{{appointment.date}} às {{appointment.time}}, {{appointment.weekday}}',
    );

    // 17:30 UTC is 14:30 in São Paulo — reading the instant in the workspace's
    // zone instead would tell the lead the wrong hour.
    expect(result.text).toBe('10/09 às 14:30, quinta-feira');
  });

  it('falls back to the first word of the display name', async () => {
    query.mockResolvedValue(row({ contact_first_name: null }));

    const result = await service.render(scope, 'Oi {{contact.firstName}}!');

    expect(result.text).toBe('Oi Marina!');
  });

  it('uses the meeting link when there is no address', async () => {
    query.mockResolvedValue(
      row({ location_text: null, video_url: 'https://meet.example/abc' }),
    );

    const result = await service.render(
      scope,
      'Local: {{appointment.location}}',
    );

    expect(result.text).toBe('Local: https://meet.example/abc');
  });

  it('produces the template parameters in the order the text uses them', async () => {
    query.mockResolvedValue(row());

    const result = await service.render(
      scope,
      'Oi {{contact.firstName}}, {{appointment.title}} às {{appointment.time}}',
    );

    expect(result.templateParameters).toEqual([
      'Marina',
      'Avaliação estética',
      '14:30',
    ]);
  });

  it('still delivers a message when the commitment lost its professional', async () => {
    query.mockResolvedValue(row({ professional_name: null }));

    const result = await service.render(
      scope,
      'Oi {{contact.firstName}}! Você será atendida por {{appointment.professional}}.',
    );

    // A reminder without the responsible's name is still a useful reminder; a
    // refusal here would be a silent no-show.
    expect(result.text).toBe('Oi Marina! Você será atendida por.');
  });

  it('lets a failed read propagate instead of sending a mangled sentence', async () => {
    query.mockRejectedValue(new Error('connection lost'));

    // The executor turns this into a transient failure, so the timer tries
    // again. Collapsing the variables would send "Oi!" and no retry could take
    // it back.
    await expect(
      service.render(scope, 'Oi {{contact.firstName}}!'),
    ).rejects.toThrow('connection lost');
  });

  it('still writes a sentence when the commitment no longer exists', async () => {
    query.mockResolvedValue([]);

    const result = await service.render(
      scope,
      'Oi {{contact.firstName}}! Até {{appointment.time}}.',
    );

    expect(result.text).toBe('Oi! Até.');
  });

  it('names the business from the automation own context', async () => {
    query.mockResolvedValue(row());

    await service.render(scope, 'Equipe {{business.name}}');

    // A workspace holds one agency context plus one per managed client, so the
    // public name is only unambiguous through the automation's settings row.
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('settings.id = automation.settings_id');
    expect(params).toEqual([
      'appointment-1',
      'tenant-1',
      'workspace-1',
      'automation-1',
    ]);
  });
});
