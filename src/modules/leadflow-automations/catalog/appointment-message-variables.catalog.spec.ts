import {
  APPOINTMENT_MESSAGE_VARIABLES,
  appointmentTemplateParameters,
  appointmentVariablesUsed,
  isAppointmentMessageVariableKey,
  renderAppointmentMessage,
} from './appointment-message-variables.catalog';

describe('appointment message variables', () => {
  it('every declared variable carries a label, a reason and an example', () => {
    // The three are what the operator sees: the chip, the tooltip and the
    // preview. A variable missing any of them is a technical key on screen.
    for (const variable of APPOINTMENT_MESSAGE_VARIABLES) {
      expect(variable.label.length).toBeGreaterThan(0);
      expect(variable.description.length).toBeGreaterThan(0);
      expect(variable.example.length).toBeGreaterThan(0);
    }
  });

  it('reads the used variables in order of appearance, without repeating', () => {
    const used = appointmentVariablesUsed(
      'Oi {{contact.firstName}}, sua {{appointment.title}} é às {{appointment.time}}. ' +
        'Até lá, {{contact.firstName}}!',
    );
    expect(used).toEqual([
      'contact.firstName',
      'appointment.title',
      'appointment.time',
    ]);
  });

  it('ignores a placeholder that is not a known variable', () => {
    // Order is what becomes {{1}}…{{n}} in the approved template, so counting a
    // typo would shift every parameter after it.
    expect(appointmentVariablesUsed('Oi {{contact.nickname}}!')).toEqual([]);
  });

  it('tolerates whitespace inside the braces', () => {
    expect(appointmentVariablesUsed('Oi {{ contact.firstName }}!')).toEqual([
      'contact.firstName',
    ]);
  });

  it('renders the values and tidies what an empty variable leaves behind', () => {
    const rendered = renderAppointmentMessage(
      'Oi {{contact.firstName}}! Local: {{appointment.location}} , às {{appointment.time}}.',
      { 'contact.firstName': 'Marina', 'appointment.time': '14:30' },
    );
    // The missing location must not leave a double space or a floating comma.
    expect(rendered).toBe('Oi Marina! Local:, às 14:30.');
  });

  it('leaves an unknown placeholder visible instead of deleting it', () => {
    const rendered = renderAppointmentMessage('Oi {{contact.nickname}}!', {});
    expect(rendered).toBe('Oi {{contact.nickname}}!');
  });

  it('never sends an empty template parameter', () => {
    // Meta rejects an empty positional parameter, so a value the platform could
    // not resolve becomes a dash rather than nothing.
    expect(
      appointmentTemplateParameters(
        ['contact.firstName', 'appointment.professional'],
        { 'contact.firstName': 'Marina' },
      ),
    ).toEqual(['Marina', '—']);
  });

  it('drops an unknown key from the parameter list', () => {
    expect(
      appointmentTemplateParameters(['contact.firstName', 'contact.nickname'], {
        'contact.firstName': 'Marina',
      }),
    ).toEqual(['Marina']);
  });

  it('recognises only the declared keys', () => {
    expect(isAppointmentMessageVariableKey('appointment.date')).toBe(true);
    expect(isAppointmentMessageVariableKey('appointment.specialty')).toBe(
      false,
    );
  });
});
