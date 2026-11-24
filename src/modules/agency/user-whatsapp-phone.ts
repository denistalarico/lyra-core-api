/**
 * O número de WhatsApp de um usuário da agência.
 *
 * Fonte única para qualquer entrega por WhatsApp dirigida a um membro da
 * equipe (hoje, a notificação de handoff do LeadFlow). A regra é a do perfil:
 * marcado "mesmo número do telefone", vale o telefone; desmarcado, vale o
 * número próprio — e, sem número próprio, não há WhatsApp, em vez de cair
 * silenciosamente no telefone que o usuário acabou de dizer que não é WhatsApp.
 */
export function resolveUserWhatsAppPhone(
  profile: {
    phone?: string | null;
    whatsappPhone?: string | null;
    whatsappSameAsPhone?: boolean | null;
  } | null,
): string | null {
  if (!profile) return null;

  // Perfis anteriores à coluna (ou nunca salvos desde então) chegam sem o
  // campo: o padrão histórico era usar o telefone, e ele é preservado.
  const sameAsPhone = profile.whatsappSameAsPhone ?? true;
  const candidate = sameAsPhone ? profile.phone : profile.whatsappPhone;
  const trimmed = candidate?.trim();

  return trimmed ? trimmed : null;
}

/**
 * Link `https://wa.me/<dígitos>` para um número livre. Mesma regra do botão do
 * drawer no web (`whatsappHref`): só dígitos, `00` de discagem internacional
 * removido, 10–11 dígitos sem `+` são brasileiros (DDI 55), e fora de 10–15
 * dígitos não há link.
 */
export function whatsappLink(phone: string | null | undefined): string | null {
  const raw = phone?.trim();
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!raw.startsWith('+') && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`;
  }
  if (digits.length < 10 || digits.length > 15) return null;
  return `https://wa.me/${digits}`;
}
