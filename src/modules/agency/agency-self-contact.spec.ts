import { splitAddressLine } from './agency-self-contact';

describe('splitAddressLine', () => {
  it('splits street, number and district from the company address line', () => {
    expect(splitAddressLine('Rua Frederico Moura, 1407 - Cidade Nova')).toEqual({
      street: 'Rua Frederico Moura',
      number: '1407',
      district: 'Cidade Nova',
    });
  });

  it('keeps street and number without a district', () => {
    expect(splitAddressLine('Av. Brasil, 100')).toEqual({
      street: 'Av. Brasil',
      number: '100',
      district: null,
    });
  });

  it('keeps a free-form line as the street', () => {
    expect(splitAddressLine('Sala 12 do Edifício Central')).toEqual({
      street: 'Sala 12 do Edifício Central',
      number: null,
      district: null,
    });
  });
});
