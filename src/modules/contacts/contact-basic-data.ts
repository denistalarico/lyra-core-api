const PLACEHOLDER_NAME =
  /^(Contato|Lead) do (WhatsApp|Instagram|Messenger|SMS)$/i;

export function validContactName(value: unknown): string | null {
  const normalized =
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (
    !normalized ||
    normalized.startsWith('@') ||
    /^(instagram|facebook_messenger|messenger):/i.test(normalized) ||
    /^\+?[\d\s()-]+$/.test(normalized) ||
    PLACEHOLDER_NAME.test(normalized) ||
    ['Nova conversa', 'Conversa sem título'].includes(normalized)
  ) {
    return null;
  }
  return normalized.slice(0, 160);
}

export function hasBasicContactData(input: {
  name: unknown;
  phone: unknown;
  email: unknown;
}): boolean {
  const contactable = [input.phone, input.email].some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
  return validContactName(input.name) !== null && contactable;
}
